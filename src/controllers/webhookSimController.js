/**
 * src/controllers/webhookSimController.js
 * Webhook Simulator — for testing CRM channel ingestion WITHOUT real platform credentials.
 * Only available in non-production environments.
 *
 * Routes (mounted in src/routes/webhookSim.js):
 *   GET  /dev/webhook-sim          → UI to fire simulated messages
 *   POST /dev/webhook-sim/send     → injects a fake inbound message into CRM
 */

import { ingestInboundMessage } from '../services/channelService.js';

// ── GET /dev/webhook-sim ───────────────────────────────────────────────────────
export function simPage(req, res) {
  res.send(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CRM Webhook Simulator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #0f172a; color: #f1f5f9;
      min-height: 100vh; padding: 32px 16px;
    }
    .container { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 1.4rem; font-weight: 800; margin-bottom: 4px; color: #818cf8; }
    .badge { display: inline-block; background: rgba(239,68,68,0.15); color: #f87171;
             font-size: 0.65rem; font-weight: 700; padding: 2px 8px; border-radius: 999px;
             border: 1px solid rgba(239,68,68,0.3); margin-left: 6px; vertical-align: middle; }
    p.sub { font-size: 0.78rem; color: #64748b; margin-bottom: 24px; }
    .card { background: #1e293b; border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px; padding: 24px; margin-bottom: 20px; }
    label { display: block; font-size: 0.72rem; font-weight: 700; color: #94a3b8;
            text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
    input, select, textarea {
      width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; padding: 10px 12px; color: #f1f5f9; font-size: 0.85rem;
      font-family: inherit; outline: none; transition: border-color 0.2s;
    }
    input:focus, select:focus, textarea:focus { border-color: #818cf8; }
    select option { background: #1e293b; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .full { margin-bottom: 14px; }
    button {
      width: 100%; padding: 12px; background: linear-gradient(135deg,#4f46e5,#7c3aed);
      border: none; border-radius: 10px; color: #fff; font-size: 0.9rem; font-weight: 700;
      cursor: pointer; transition: opacity 0.2s;
    }
    button:hover { opacity: 0.85; }
    .log { background: #0f172a; border: 1px solid rgba(255,255,255,0.06);
           border-radius: 10px; padding: 14px; font-family: monospace;
           font-size: 0.75rem; color: #94a3b8; min-height: 80px; white-space: pre-wrap;
           max-height: 300px; overflow-y: auto; margin-top: 14px; }
    .channels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
    .ch-btn { padding: 10px; border-radius: 8px; text-align: center; cursor: pointer;
              font-size: 0.78rem; font-weight: 700; border: 2px solid transparent;
              transition: all 0.15s; }
    .ch-fb { background: rgba(24,119,242,0.12); color: #60a5fa; border-color: rgba(24,119,242,0.3); }
    .ch-wa { background: rgba(37,211,102,0.12); color: #34d399; border-color: rgba(37,211,102,0.3); }
    .ch-line { background: rgba(0,185,0,0.12); color: #4ade80; border-color: rgba(0,185,0,0.3); }
    .ch-btn.active { border-width: 2px; filter: brightness(1.3); }
    .presets { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .preset-btn { padding: 4px 10px; border-radius: 6px; background: rgba(129,140,248,0.12);
                  color: #a5b4fc; border: 1px solid rgba(129,140,248,0.2);
                  font-size: 0.72rem; cursor: pointer; font-family: inherit; }
    .preset-btn:hover { background: rgba(129,140,248,0.2); }
  </style>
</head>
<body>
<div class="container">
  <h1>🧪 CRM Webhook Simulator <span class="badge">DEV ONLY</span></h1>
  <p class="sub">จำลองข้อความขาเข้าจาก Facebook / WhatsApp / LINE เข้า CRM Inbox โดยไม่ต้องมี credentials จริง</p>

  <div class="card">
    <label>เลือก Channel</label>
    <div class="channels">
      <div class="ch-btn ch-fb active" id="ch-FACEBOOK" onclick="selectChannel('FACEBOOK')">
        🔵 Facebook
      </div>
      <div class="ch-btn ch-wa" id="ch-WHATSAPP" onclick="selectChannel('WHATSAPP')">
        🟢 WhatsApp
      </div>
      <div class="ch-btn ch-line" id="ch-LINE_OA" onclick="selectChannel('LINE_OA')">
        🟩 LINE OA
      </div>
    </div>

    <div class="row">
      <div>
        <label>External User ID (Sender)</label>
        <input type="text" id="externalUserId" value="sim_user_001" placeholder="PSID / WA JID / LINE UID">
      </div>
      <div>
        <label>Display Name</label>
        <input type="text" id="displayName" value="ลูกค้าทดสอบ">
      </div>
    </div>

    <div class="full">
      <label>ข้อความ</label>
      <textarea id="contentText" rows="3" placeholder="พิมพ์ข้อความที่จะส่งเข้า CRM...">ของผมถึงไหนแล้วครับ?</textarea>
      <div class="presets">
        <button class="preset-btn" onclick="setMsg('ของถึงไหนแล้วครับ?')">ถามสถานะ</button>
        <button class="preset-btn" onclick="setMsg('ราคาส่งไปลาวเท่าไหร่ครับ')">ถามราคา</button>
        <button class="preset-btn" onclick="setMsg('COD จ่ายยังไงครับ')">ถาม COD</button>
        <button class="preset-btn" onclick="setMsg('สวัสดีครับ อยากสั่งของ')">ทักทาย</button>
        <button class="preset-btn" onclick="setMsg('ของหายครับ ร้องเรียนด่วน')">ร้องเรียน</button>
      </div>
    </div>

    <div class="row">
      <div>
        <label>Message Type</label>
        <select id="messageType">
          <option value="TEXT">TEXT</option>
          <option value="IMAGE">IMAGE</option>
          <option value="FILE">FILE</option>
          <option value="LOCATION">LOCATION</option>
          <option value="STICKER">STICKER</option>
        </select>
      </div>
      <div>
        <label>Phone (optional)</label>
        <input type="text" id="phoneNormalized" placeholder="6681234567">
      </div>
    </div>

    <button onclick="sendSim()">⚡ ส่งข้อความเข้า CRM Inbox</button>

    <div class="log" id="logBox">// Log จะแสดงที่นี่...</div>
  </div>

  <div class="card" style="font-size:0.78rem;color:#94a3b8;line-height:1.8;">
    <div style="font-weight:700;color:#818cf8;margin-bottom:8px;">📋 วิธีใช้</div>
    1. เลือก Channel ที่ต้องการจำลอง<br>
    2. ใส่ External User ID (อะไรก็ได้ ใช้ทดสอบ)<br>
    3. พิมพ์ข้อความ หรือกดปุ่ม Preset<br>
    4. กด "ส่งข้อความเข้า CRM Inbox"<br>
    5. เปิด <a href="/crm/inbox" style="color:#818cf8;">/crm/inbox</a> เพื่อดูผล<br>
    <br>
    <strong style="color:#fbbf24;">⚠️ หน้านี้ใช้ได้เฉพาะ development mode เท่านั้น</strong>
  </div>
</div>

<script>
let selectedChannel = 'FACEBOOK';

function selectChannel(ch) {
  selectedChannel = ch;
  document.querySelectorAll('.ch-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('ch-' + ch).classList.add('active');
}

function setMsg(text) {
  document.getElementById('contentText').value = text;
}

function log(text, color = '#94a3b8') {
  const box = document.getElementById('logBox');
  const ts = new Date().toLocaleTimeString('th-TH');
  box.innerHTML += '<span style="color:' + color + '">[' + ts + '] ' + text + '\\n</span>';
  box.scrollTop = box.scrollHeight;
}

async function sendSim() {
  const payload = {
    channelType:    selectedChannel,
    externalUserId: document.getElementById('externalUserId').value.trim(),
    displayName:    document.getElementById('displayName').value.trim(),
    contentText:    document.getElementById('contentText').value.trim(),
    messageType:    document.getElementById('messageType').value,
    phoneNormalized: document.getElementById('phoneNormalized').value.trim() || null,
  };

  if (!payload.externalUserId || !payload.contentText) {
    log('❌ กรุณากรอก User ID และข้อความ', '#f87171');
    return;
  }

  log('→ กำลังส่ง [' + payload.channelType + '] จาก ' + payload.displayName + ': "' + payload.contentText + '"');

  try {
    const res = await fetch('/dev/webhook-sim/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      log('✅ สำเร็จ! conversationId=' + data.conversationId + ' (new=' + data.isNewConversation + ', newCustomer=' + data.isNewCustomer + ')', '#34d399');
      log('   → เปิด /crm/inbox/' + data.conversationId + ' เพื่อดู', '#818cf8');
    } else {
      log('❌ Error: ' + (data.error || 'unknown'), '#f87171');
    }
  } catch (err) {
    log('❌ Network error: ' + err.message, '#f87171');
  }
}
</script>
</body>
</html>`);
}

// ── POST /dev/webhook-sim/send ─────────────────────────────────────────────────
export async function simSend(req, res) {
  try {
    const {
      channelType = 'FACEBOOK',
      externalUserId,
      displayName,
      contentText,
      messageType = 'TEXT',
      phoneNormalized,
    } = req.body;

    if (!externalUserId || !contentText) {
      return res.status(400).json({ ok: false, error: 'Missing externalUserId or contentText' });
    }

    const validChannels = ['FACEBOOK', 'WHATSAPP', 'LINE_OA'];
    if (!validChannels.includes(channelType)) {
      return res.status(400).json({ ok: false, error: 'Invalid channelType' });
    }

    // Use a simulated unique message ID to allow repeated sends
    const externalMessageId = `sim_${channelType}_${externalUserId}_${Date.now()}`;

    const result = await ingestInboundMessage({
      channelType,
      channelId:              null, // no real channel record needed for sim
      externalUserId,
      externalConversationId: `sim_conv_${externalUserId}_${channelType}`,
      displayName:            displayName || `Sim User (${channelType})`,
      phoneNormalized:        phoneNormalized || null,
      messageType,
      contentText,
      attachmentUrl:          null,
      externalMessageId,
    });

    console.log(`[SIM] Injected ${channelType} message from ${displayName} → conv ${result.conversationId}`);
    return res.json({ ok: true, ...result });

  } catch (err) {
    console.error('[SIM] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
