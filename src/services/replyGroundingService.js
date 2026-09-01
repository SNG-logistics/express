/**
 * src/services/replyGroundingService.js
 *
 * Pulls real business facts out of a customer's message so the CRM's
 * AI-drafted replies (aiService.generateSmartReplies) can be grounded in
 * actual data instead of letting the model guess a price, a delivery
 * status, or a purchase-agent estimate it has no way to know.
 *
 * Extraction functions below are pure regex/lookup-table matching — no DB,
 * no network — so they're unit-testable on their own. buildGroundingContext
 * is the only function that touches the database or other services.
 */

import pool from '../config/db.js';
import { lookupTrackingSummary } from './trackingLookupService.js';
import { findBestShippingRate } from './pricingService.js';
import { previewPurchaseAgentQuote } from './purchaseAgentPricingService.js';
import { getLatestRate } from './exchangeRateService.js';
import { WEIGHT_PRESETS } from '../controllers/publicController.js';

const JOB_NO_RE = /\bSNG-\d{6}-\d{4}\b/i;
const QUOTE_NO_RE = /\bPQ-\d{8}-\d{4}\b/i;

const SHOP_URL_RE = /https?:\/\/(?:[\w-]+\.)*(?:lazada\.(?:co\.th|com|vn)|shopee\.(?:co\.th|la|com)|shp\.ee|vt\.tiktok\.com|shop\.tiktok\.com)\/\S*/i;

const PRICE_RE = /(?:฿\s*(\d[\d,]*(?:\.\d+)?))|(?:(\d[\d,]*(?:\.\d+)?)\s*(?:บาท|บ\.|thb))/i;
const QTY_RE = /(?:(\d+)\s*(?:ชิ้น|ตัว|อัน|คู่|ชุด|กล่อง))|(?:x\s*(\d+)\b)/i;

const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(?:kg|กก\.?|กิโล)/i;
const DIMS_RE = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i;

const CATEGORY_KEYWORDS = {
  clothes: ['เสื้อผ้า', 'เสื้อ', 'กางเกง'],
  shoes: ['รองเท้า'],
  cosmetics: ['เครื่องสำอาง', 'ครีม', 'สกินแคร์'],
  accessories: ['เครื่องประดับ', 'ของชิ้นเล็ก'],
  smallAppliance: ['เครื่องใช้ไฟฟ้า'],
  bulky: ['ของชิ้นใหญ่', 'เฟอร์นิเจอร์'],
};

const HOW_TO_ORDER_TH = 'ส่งพัสดุเอง: แจ้งชื่อ-ที่อยู่ผู้รับและรูปสินค้ากับเจ้าหน้าที่ ทางร้านจะออกเลขงาน SNG ให้ติดตามสถานะได้ | ฝากซื้อจาก Lazada/Shopee: ใส่ลิงก์สินค้าที่หน้า /buy เพื่อดูราคาประมาณ แล้วแจ้งเจ้าหน้าที่ยืนยันอีกครั้ง';
const HOW_TO_ORDER_LA = 'ສົ່ງພັດສະດຸເອງ: ແຈ້ງຊື່-ທີ່ຢູ່ຜູ້ຮັບ ແລະ ຮູບສິນຄ້າກັບເຈົ້າໜ້າທີ່ ທາງຮ້ານຈະອອກເລກງານ SNG ໃຫ້ຕິດຕາມສະຖານະໄດ້ | ຝາກຊື້ຈາກ Lazada/Shopee: ໃສ່ລິ້ງສິນຄ້າທີ່ໜ້າ /buy ເພື່ອເບິ່ງລາຄາປະມານ ແລ້ວແຈ້ງເຈົ້າໜ້າທີ່ຢືນຢັນອີກຄັ້ງ';

/** An SNG job number or a purchase-agent quote number embedded in free text. */
export function extractTrackingRef(text = '') {
  const job = text.match(JOB_NO_RE);
  if (job) return { ref: job[0].toUpperCase(), kind: 'JOB' };
  const quote = text.match(QUOTE_NO_RE);
  if (quote) return { ref: quote[0].toUpperCase(), kind: 'QUOTE' };
  return null;
}

/**
 * Real dimensions/weight if stated, otherwise a category keyword mapped to
 * its WEIGHT_PRESETS entry — the weight always comes from the preset array
 * itself, never a re-typed literal, so the two can't drift apart.
 */
export function extractShippingInputs(text = '') {
  const dims = text.match(DIMS_RE);
  const weight = text.match(WEIGHT_RE);

  if (dims) {
    return {
      lengthCm: Number(dims[1]),
      widthCm: Number(dims[2]),
      heightCm: Number(dims[3]),
      weightKg: weight ? Number(weight[1]) : 0,
    };
  }
  if (weight) {
    return { weightKg: Number(weight[1]) };
  }

  for (const [key, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) {
      const preset = WEIGHT_PRESETS.find(p => p.key === key);
      if (preset) return { weightKg: preset.kg, presetKey: key };
    }
  }

  return null;
}

/** A Lazada/Shopee/TikTok Shop product link, if the message has one. */
export function extractProductLink(text = '') {
  const match = text.match(SHOP_URL_RE);
  return match ? match[0] : null;
}

/** A stated price (and optional quantity, defaulting to 1) in Thai baht. */
export function extractPriceQty(text = '') {
  const priceMatch = text.match(PRICE_RE);
  if (!priceMatch) return null;

  const priceThb = Number((priceMatch[1] || priceMatch[2] || '').replace(/,/g, ''));
  if (!Number.isFinite(priceThb) || priceThb <= 0) return null;

  const qtyMatch = text.match(QTY_RE);
  const qty = qtyMatch ? Number(qtyMatch[1] || qtyMatch[2]) : 1;

  return { priceThb, qty: Math.max(1, qty) || 1 };
}

/**
 * Orchestrator: runs the extractors above against a customer's message and,
 * for each one that matches, fetches the real data it needs. Each lookup is
 * independently wrapped so one failure doesn't blank out the others.
 */
export async function buildGroundingContext(customerMessage, { lang = 'TH' } = {}) {
  const text = String(customerMessage || '');
  const facts = { howToOrder: lang === 'LA' ? HOW_TO_ORDER_LA : HOW_TO_ORDER_TH };

  const trackingRef = extractTrackingRef(text);
  if (trackingRef) {
    try {
      facts.tracking = await lookupTrackingSummary(trackingRef.ref);
    } catch (err) {
      console.error('[ReplyGrounding] tracking lookup failed:', err.message);
      facts.tracking = { found: false, ref: trackingRef.ref, error: true };
    }
  }

  const shippingInputs = extractShippingInputs(text);
  if (shippingInputs) {
    try {
      facts.shippingQuote = await findBestShippingRate(shippingInputs);
    } catch (err) {
      console.error('[ReplyGrounding] shipping lookup failed:', err.message);
    }
  }

  const productLink = extractProductLink(text);
  if (productLink) {
    const priceQty = extractPriceQty(text);
    if (!priceQty) {
      facts.purchaseAgentEstimate = { hasLink: true, missingPriceQty: true };
    } else {
      try {
        const perItemKg = shippingInputs?.weightKg || 0;
        const shipping = await findBestShippingRate({ weightKg: perItemKg * priceQty.qty });
        const rate = await getLatestRate(pool, 'THB_LAK');
        const shippingLak = Math.ceil((shipping.price || 0) * rate);
        const quote = await previewPurchaseAgentQuote({
          product_price_thb: priceQty.priceThb,
          desired_qty: priceQty.qty,
          sng_shipping_lak: shippingLak,
        });
        facts.purchaseAgentEstimate = {
          hasLink: true,
          priceThb: priceQty.priceThb,
          qty: priceQty.qty,
          payNowLak: quote.productLak,
          payOnDeliveryLak: quote.totalLak - quote.productLak,
          totalLak: quote.totalLak,
          shippingKnown: shipping.found,
        };
      } catch (err) {
        console.error('[ReplyGrounding] purchase-agent estimate failed:', err.message);
        facts.purchaseAgentEstimate = { hasLink: true, error: true };
      }
    }
  }

  return facts;
}
