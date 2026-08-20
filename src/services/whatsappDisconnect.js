/**
 * whatsappDisconnect.js — what to do when Baileys closes the connection.
 *
 * Kept apart from whatsappService.js because that module opens a socket the
 * moment it is imported, which makes the decision underneath it impossible to
 * test. Nothing here touches the socket, the filesystem or the clock.
 *
 * The distinction that matters is between "our session is stale" and "somebody
 * else owns this session". They look identical from the outside — the
 * connection just closes — but the correct responses are opposites: reconnect
 * and eventually re-pair for the first, stand well back for the second.
 */

/** Baileys' own numbers, repeated here so this module imports nothing. */
export const LOGGED_OUT = 401;
export const CONNECTION_REPLACED = 440;

/** Failed reconnects before we assume the stored credentials are unusable. */
export const AUTH_CLEAR_THRESHOLD = 3;

/**
 * @param {object} params
 * @param {number|undefined} params.statusCode  lastDisconnect.error.output.statusCode
 * @param {string} params.errorMessage          lastDisconnect.error.message
 * @param {number} params.reconnectAttempts     failures so far, before this one
 * @param {boolean} params.manuallyDisabled     the DISABLE_WHATSAPP flag file
 * @returns {{action:string, status:string, clearAuth:boolean, retryInMs:number|null, countsAsFailure:boolean}}
 */
export function classifyDisconnect({
  statusCode,
  errorMessage = '',
  reconnectAttempts = 0,
  manuallyDisabled = false,
} = {}) {
  const stop = (action, status) => ({
    action, status, clearAuth: false, retryInMs: null, countsAsFailure: false,
  });

  // WhatsApp hands out only a few QR ref tokens per pairing attempt. Running
  // out because nobody scanned is an expiry, not a failure — counting it would
  // march an idle, unpaired install toward wiping its own credentials.
  if (typeof errorMessage === 'string' && errorMessage.includes('QR refs attempts ended')) {
    if (manuallyDisabled) return stop('stop', 'DISABLED_MANUALLY');
    return {
      action: 'refresh-qr', status: 'QR_READY',
      clearAuth: false, retryInMs: 1500, countsAsFailure: false,
    };
  }

  // Another client took the session over: a second copy of this app, or these
  // credentials copied elsewhere. Reconnecting starts a fight we cannot win —
  // each side reclaims the session and kicks the other — and the old code then
  // deleted the credentials the other side was using, leaving both begging for
  // a QR scan. Standing down lets whoever holds it keep working.
  if (statusCode === CONNECTION_REPLACED) {
    return stop('stand-down', 'CONFLICT');
  }

  if (statusCode === LOGGED_OUT) {
    // The phone unlinked this device. The credentials really are dead, so
    // clearing them is what produces a fresh QR rather than a retry loop.
    if (manuallyDisabled) return { ...stop('stop', 'DISABLED_MANUALLY'), clearAuth: true };
    return {
      action: 'reauthenticate', status: 'DISCONNECTED',
      clearAuth: true, retryInMs: 2000, countsAsFailure: false,
    };
  }

  if (manuallyDisabled) return stop('stop', 'DISABLED_MANUALLY');

  // Ordinary drop — network, restart, server hiccup. Retry, and only after
  // several consecutive failures conclude the stored credentials are the
  // problem.
  const attempts = reconnectAttempts + 1;
  return {
    action: 'reconnect', status: 'DISCONNECTED',
    clearAuth: attempts >= AUTH_CLEAR_THRESHOLD,
    retryInMs: 5000,
    countsAsFailure: true,
  };
}
