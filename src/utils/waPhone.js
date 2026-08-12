/**
 * src/utils/waPhone.js
 * Shared WhatsApp phone normalisation for Thailand (66) and Laos (856).
 * Mirrors the inline logic in whatsappService.sendOrderUpdate so inbound
 * (rider reply) and outbound (offer message) use the SAME canonical form,
 * which is what makes rider ↔ offer matching reliable.
 */

/** Normalise a raw phone string to international digits, e.g. "081.." → "6681..". */
export function toWaPhone(raw) {
  let phone = String(raw || '').replace(/\D/g, '');
  if (!phone) return null;
  if (phone.startsWith('856') || phone.startsWith('66')) return phone;   // already international
  if (phone.startsWith('020') || phone.startsWith('030')) return '856' + phone.slice(1); // Laos local
  if (phone.startsWith('0')) return '66' + phone.slice(1);               // Thai local
  if (phone.startsWith('20') || phone.startsWith('30')) return '856' + phone; // Laos without leading 0
  return phone;
}

/** Build a Baileys JID for a raw phone, or null if unusable. */
export function toJid(raw) {
  const phone = toWaPhone(raw);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

/** True when two raw phone strings resolve to the same WhatsApp number. */
export function sameWaPhone(a, b) {
  const na = toWaPhone(a);
  const nb = toWaPhone(b);
  return Boolean(na) && na === nb;
}
