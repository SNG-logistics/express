import { findBestShippingRate } from '../services/pricingService.js';
import { previewPurchaseAgentQuote } from '../services/purchaseAgentPricingService.js';
import { getProhibitedItems } from '../services/prohibitedItemsService.js';
import { getPublishedTestimonials } from '../services/testimonialsService.js';
import { getCompanySettings } from '../services/companySettingsService.js';

function numberParam(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function publicView(res, view, data) {
  return res.render(view, { ...data, layout: 'customer/layout' });
}

export async function home(req, res) {
  const company = await getCompanySettings();
  return publicView(res, 'customer/home', {
    title: 'SNG Express | ไทย ↔ ลาว',
    company,
  });
}

export async function calculatePage(req, res, next) {
  try {
    const values = {
      weight_kg: numberParam(req.query.weight_kg),
      length_cm: numberParam(req.query.length_cm),
      width_cm: numberParam(req.query.width_cm),
      height_cm: numberParam(req.query.height_cm),
    };
    const hasValues = Object.keys(req.query).some(key => key in values);
    const quote = hasValues ? await findBestShippingRate({
      weightKg: values.weight_kg,
      lengthCm: values.length_cm,
      widthCm: values.width_cm,
      heightCm: values.height_cm,
    }) : null;
    return publicView(res, 'customer/calculate', {
      title: 'คำนวณค่าส่ง | SNG Express',
      values,
      quote,
    });
  } catch (error) {
    return next(error);
  }
}

export async function shippingQuote(req, res) {
  try {
    const quote = await findBestShippingRate({
      weightKg: numberParam(req.query.weight_kg),
      lengthCm: numberParam(req.query.length_cm),
      widthCm: numberParam(req.query.width_cm),
      heightCm: numberParam(req.query.height_cm),
    });
    return res.json(quote);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid shipping quote input' });
  }
}


/**
 * Weight presets, because a customer looking at a Lazada listing knows what the
 * thing IS, not what it weighs. Asking for kilograms up front is where a
 * price-check gets abandoned; picking "a pair of shoes" does not.
 * Values are deliberately generous — an estimate that comes in under the real
 * quote is the one that makes people feel misled.
 */
export const WEIGHT_PRESETS = Object.freeze([
  { key: 'clothes',     kg: 0.7 },
  { key: 'shoes',       kg: 1.5 },
  { key: 'cosmetics',   kg: 0.5 },
  { key: 'accessories', kg: 0.3 },
  { key: 'smallAppliance', kg: 3 },
  { key: 'bulky',       kg: 8 },
]);

/**
 * What a purchase-agent order costs, answered before the customer has to fill in
 * anything or wait for a human.
 *
 * The marketing promise is "shop the Thai apps and we bring it over", which sets
 * a Lazada-shaped expectation: see the price, now. Every number here is an
 * estimate — the real quote still comes from staff, who check stock and the
 * actual shipping weight — so the page says so plainly rather than implying a
 * commitment nobody has made.
 */
export async function purchaseEstimatePage(req, res) {
  const [company, prohibited, testimonials] = await Promise.all([
    getCompanySettings(),
    getProhibitedItems(res.locals.lang),
    getPublishedTestimonials(),
  ]);
  return publicView(res, 'customer/buy', {
    title: 'ซื้อของจากไทย | SNG Express',
    company,
    weightPresets: WEIGHT_PRESETS,
    prohibited,
    testimonials,
  });
}

/**
 * JSON behind the live estimator. Reuses the exact services staff quotes are
 * built from — previewPurchaseAgentQuote for the fee and FX, findBestShippingRate
 * for the cross-border leg — so a customer's estimate can never drift away from
 * how the business actually prices.
 */
export async function purchaseEstimate(req, res) {
  try {
    const priceThb = numberParam(req.query.price_thb);
    const qty = Math.max(1, Math.floor(numberParam(req.query.qty)) || 1);
    const weightKg = numberParam(req.query.weight_kg);

    if (priceThb <= 0) {
      return res.json({ ok: false, reason: 'NO_PRICE' });
    }

    // Cross-border shipping is charged on the parcel, so it scales with the
    // total weight of the order rather than per item.
    const shipping = await findBestShippingRate({ weightKg: weightKg * qty });
    const quote = await previewPurchaseAgentQuote({
      product_price_thb: priceThb,
      desired_qty: qty,
      sng_shipping_lak: shipping.price || 0,
    });

    return res.json({
      ok: true,
      // Named for what the customer is deciding, not for our column names.
      payNowLak: quote.productLak,           // deposit = converted product cost only
      payOnDeliveryLak: quote.totalLak - quote.productLak,
      productLak: quote.productLak,
      shippingLak: shipping.price || 0,
      serviceFeeLak: quote.serviceFeeLak,
      totalLak: quote.totalLak,
      rate: quote.effectiveRate,
      // A weight over every rate band means staff must price it by hand; saying
      // so beats quietly returning a zero shipping fee.
      shippingKnown: shipping.found,
    });
  } catch (error) {
    console.error('[Public] purchaseEstimate:', error.message);
    return res.status(400).json({ ok: false, reason: 'BAD_INPUT' });
  }
}
