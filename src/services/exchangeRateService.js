/**
 * src/services/exchangeRateService.js
 *
 * Single source of truth for exchange-rate lookups.
 * Replaces the three different hardcoded FX fallbacks that were scattered
 * across the codebase (200 in partnerController.js, 580 in
 * expensesController.js/tripsController.js, 700 in ordersController.js)
 * with one constant and one query.
 *
 * mysql2 shares the same query() interface between the pool and a
 * transaction connection, so this service is callable with either.
 */
import { WorkflowError } from './orderWorkflowService.js';

// Fallback used only when no exchange_rates row exists yet. Owner should seed
// a real rate via Settings → Exchange Rate; this merely keeps the app alive
// during a pre-seed deploy instead of crashing with a 500.
export const DEFAULT_THB_LAK_RATE = 580;

/**
 * Fetch the latest rate for a currency pair.
 * @param {object} poolOrConn - mysql2 pool OR a transaction connection
 * @param {string} [pair='THB_LAK']
 * @returns {Promise<number>} rate (LAK per 1 THB, or THB per 1 USD)
 */
export async function getLatestRate(poolOrConn, pair = 'THB_LAK') {
  const safePair = String(pair || 'THB_LAK').toUpperCase();
  if (safePair !== 'THB_LAK' && safePair !== 'USD_THB') {
    throw new WorkflowError(`Unsupported exchange-rate pair: ${safePair}`, 400, 'INVALID_FX_PAIR');
  }

  const [[row]] = await poolOrConn.query(
    'SELECT rate FROM exchange_rates WHERE pair = ? ORDER BY created_at DESC LIMIT 1',
    [safePair]
  );
  if (row && Number(row.rate) > 0) return Number(row.rate);

  // No row yet — THB_LAK gets the default; USD_THB has no single historical
  // default in the app (it was 36 in the settings UI), keep it consistent.
  return safePair === 'THB_LAK' ? DEFAULT_THB_LAK_RATE : 36;
}
