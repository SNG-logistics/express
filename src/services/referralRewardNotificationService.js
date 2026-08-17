/**
 * src/services/referralRewardNotificationService.js
 *
 * Bilingual (Lao/Thai) WhatsApp templates for referral-reward grants, chosen
 * via isLaoPhone() -- customer_accounts has no country column, so this
 * mirrors otpService.js's language-selection approach, not
 * customersController.inviteMember's (which has customers.country available).
 *
 * The send worker (notificationService.dispatchPendingNotifications) routes
 * REFERRAL_REWARD:* outbox rows here via sendReferralRewardNotification(),
 * mirroring the PURCHASE_AGENT: branch.
 */
import { toWaPhone, isLaoPhone } from '../utils/waPhone.js';

const fmtLAK = (value) => Number(value || 0).toLocaleString('lo-LA');

const TEMPLATES = Object.freeze({
  REFERRED_CREDIT: {
    lo: ({ amountLak, jobNo }) =>
      `🎉 ຍິນດີນຳ! ວຽກພັດສະດຸທຳອິດຂອງທ່ານ${jobNo ? ` (${jobNo})` : ''} ສຳເລັດແລ້ວ\n` +
      `ທ່ານໄດ້ຮັບເຄຣດິດສ່ວນຫຼຸດ ${fmtLAK(amountLak)} ກີບ ຈາກການສະໝັກຜ່ານລະຫັດແນະນຳໝູ່\n` +
      `ນຳໄປໃຊ້ເປັນສ່ວນຫຼຸດການສົ່ງເທື່ອຕໍ່ໄປໄດ້ເລີຍ ຂອບໃຈທີ່ໄວ້ໃຈ SNG Express 🙏`,
    th: ({ amountLak, jobNo }) =>
      `🎉 ยินดีด้วย! งานพัสดุแรกของคุณ${jobNo ? ` (${jobNo})` : ''} สำเร็จแล้ว\n` +
      `คุณได้รับเครดิตส่วนลด ${fmtLAK(amountLak)} กีบ จากการสมัครผ่านรหัสแนะนำเพื่อน\n` +
      `ใช้เป็นส่วนลดในการส่งครั้งถัดไปได้เลย ขอบคุณที่ไว้วางใจ SNG Express 🙏`,
  },
  REFERRER_CREDIT: {
    lo: ({ amountLak, counterpartName }) =>
      `🎉 ໝູ່ທີ່ທ່ານແນະນຳ${counterpartName ? ` (${counterpartName})` : ''} ສົ່ງພັດສະດຸງານທຳອິດສຳເລັດແລ້ວ!\n` +
      `ທ່ານໄດ້ຮັບເຄຣດິດສ່ວນຫຼຸດ ${fmtLAK(amountLak)} ກີບ ເປັນຂອງຂວັນຂອບໃຈຈາກ SNG Express\n` +
      `ນຳໄປໃຊ້ເປັນສ່ວນຫຼຸດການສົ່ງເທື່ອຕໍ່ໄປໄດ້ເລີຍ 🙏`,
    th: ({ amountLak, counterpartName }) =>
      `🎉 เพื่อนที่คุณแนะนำ${counterpartName ? ` (${counterpartName})` : ''} ส่งพัสดุงานแรกสำเร็จแล้ว!\n` +
      `คุณได้รับเครดิตส่วนลด ${fmtLAK(amountLak)} กีบ เป็นของขวัญขอบคุณจาก SNG Express\n` +
      `ใช้เป็นส่วนลดในการส่งครั้งถัดไปได้เลย 🙏`,
  },
});

const STAGE_BY_EVENT = {
  'REFERRAL_REWARD:REFERRED_CREDIT': 'REFERRED_CREDIT',
  'REFERRAL_REWARD:REFERRER_CREDIT': 'REFERRER_CREDIT',
};

export function buildReferralRewardMessage(eventType, payload = {}, recipientPhone = '') {
  const stage = STAGE_BY_EVENT[eventType];
  if (!stage) return null;
  const lang = isLaoPhone(recipientPhone) ? 'lo' : 'th';
  return TEMPLATES[stage][lang](payload);
}

export async function sendReferralRewardNotification(row) {
  const recipient = row.recipient || null;
  if (!recipient) return { skipped: true, reason: 'no recipient' };

  const phone = toWaPhone(recipient);
  if (!phone) return { skipped: true, reason: 'invalid phone' };

  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload || '{}') : (row.payload || {});
  const text = buildReferralRewardMessage(row.event_type, payload, phone);
  if (!text) return { skipped: true, reason: `No template for ${row.event_type}` };

  const { sendTextMessage } = await import('./whatsappService.js');
  return sendTextMessage(recipient, text);
}
