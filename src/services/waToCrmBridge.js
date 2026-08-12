/**
 * src/services/waToCrmBridge.js
 * Baileys → CRM Bridge
 *
 * Hooks into the active Baileys socket's `messages.upsert` event
 * and feeds inbound messages into the CRM channel service.
 *
 * Call attachCrmBridge(sock) once after the socket is connected.
 */

import { ingestInboundMessage } from './channelService.js';
import pool from '../config/db.js';

// Cached WHATSAPP channel DB record
let _waChannelId = null;

async function getWaChannelId() {
  if (_waChannelId) return _waChannelId;
  const [[row]] = await pool.query(`
    SELECT id FROM crm_channels WHERE channel_type = 'WHATSAPP' AND is_active = 1 LIMIT 1
  `);
  _waChannelId = row?.id || null;
  return _waChannelId;
}

/**
 * Attach CRM listener to a Baileys socket instance.
 * Call this after 'connection.update' emits connection === 'open'.
 */
export function attachCrmBridge(sock) {
  if (!sock) return;
  console.log('[WA→CRM] Attaching Baileys → CRM bridge');

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return; // Only process new inbound notifications

    for (const msg of messages) {
      try {
        // Skip: outbound messages we sent
        if (msg.key.fromMe) continue;
        // Skip: status messages (broadcast)
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const jid         = msg.key.remoteJid || '';
        const externalId  = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
        const isGroup     = jid.endsWith('@g.us');

        // Skip group messages for now (handle 1:1 chats only)
        if (isGroup) continue;

        // Extract message content
        const msgContent = msg.message;
        let contentText = null;
        let messageType = 'TEXT';
        let attachmentUrl = null;

        if (msgContent?.conversation) {
          contentText = msgContent.conversation;
        } else if (msgContent?.extendedTextMessage?.text) {
          contentText = msgContent.extendedTextMessage.text;
        } else if (msgContent?.imageMessage) {
          messageType = 'IMAGE';
          contentText = msgContent.imageMessage.caption || null;
          attachmentUrl = '[WhatsApp Image]';
        } else if (msgContent?.documentMessage) {
          messageType = 'FILE';
          contentText = msgContent.documentMessage.fileName || null;
          attachmentUrl = '[WhatsApp File]';
        } else if (msgContent?.audioMessage) {
          messageType = 'AUDIO';
          contentText = '[Voice Message]';
        } else if (msgContent?.videoMessage) {
          messageType = 'FILE';
          contentText = msgContent.videoMessage.caption || '[Video]';
        } else if (msgContent?.locationMessage) {
          messageType = 'LOCATION';
          const loc = msgContent.locationMessage;
          contentText = `📍 ${loc.degreesLatitude},${loc.degreesLongitude}`;
        } else if (msgContent?.stickerMessage) {
          messageType = 'STICKER';
          contentText = '[Sticker]';
        } else {
          // Unknown type — log and skip
          console.log(`[WA→CRM] Unhandled message type for ${jid}:`, Object.keys(msgContent || {}));
          continue;
        }

        // ── Rider job claim interceptor ───────────────────────────────────
        // If this message is a rider claiming a broadcast job, handle it here
        // and do NOT forward it to the CRM inbox.
        if (contentText) {
          try {
            const { tryClaimFromWhatsApp } = await import('./riderDispatchService.js');
            const claim = await tryClaimFromWhatsApp(externalId, contentText);
            if (claim.handled) {
              console.log(`[WA→Claim] ${externalId} claim handled (won=${claim.won})`);
              continue;
            }
          } catch (claimErr) {
            console.error('[WA→Claim] interceptor error:', claimErr.message);
          }
        }

        const displayName = msg.pushName || externalId;
        const waChannelId = await getWaChannelId();

        // Normalize phone for potential customer matching
        let phoneNormalized = externalId.replace(/\D/g, '');
        // Thai: starts with 66 → keep; starts with 0 → replace with 66
        if (phoneNormalized.startsWith('0') && phoneNormalized.length <= 10) {
          phoneNormalized = '66' + phoneNormalized.substring(1);
        }

        const result = await ingestInboundMessage({
          channelType: 'WHATSAPP',
          channelId: waChannelId,
          externalUserId: externalId,
          externalConversationId: jid,
          displayName,
          phoneNormalized,
          messageType,
          contentText,
          attachmentUrl,
          externalMessageId: msg.key.id,
        });

        if (result.duplicate) continue;

        console.log(`[WA→CRM] Ingested ${messageType} from ${displayName} → conv ${result.conversationId} (new: ${result.isNewConversation})`);

      } catch (err) {
        console.error('[WA→CRM] Error processing message:', err.message);
      }
    }
  });
}
