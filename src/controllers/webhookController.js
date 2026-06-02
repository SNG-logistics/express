/**
 * src/controllers/webhookController.js
 * Facebook Messenger + LINE OA webhook handlers
 *
 * Facebook Messenger webhook:
 *   GET  /webhooks/facebook         — verification challenge
 *   POST /webhooks/facebook         — inbound messages (X-Hub-Signature-256 verified)
 *
 * LINE OA webhook:
 *   POST /webhooks/line             — inbound messages (HMAC-SHA256 signature verified)
 */

import crypto from 'crypto';
import pool from '../config/db.js';
import { ingestInboundMessage } from '../services/channelService.js';

// ── Facebook ──────────────────────────────────────────────────────────────────

/**
 * Verify Facebook X-Hub-Signature-256 header.
 * Protects against spoofed webhook calls.
 */
function verifyFacebookSignature(rawBody, signature) {
  const appSecret = process.env.FB_APP_SECRET;
  if (!appSecret || !signature) return true; // skip if not configured
  if (!signature.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Simple in-memory profile cache to avoid hitting Graph API repeatedly
const _fbProfileCache = new Map();
const FB_PROFILE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchFbProfile(psid, token) {
  const cached = _fbProfileCache.get(psid);
  if (cached && Date.now() - cached.at < FB_PROFILE_CACHE_TTL) {
    return cached.data;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${psid}?fields=name,profile_pic&access_token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    if (data.name) {
      _fbProfileCache.set(psid, { data, at: Date.now() });
      return data;
    }
  } catch {}
  return null;
}

/**
 * GET /webhooks/facebook
 * Facebook sends a GET to verify the webhook endpoint.
 */
export function facebookVerify(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected  = process.env.FB_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expected) {
    console.log('[Webhook/FB] Verified OK');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook/FB] Verification FAILED — token mismatch');
  return res.sendStatus(403);
}

/**
 * POST /webhooks/facebook
 * Processes inbound Messenger events.
 */
export async function facebookInbound(req, res) {
  // Always reply 200 fast — FB will retry on timeout
  res.sendStatus(200);

  // Verify App Secret signature (if FB_APP_SECRET is set)
  const signature = req.headers['x-hub-signature-256'];
  const rawBody   = req.rawBody || JSON.stringify(req.body);
  if (process.env.FB_APP_SECRET && !verifyFacebookSignature(rawBody, signature)) {
    console.warn('[Webhook/FB] Invalid signature — request ignored');
    return;
  }

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of (body.entry || [])) {
    const pageId = entry.id;

    // Look up channel record in DB
    const [[channel]] = await pool.query(`
      SELECT * FROM crm_channels WHERE channel_type = 'FACEBOOK' AND external_account_id = ? AND is_active = 1 LIMIT 1
    `, [pageId]).catch(() => [[null]]);
    if (!channel) {
      console.warn(`[Webhook/FB] No active channel for page_id=${pageId}`);
      continue;
    }

    for (const messaging of (entry.messaging || [])) {
      const { sender, message, postback } = messaging;
      if (!sender?.id) continue;

      // Skip echo (page messaging itself)
      if (sender.id === pageId) continue;

      let contentText   = null;
      let messageType   = 'TEXT';
      let attachmentUrl = null;
      let externalMsgId = message?.mid;

      if (message) {
        if (message.is_echo) continue;
        if (message.text) {
          contentText = message.text;
        } else if (message.attachments?.length) {
          const att   = message.attachments[0];
          const aType = (att.type || 'file').toUpperCase();
          messageType   = ['IMAGE','AUDIO','VIDEO','FILE'].includes(aType) ? aType : 'FILE';
          attachmentUrl = att.payload?.url || null;
          contentText   = att.title || `[${messageType}]`;
        }
      } else if (postback) {
        contentText   = postback.title || postback.payload || '[Postback]';
        messageType   = 'TEXT';
        externalMsgId = null;
      } else {
        continue; // delivery receipt, read, typing indicator — skip
      }

      if (!contentText && !attachmentUrl) continue;

      // Fetch sender profile (cached)
      const token       = channel.access_token_encrypted;
      const profile     = await fetchFbProfile(sender.id, token);
      const displayName = profile?.name || 'FB User ' + String(sender.id).slice(-6);
      const avatarUrl   = profile?.profile_pic || null;

      console.log(`[Webhook/FB] Inbound from "${displayName}": ${(contentText || messageType).slice(0, 60)}`);

      await ingestInboundMessage({
        channelType:            'FACEBOOK',
        channelId:              channel.id,
        externalUserId:         sender.id,
        externalConversationId: sender.id,
        displayName,
        avatarUrl,
        messageType,
        contentText,
        attachmentUrl,
        externalMessageId:      externalMsgId,
      }).catch(err => console.error('[Webhook/FB] ingest error:', err.message));
    }
  }
}

// ── LINE OA ────────────────────────────────────────────────────────────────────

/**
 * Verify LINE X-Line-Signature (HMAC-SHA256 of raw body using channel secret).
 */
function verifyLineSignature(rawBody, signature, channelSecret) {
  const hash = crypto.createHmac('SHA256', channelSecret).update(rawBody).digest('base64');
  return hash === signature;
}

/**
 * POST /webhooks/line
 * Processes inbound LINE OA events.
 */
export async function lineInbound(req, res) {
  res.sendStatus(200); // Always ack immediately

  const signature = req.headers['x-line-signature'];
  const rawBody   = req.rawBody || JSON.stringify(req.body);

  const body = req.body;
  if (!body.events?.length) return;

  // Look up channel by LINE destination (bot UID)
  const lineDestination = body.destination;
  const [[channel]] = await pool.query(`
    SELECT * FROM crm_channels
    WHERE channel_type = 'LINE_OA'
      AND external_account_id = ?
      AND is_active = 1
    LIMIT 1
  `, [lineDestination]).catch(() => [[null]]);

  if (!channel) {
    console.warn(`[Webhook/LINE] No active channel for destination=${lineDestination}`);
    return;
  }

  // Verify signature
  if (signature && channel.webhook_secret) {
    if (!verifyLineSignature(rawBody, signature, channel.webhook_secret)) {
      console.warn('[Webhook/LINE] Signature mismatch — ignoring');
      return;
    }
  }

  for (const event of body.events) {
    if (event.source?.type !== 'user') continue; // only 1:1 chats for now

    const userId = event.source.userId;
    let contentText   = null;
    let messageType   = 'TEXT';
    let attachmentUrl = null;
    let externalMsgId = event.message?.id;

    if (event.type === 'message') {
      const m = event.message;
      switch (m.type) {
        case 'text':
          contentText = m.text;
          break;
        case 'image':
          messageType = 'IMAGE';
          contentText = '[LINE Image]';
          break;
        case 'file':
          messageType = 'FILE';
          contentText = m.fileName || '[LINE File]';
          break;
        case 'audio':
          messageType = 'AUDIO';
          contentText = '[Voice Message]';
          break;
        case 'video':
          messageType = 'FILE';
          contentText = '[LINE Video]';
          break;
        case 'location':
          messageType = 'LOCATION';
          contentText = `[Location] ${m.address || (m.latitude + ',' + m.longitude)}`;
          break;
        case 'sticker':
          messageType = 'STICKER';
          contentText = '[Sticker]';
          break;
        default:
          continue;
      }
    } else if (event.type === 'follow') {
      contentText = '[ผู้ใช้ Follow LINE OA]';
    } else if (event.type === 'postback') {
      contentText = event.postback?.data || '[Postback]';
    } else {
      continue;
    }

    // Fetch LINE user profile
    let displayName = 'LINE User ' + userId.slice(-6);
    let avatarUrl   = null;
    try {
      const token = channel.access_token_encrypted;
      const prof = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }).then(r => r.json());
      displayName = prof.displayName || displayName;
      avatarUrl   = prof.pictureUrl  || null;
    } catch {}

    console.log(`[Webhook/LINE] Inbound from "${displayName}": ${(contentText || messageType).slice(0, 60)}`);

    await ingestInboundMessage({
      channelType:            'LINE_OA',
      channelId:              channel.id,
      externalUserId:         userId,
      externalConversationId: userId,
      displayName,
      avatarUrl,
      messageType,
      contentText,
      attachmentUrl,
      externalMessageId:      externalMsgId,
    }).catch(err => console.error('[Webhook/LINE] ingest error:', err.message));
  }
}
