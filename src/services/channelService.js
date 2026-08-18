/**
 * src/services/channelService.js
 * Channel Integration Bridge
 *
 * Responsibilities:
 *  1. Match or create crm_customer + crm_customer_identity from a channel sender
 *  2. Match or open a crm_conversation
 *  3. Insert the inbound crm_message
 *  4. Calculate SLA due_at
 *  5. Run automation rules
 *  6. Emit Socket.io events to the inbox
 *
 * Called by:
 *  - webhookController (Facebook, LINE)
 *  - whatsappService bridge (Baileys inbound events)
 */

import pool from '../config/db.js';
import { runOnNewMessage, runOnNewConversation } from './automationService.js';

// ── io reference (set by app.js after Socket.io init) ────────────────────────
let _io = null;
export function setIo(io) { _io = io; }
export function getIo()   { return _io; }

// ── SLA helper ────────────────────────────────────────────────────────────────

async function calcSlaDueAt(queueId) {
  // Load SLA rule for queue (or default if no queue-specific rule)
  const [[rule]] = await pool.query(`
    SELECT * FROM crm_sla_rules
    WHERE is_active = 1 AND (queue_id = ? OR queue_id IS NULL)
    ORDER BY queue_id DESC LIMIT 1
  `, [queueId || null]);

  if (!rule) return null;

  const now = new Date();
  const dueAt = new Date(now.getTime() + rule.first_response_minutes * 60 * 1000);
  return dueAt;
}

// ── Identity matching ─────────────────────────────────────────────────────────

/**
 * Find or create a crm_customer + crm_customer_identity.
 * Returns { crmCustomerId, isNew }
 */
export async function resolveCustomerIdentity({ channelType, channelId, externalUserId, displayName, avatarUrl, phoneNormalized }) {
  // 1. Try to find existing identity
  const [[existing]] = await pool.query(`
    SELECT ci.*, cc.id AS crm_customer_id
    FROM crm_customer_identities ci
    JOIN crm_customers cc ON cc.id = ci.crm_customer_id
    WHERE ci.channel_type = ? AND ci.external_user_id = ?
    LIMIT 1
  `, [channelType, externalUserId]);

  if (existing) {
    // Update display name / avatar if changed
    if (displayName || avatarUrl) {
      await pool.query(`
        UPDATE crm_customer_identities
        SET external_display_name = COALESCE(?, external_display_name),
            external_avatar_url   = COALESCE(?, external_avatar_url)
        WHERE id = ?
      `, [displayName || null, avatarUrl || null, existing.id]);
    }
    return { crmCustomerId: existing.crm_customer_id, isNew: false };
  }

  // 2. Try to match by phone number (if we have it)
  let crmCustomerId = null;
  if (phoneNormalized) {
    const [[byPhone]] = await pool.query(`
      SELECT crm_customer_id FROM crm_customer_identities
      WHERE phone_normalized = ?
      LIMIT 1
    `, [phoneNormalized]);
    if (byPhone) crmCustomerId = byPhone.crm_customer_id;
  }

  // 3. Create new crm_customer if no match
  let isNew = false;
  if (!crmCustomerId) {
    let fullName = displayName || `ลูกค้า ${channelType}`;
    if (fullName.includes('@lid') || fullName.includes('@s.whatsapp.net')) {
      fullName = phoneNormalized ? `+${phoneNormalized}` : `ลูกค้า ${channelType}`;
    }
    const [r] = await pool.query(`
      INSERT INTO crm_customers (full_name, phone, customer_type)
      VALUES (?, ?, 'CUSTOMER')
    `, [fullName, phoneNormalized || null]);
    crmCustomerId = r.insertId;
    isNew = true;
  }

  // 4. Create identity record
  await pool.query(`
    INSERT INTO crm_customer_identities
      (crm_customer_id, channel_type, channel_id, external_user_id,
       external_display_name, external_avatar_url, phone_normalized, is_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      external_display_name = COALESCE(VALUES(external_display_name), external_display_name),
      external_avatar_url   = COALESCE(VALUES(external_avatar_url), external_avatar_url)
  `, [
    crmCustomerId, channelType, channelId || null, externalUserId,
    displayName || null, avatarUrl || null, phoneNormalized || null,
  ]);

  return { crmCustomerId, isNew };
}

// ── Conversation matching ─────────────────────────────────────────────────────

/**
 * Find an existing OPEN/PENDING conversation for this customer+channel,
 * or open a new one.
 */
export async function resolveConversation({ crmCustomerId, channelType, channelId, externalConversationId }) {
  // Look for open conversation on same channel (last 30 days)
  const [[existing]] = await pool.query(`
    SELECT * FROM crm_conversations
    WHERE crm_customer_id = ?
      AND channel_type = ?
      AND status IN ('OPEN','PENDING')
      AND (external_conversation_id = ? OR ? IS NULL)
      AND created_at > NOW() - INTERVAL 30 DAY
    ORDER BY last_message_at DESC LIMIT 1
  `, [crmCustomerId, channelType, externalConversationId || null, externalConversationId || null]);

  if (existing) return { conversation: existing, isNew: false };

  // Open a new conversation
  const slaAt = await calcSlaDueAt(null); // default queue SLA
  const [r] = await pool.query(`
    INSERT INTO crm_conversations
      (crm_customer_id, channel_type, channel_id, external_conversation_id,
       status, priority, first_message_at, last_message_at, sla_due_at)
    VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL', NOW(), NOW(), ?)
  `, [crmCustomerId, channelType, channelId || null, externalConversationId || null, slaAt]);

  const [[conv]] = await pool.query(`SELECT * FROM crm_conversations WHERE id = ?`, [r.insertId]);
  return { conversation: conv, isNew: true };
}

// ── Message ingestion ─────────────────────────────────────────────────────────

/**
 * Main entry point — ingest an inbound message from any channel.
 * Returns { conversationId, messageId, isNewConversation, isNewCustomer }
 */
export async function ingestInboundMessage({
  channelType,           // 'FACEBOOK' | 'WHATSAPP' | 'LINE_OA'
  channelId,             // crm_channels.id
  externalUserId,        // Sender's channel-specific ID
  externalConversationId,// Channel's thread/conversation ID (optional)
  displayName,           // Sender's display name
  avatarUrl,             // Sender's avatar URL
  phoneNormalized,       // Normalized phone number if known
  messageType = 'TEXT',  // 'TEXT' | 'IMAGE' | 'FILE' | etc.
  contentText,           // Message text content
  attachmentUrl,         // File/image URL if applicable
  externalMessageId,     // Channel's message ID (for dedup)
}) {
  // Dedup: skip if we already have this external message
  if (externalMessageId) {
    const [[dup]] = await pool.query(`
      SELECT id FROM crm_messages WHERE external_message_id = ? LIMIT 1
    `, [externalMessageId]);
    if (dup) return { duplicate: true };
  }

  // 1. Resolve customer
  const { crmCustomerId, isNew: isNewCustomer } = await resolveCustomerIdentity({
    channelType, channelId, externalUserId, displayName, avatarUrl, phoneNormalized,
  });

  // 2. Resolve conversation
  const { conversation, isNew: isNewConversation } = await resolveConversation({
    crmCustomerId, channelType, channelId, externalConversationId,
  });

  // 3. Insert message
  const [msgResult] = await pool.query(`
    INSERT INTO crm_messages
      (conversation_id, sender_type, sender_name, message_type,
       content_text, attachment_url, external_message_id)
    VALUES (?, 'CUSTOMER', ?, ?, ?, ?, ?)
  `, [
    conversation.id,
    displayName || `ลูกค้า ${channelType}`,
    messageType,
    contentText || null,
    attachmentUrl || null,
    externalMessageId || null,
  ]);

  // 4. Update conversation timestamps
  await pool.query(`
    UPDATE crm_conversations
    SET last_message_at = NOW(),
        first_message_at = COALESCE(first_message_at, NOW()),
        status = IF(status = 'RESOLVED', 'OPEN', status)
    WHERE id = ?
  `, [conversation.id]);

  // 5. Emit Socket.io events
  if (_io) {
    const payload = {
      conversationId: conversation.id,
      customerId: crmCustomerId,
      channelType,
      messageType,
      contentText,
      senderName: displayName,
      isNewConversation,
      at: new Date().toISOString(),
    };
    _io.to('crm:inbox').emit('crm:new_message', payload);
    if (isNewConversation) {
      _io.to('crm:inbox').emit('crm:new_conversation', payload);
    }
    console.log(`[CHANNEL] Socket emit crm:new_message conv=${conversation.id}`);
  }

  // 6. Run automation (non-blocking)
  setImmediate(async () => {
    try {
      if (isNewConversation) {
        await runOnNewConversation(conversation, _io);
      }
      await runOnNewMessage(conversation, contentText || '', _io);
    } catch (err) {
      console.error('[CHANNEL] Automation error:', err.message);
    }
  });

  return {
    conversationId: conversation.id,
    messageId: msgResult.insertId,
    isNewConversation,
    isNewCustomer,
    duplicate: false,
  };
}

// ── Outbound send helpers ─────────────────────────────────────────────────────

/**
 * Send a reply back through the correct channel.
 * Called by crmController.sendMessage after inserting the crm_message.
 */
export async function sendOutbound({ conversationId, text }) {
  const [[conv]] = await pool.query(`
    SELECT c.*, ci.external_user_id, ch.channel_type AS ch_type
    FROM crm_conversations c
    LEFT JOIN crm_customer_identities ci
      ON ci.crm_customer_id = c.crm_customer_id AND ci.channel_type = c.channel_type
    LEFT JOIN crm_channels ch ON ch.id = c.channel_id
    WHERE c.id = ?
    LIMIT 1
  `, [conversationId]);

  if (!conv) return { sent: false, reason: 'conversation_not_found' };

  switch (conv.channel_type) {
    case 'WHATSAPP':
      return sendWhatsApp(conv.external_user_id, text);
    case 'FACEBOOK':
      return sendFacebook(conv.external_user_id, text, conv.channel_id);
    case 'LINE_OA':
      return sendLine(conv.external_user_id, text, conv.channel_id);
    default:
      return { sent: false, reason: 'unknown_channel' };
  }
}

async function sendWhatsApp(externalUserId, text) {
  try {
    const { getSock } = await import('./whatsappService.js');
    const sock = getSock();
    if (!sock) return { sent: false, reason: 'wa_not_connected' };

    let jid = String(externalUserId);
    if (!jid.includes('@')) {
      // Normalize: remove non-digits, ensure country code
      const phone = jid.replace(/\D/g, '');
      jid = phone + '@s.whatsapp.net';
    }
    await sock.sendMessage(jid, { text });
    return { sent: true };
  } catch (err) {
    console.error('[CHANNEL] sendWhatsApp error:', err.message);
    return { sent: false, reason: err.message };
  }
}

async function sendFacebook(psid, text, channelDbId) {
  try {
    const [[ch]] = await pool.query(`SELECT access_token_encrypted FROM crm_channels WHERE id = ?`, [channelDbId]);
    if (!ch?.access_token_encrypted) return { sent: false, reason: 'no_fb_token' };

    const token = ch.access_token_encrypted; // stored plaintext for now
    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
    });
    const data = await res.json();
    if (data.error) return { sent: false, reason: data.error.message };
    return { sent: true, messageId: data.message_id };
  } catch (err) {
    console.error('[CHANNEL] sendFacebook error:', err.message);
    return { sent: false, reason: err.message };
  }
}

async function sendLine(userId, text, channelDbId) {
  try {
    const [[ch]] = await pool.query(`SELECT access_token_encrypted FROM crm_channels WHERE id = ?`, [channelDbId]);
    if (!ch?.access_token_encrypted) return { sent: false, reason: 'no_line_token' };

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ch.access_token_encrypted}`,
      },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { sent: false, reason: err };
    }
    return { sent: true };
  } catch (err) {
    console.error('[CHANNEL] sendLine error:', err.message);
    return { sent: false, reason: err.message };
  }
}
