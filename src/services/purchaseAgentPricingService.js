/**
 * src/services/purchaseAgentPricingService.js
 *
 * Single source of truth for purchase-agent quotation pricing.
 * Replaces the same formula that was duplicated three times:
 *   1. server-side calcQuote() in partnerController.js
 *   2. the dead /api/partner/calc endpoint
 *   3. a client-side Alpine.js twin in views/partner/quotes/new.ejs
 *
 * Follows pricingService.js's two-tier convention:
 *   - calculatePurchaseAgentQuote()  — pure math, never touches the DB
 *   - previewPurchaseAgentQuote()    — pool-based, NEVER throws (live staff calculator)
 *   - resolvePurchaseAgentQuote()    — connection-based, throws via WorkflowError,
 *                                      used inside the commit transaction so bad
 *                                      input can never persist a broken quote.
 *
 * Owner's fee policy: service fee = MAX(minimum_flat_lak, productLak × fee_pct).
 * Deposit policy: deposit_required_lak = converted product cost ONLY (what SNG
 * must hand the merchant) — shipping fee and service fee ride on the COD balance.
 */
import { WorkflowError } from './orderWorkflowService.js';
import { getLatestRate } from './exchangeRateService.js';
import pool from '../config/db.js';

export const PURCHASE_AGENT_FEE_MIN_LIMIT_LAK = 20000;
export const PURCHASE_AGENT_FEE_PCT_DEFAULT = 6;

function finiteNonNegative(value, field) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new WorkflowError(`${field} must be a non-negative number`, 400, 'INVALID_PRICE_INPUT');
  }
  return number;
}

/**
 * Pure calculation — no DB access. Mirrors the exact formula in the plan:
 *   productThb      = product_price_thb × desired_qty
 *   subtotalThb     = productThb + shipping_th_thb
 *   effectiveRate   = exchange_rate × (1 + fx_spread_pct/100)
 *   productLak      = ceil(subtotalThb × effectiveRate)          // = deposit_required_lak
 *   serviceFeeLak   = max(minimum_flat_lak, productLak × fee_pct)  // hybrid fee
 *   totalLak        = productLak + sng_shipping_lak + serviceFeeLak
 * @returns {{ productThb, subtotalThb, effectiveRate, productLak,
 *             serviceFeeLak, totalLak, feeApplied: 'flat'|'pct' }}
 */
export function calculatePurchaseAgentQuote({
  product_price_thb,
  desired_qty = 1,
  shipping_th_thb = 0,
  exchange_rate,
  fx_spread_pct = 0,
  sng_shipping_lak = 0,
  fee_min_lak = PURCHASE_AGENT_FEE_MIN_LIMIT_LAK,
  fee_pct = PURCHASE_AGENT_FEE_PCT_DEFAULT,
}) {
  const unitPrice = finiteNonNegative(product_price_thb, 'Product price');
  const qty = Math.max(1, Math.floor(Number(desired_qty) || 1));
  const shippingThb = finiteNonNegative(shipping_th_thb, 'TH shipping fee');
  const rate = finiteNonNegative(exchange_rate, 'Exchange rate');
  if (rate <= 0) throw new WorkflowError('Exchange rate must be greater than 0', 400, 'INVALID_EXCHANGE_RATE');
  const spread = finiteNonNegative(fx_spread_pct, 'FX spread');
  const sngShip = finiteNonNegative(sng_shipping_lak, 'SNG shipping fee');
  const feeMin = finiteNonNegative(fee_min_lak, 'Minimum service fee');
  const feePct = finiteNonNegative(fee_pct, 'Service fee percent');

  const productThb = unitPrice * qty;
  const subtotalThb = productThb + shippingThb;
  const effectiveRate = rate * (1 + spread / 100);
  const productLak = Math.ceil(subtotalThb * effectiveRate);
  const percentFee = productLak * (feePct / 100);
  const serviceFeeLak = Math.max(feeMin, percentFee);
  const totalLak = productLak + sngShip + serviceFeeLak;

  return {
    productThb,
    subtotalThb,
    effectiveRate,
    productLak,
    serviceFeeLak,
    totalLak,
    feeApplied: percentFee > feeMin ? 'pct' : 'flat',
  };
}

function normalizeSettings(settings = {}) {
  return {
    feeMinLak: Number(settings.purchase_agent_fee_min_lak) || PURCHASE_AGENT_FEE_MIN_LIMIT_LAK,
    feePct: Number(settings.purchase_agent_fee_pct) || PURCHASE_AGENT_FEE_PCT_DEFAULT,
  };
}

/**
 * Preview route used by the LIVE staff calculator. Never throws:
 * invalid/empty inputs return a zero-shaped result so the UI keeps rendering.
 * @param {object} input - same shape as calculatePurchaseAgentQuote()
 * @returns {Promise<object>} calculation result (zero-padded on error)
 */
export async function previewPurchaseAgentQuote(input = {}) {
  try {
    const [settingsRows] = await pool.query(
      `SELECT setting_key, setting_value FROM company_settings
       WHERE setting_key IN ('purchase_agent_fee_min_lak','purchase_agent_fee_pct')`
    );
    const settings = Object.fromEntries(settingsRows.map(row => [row.setting_key, row.setting_value]));
    const { feeMinLak, feePct } = normalizeSettings(settings);

    let rate = Number(input.exchange_rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      rate = await getLatestRate(pool);
    }

    return calculatePurchaseAgentQuote({
      ...input,
      exchange_rate: rate,
      fee_min_lak: feeMinLak,
      fee_pct: feePct,
    });
  } catch (error) {
    console.error('[PurchaseAgentPricing] preview failed:', error.message);
    return {
      productThb: 0, subtotalThb: 0, effectiveRate: 0,
      productLak: 0, serviceFeeLak: 0, totalLak: 0, feeApplied: 'flat',
    };
  }
}

/**
 * Resolving variant used inside the commit transaction — throws via
 * WorkflowError on invalid input so a broken quote can never persist.
 * @param {object} conn - transaction connection (mysql2 shares pool's API)
 * @param {object} input - same shape as calculatePurchaseAgentQuote(), plus
 *                         optional { companySettings } to avoid a second query
 */
export async function resolvePurchaseAgentQuote(conn, input = {}) {
  const settings = input.companySettings || {};
  const { feeMinLak, feePct } = normalizeSettings(settings);

  let rate = Number(input.exchange_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    rate = await getLatestRate(conn, 'THB_LAK');
  }

  return calculatePurchaseAgentQuote({
    ...input,
    exchange_rate: rate,
    fee_min_lak: feeMinLak,
    fee_pct: feePct,
  });
}
