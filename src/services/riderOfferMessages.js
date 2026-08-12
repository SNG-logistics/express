/**
 * src/services/riderOfferMessages.js
 * Pure WhatsApp message builders for the rider job broadcast/claim flow.
 * No side effects — returns strings only. Sending is done by the notification
 * worker via whatsappService.sendTextMessage.
 */

function fmtMoney(n) {
  const v = Number(n || 0);
  return v > 0 ? v.toLocaleString('en-US') : null;
}

/** Offer broadcast to each eligible rider's personal WhatsApp. */
export function offerMessage(p = {}) {
  const cod = fmtMoney(p.codAmount);
  const fee = fmtMoney(p.fee);
  const lines = [
    '🛵 *SNG EXPRESS — งานส่งใหม่!*',
    `📦 พัสดุ: *${p.jobNo || '-'}*`,
    p.receiverName ? `👤 ผู้รับ: ${p.receiverName}` : null,
    p.address ? `📍 ${String(p.address).slice(0, 120)}` : null,
    cod ? `💵 COD: ฿${cod}` : null,
    fee ? `🤑 ค่ารอบ: ฿${fee}` : null,
    p.branchName ? `🏪 สาขา: ${p.branchName}` : null,
    '',
    `👉 พิมพ์ *รับ ${p.claimCode}* เพื่อรับงานนี้`,
    'หรือกดรับในแอป SNG Rider',
    p.expiresMin ? `⏳ ใครกดก่อนได้ก่อน (หมดเวลาใน ${p.expiresMin} นาที)` : '⏳ ใครกดก่อนได้ก่อน',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Sent to the winner after a successful claim. */
export function wonMessage(p = {}) {
  return [
    '✅ *SNG EXPRESS — คุณได้รับงานนี้!*',
    `📦 พัสดุ: *${p.jobNo || '-'}*`,
    p.receiverName ? `👤 ผู้รับ: ${p.receiverName}` : null,
    p.address ? `📍 ${String(p.address).slice(0, 120)}` : null,
    '',
    'เปิดแอป SNG Rider เพื่อดูรายละเอียดและเริ่มงานได้เลย 🚀',
  ].filter(Boolean).join('\n');
}

/** Sent to the other riders once someone else has claimed the job. */
export function takenMessage(p = {}) {
  return [
    'ℹ️ *SNG EXPRESS*',
    `งาน *${p.jobNo || '-'}* ถูกไรเดอร์ท่านอื่นรับไปแล้ว`,
    'ขอบคุณที่สนใจ ไว้มีงานใหม่จะแจ้งอีกครั้ง 🙏',
  ].filter(Boolean).join('\n');
}

/** Sent to the branch when an offer expires with no rider claiming it. */
export function expiredMessage(p = {}) {
  return [
    '⚠️ *SNG EXPRESS — ไม่มีไรเดอร์รับงาน*',
    `พัสดุ *${p.jobNo || '-'}* ไม่มีไรเดอร์กดรับในเวลาที่กำหนด`,
    'กรุณาเข้าพอร์ทัลสาขาเพื่อมอบหมายไรเดอร์เอง',
  ].filter(Boolean).join('\n');
}
