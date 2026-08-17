/**
 * src/services/purchaseAgentNotificationService.js
 *
 * One WhatsApp message template per purchase-agent stage. Default language
 * is LAO — this feature's stated audience is Lao customers who don't have a
 * Thai platform account — exactly matching the open decision in the plan.
 *
 * The send worker (notificationService.dispatchPendingNotifications) routes
 * PURCHASE_AGENT:* outbox rows here via sendPurchaseAgentNotification(),
 * mirroring the RIDER_OFFER branch.
 */
import { toWaPhone } from '../utils/waPhone.js';

const fmtLAK = (value) => Number(value || 0).toLocaleString('lo-LA');

const TEMPLATES = Object.freeze({
  REQUEST_RECEIVED: ({ productName, qty }) =>
    `ສະບາຍດີລູກຄ້າ 🙏 ເຮົາໄດ້ຮັບຄຳຂໍຊື້ສິນຄ້າຂອງທ່ານແລ້ວ:\n` +
    `📦 ${productName} ${qty > 1 ? `(×${qty})` : ''}\n\n` +
    `ທີມງານ SNG ຈະກວດລາຄາ ແລະ ສົ່ງໃບສະເໜີລາຄາໃຫ້ທ່ານທາງ WhatsApp ໄວໆນີ້.`,

  DECLINED: ({ productName, reason }) =>
    `ສະບາຍດີລູກຄ້າ 🙏 ຄຳຂໍຊື້ສິນຄ້າ "${productName}" ຂອງທ່ານບໍ່ສາມາດດຳເນີນການໄດ້\n` +
    `ເຫດຜົນ: ${reason || 'ບໍ່ໄດ້ລະບຸ'}\nຖ້າມີຄຳຖາມ ຕິດຕໍ່ພະນັກງານ SNG ໄດ້ເລີຍ.`,

  QUOTED: ({ quoteNo, productName, productLak, serviceFeeLak, sngShippingLak, totalLak, depositLak }) =>
    `ສະບາຍດີລູກຄ້າ 🙏 ໃບສະເໜີລາຄາ ${quoteNo} ພ້ອມແລ້ວ:\n` +
    `📦 ສິນຄ້າ: ${productName}\n` +
    `💵 ມູນຄ່າສິນຄ້າ: ${fmtLAK(productLak)} ກີບ\n` +
    `🚚 ຄ່າຂົນສົ່ງ SNG: ${fmtLAK(sngShippingLak)} ກີບ\n` +
    `🧾 ຄ່າບໍລິການ: ${fmtLAK(serviceFeeLak)} ກີບ\n` +
    `— ລວມທັງໝົດ: ${fmtLAK(totalLak)} ກີບ\n\n` +
    `ຈ່າຍລ່ວງໜ້າ (ມູນຄ່າສິນຄ້າເທົ່ານັ້ນ): ${fmtLAK(depositLak)} ກີບ\n` +
    `ສ່ວນທີ່ເຫຼືອເກັບເງິນປາຍທາງ.\n\n` +
    `✅ ກົດຢືນຢັນໄດ້ທີ່ເວັບ: ເບິ່ງລາຍລະອຽດໃນບັນຊີສະມາຊິກຂອງທ່ານ`,

  ACCEPTED: ({ quoteNo, productName, depositLak }) =>
    `ຢືນຢັນແລ້ວ ✅ ໃບສະເໜີລາຄາ ${quoteNo} (${productName})\n` +
    `ກະລຸນາຈ່າຍມູນຄ່າລ່ວງໜ້າ ${fmtLAK(depositLak)} ກີບ ຜ່ານບັນຊີທີ່ແຈ້ງໄວ້ໃນເວັບ ແລ້ວສົ່ງໃບຫຼັກຖານການໂອນມາທາງ WhatsApp ເພື່ອໃຫ້ພະນັກງານບັນທຶກ.`,

  REJECTED: ({ quoteNo }) =>
    `ຮັບທະບຽນການປະຕິເສດໃບສະເໜີລາຄາ ${quoteNo} ແລ້ວ 🙏 ຖ້າຕ້ອງການປ່ຽນໃຈ ຫຼື ສອບຖາມເພີ່ມເຕີມ ຕິດຕໍ່ພະນັກງານ SNG ໄດ້ຕະຫຼອດ.`,

  DEPOSIT_RECORDED: ({ quoteNo, paidLak, depositLak }) =>
    `ບັນທຶກເງິນມັດຈຳ ${fmtLAK(paidLak)} ກີບ ສຳລັບ ${quoteNo} ແລ້ວ ✅\n` +
    `(ມູນຄ່າທີ່ຕ້ອງຈ່າຍ: ${fmtLAK(depositLak)} ກີບ)\nຂອບໃຈທີ່ໄວ້ໃຈ SNG 🙏`,

  PURCHASING: ({ quoteNo, productName }) =>
    `ດຳເນີນການສັ່ງຊື້ແລ້ວ 🛒 ${quoteNo} (${productName})\n` +
    `ທີມງານ SNG ກຳລັງສັ່ງສິນຄ້າກັບຮ້ານຄ້າຕົ້ນທາງ ຈະອັບເດດໃຫ້ທ່ານທຸກຂັ້ນຕອນ.`,

  PURCHASED: ({ quoteNo, productName }) =>
    `ຊື້ສຳເລັດແລ້ວ ✅ ${quoteNo} (${productName})\n` +
    `ສິນຄ້າກຳລັງຈະເຂົ້າສາງ SNG ປະເທດໄທ ແລະ ຈະສົ່ງຕໍ່ມາລາວຕາມຂັ້ນຕອນປົກກະຕິ.`,

  BRIDGED: ({ jobNo, quoteNo }) =>
    `ສ້າງໃບຂົນສົ່ງແລ້ວ 📦 ເລກພັດສະດຸ: ${jobNo || ''} (ຈາກໃບສະເໝີ ${quoteNo || ''})\n` +
    `ຕິດຕາມສະຖານະໄດ້ທາງເວັບ / ແອັບ SNG.`,
});

const STAGE_BY_EVENT = {
  'PURCHASE_AGENT:REQUEST_RECEIVED': 'REQUEST_RECEIVED',
  'PURCHASE_AGENT:DECLINED': 'DECLINED',
  'PURCHASE_AGENT:QUOTED': 'QUOTED',
  'PURCHASE_AGENT:ACCEPTED': 'ACCEPTED',
  'PURCHASE_AGENT:REJECTED': 'REJECTED',
  'PURCHASE_AGENT:DEPOSIT_RECORDED': 'DEPOSIT_RECORDED',
  'PURCHASE_AGENT:PURCHASING': 'PURCHASING',
  'PURCHASE_AGENT:PURCHASED': 'PURCHASED',
  'PURCHASE_AGENT:BRIDGED': 'BRIDGED',
};

/**
 * Build the WhatsApp text for a stage from a decoded outbox row payload.
 * @param {string} eventType - e.g. 'PURCHASE_AGENT:QUOTED'
 * @param {object} payload   - JSON payload stored on the outbox row
 * @returns {string|null}    null when the event has no template
 */
export function buildPurchaseAgentMessage(eventType, payload = {}) {
  const stage = STAGE_BY_EVENT[eventType];
  if (!stage || typeof TEMPLATES[stage] !== 'function') return null;
  return TEMPLATES[stage](payload);
}

/**
 * Send handler called by the notification worker for a PURCHASE_AGENT:* row.
 * The recipient is read from row.recipient (resolved at enqueue time) — never
 * re-queried, matching the RIDER_OFFER pattern.
 * @returns {Promise<{sent?: boolean, recipient?: string}|{skipped: boolean, reason: string}>}
 */
export async function sendPurchaseAgentNotification(row) {
  const recipient = row.recipient || null;
  if (!recipient) return { skipped: true, reason: 'no recipient' };

  const payload = typeof row.payload === 'string'
    ? JSON.parse(row.payload || '{}')
    : (row.payload || {});
  const text = buildPurchaseAgentMessage(row.event_type, payload);
  if (!text) return { skipped: true, reason: `No template for ${row.event_type}` };

  const phone = toWaPhone(recipient);
  if (!phone) return { skipped: true, reason: 'invalid phone' };

  const { sendTextMessage } = await import('./whatsappService.js');
  return sendTextMessage(recipient, text);
}
