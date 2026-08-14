
import pool from '../config/db.js';
import { toWaPhone } from '../utils/waPhone.js';

import pino from 'pino';

// Variables to hold state
let sock;
let isClientReady = false;
let qrCodeData = null;
let connectionStatus = 'DISCONNECTED';
let lastError = null;
let reconnectAttempts = 0;

// Tracks how long the connection has been stuck down, so callers (dashboard
// alert card) can distinguish a normal few-second reconnect blip from Baileys
// actually being dead — a snapshot of connectionStatus alone can't tell those
// apart since DISCONNECTED flashes briefly on every routine reconnect too.
let disconnectedSince = null;
setInterval(() => {
    const isDown = connectionStatus === 'DISCONNECTED' || connectionStatus === 'ERROR';
    if (isDown && !disconnectedSince) disconnectedSince = Date.now();
    if (!isDown) disconnectedSince = null;
}, 60 * 1000);

const logs = [];
function addLog(msg) {
    const timestamp = new Date().toLocaleTimeString();
    logs.unshift(`[${timestamp}] ${msg}`);
    if (logs.length > 50) logs.pop();
}

export const getQr = () => qrCodeData;
export const getStatus = () => connectionStatus;
export const getLastError = () => lastError;
export const getLogs = () => logs;
/** ms since the connection first went down, or null if currently fine. */
export const getDisconnectedSince = () => disconnectedSince;
/** Expose active Baileys socket for CRM outbound sending */
export const getSock = () => (isClientReady ? sock : null);

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const deleteSession = async () => {
    addLog('Deleting session and restarting...');
    try {
        if (sock) {
            sock.end(undefined);
            sock = null;
        }
    } catch (e) {
        addLog('Error closing socket: ' + e.message);
    }

    isClientReady = false;
    connectionStatus = 'DISCONNECTED';
    qrCodeData = null;

    // Remove auth folder
    const authPath = path.join(__dirname, '../../auth_info_baileys');
    try {
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            addLog('Auth directory deleted.');
        }
    } catch (e) {
        addLog('Error deleting auth dir: ' + e.message);
    }

    // Wait and restart
    await new Promise(resolve => setTimeout(resolve, 2000));
    startSock();
};

async function startSock() {
    const flagPath = path.join(__dirname, '../../DISABLE_WHATSAPP');
    if (fs.existsSync(flagPath)) {
        addLog('Start skipped: Service is manually disabled.');
        connectionStatus = 'DISABLED_MANUALLY';
        return;
    }

    addLog('Connecting to WhatsApp...');
    connectionStatus = 'CONNECTING';
    lastError = null;
    try {
        // Dynamic Import to save memory on startup
        const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');

        const { version } = await fetchLatestBaileysVersion();
        addLog(`Using WA version ${version.join('.')}`);
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        sock = makeWASocket({
            printQRInTerminal: false, // We handle QR in UI
            auth: state,
            logger: pino({ level: 'silent' }), // Suppress detailed logs
            browser: ['SNG Logistics', 'Chrome', '1.0.0'], // Simulate a browser
            version
        });

        // Event: Connection Update (QR, Connecting, Open, Close)
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('[WhatsApp] QR Generated');
                addLog('QR Generated (showing on UI)');
                qrCodeData = qr; // Raw QR string for UI to render
                connectionStatus = 'QR_READY';
                lastError = null;
                reconnectAttempts = 0; // reset on fresh QR
            }

            if (connection === 'close') {
                // Dynamic import makes DisconnectReason available here? 
                // Yes, it is in the same scope (try block of startSock).
                // But wait, makeWASocket returns sock.
                // sock.ev.on is called.
                // DisconnectReason comes from the destructuring at the top of the try block.
                // So it is available.
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('[WhatsApp] Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
                const errMsg = lastDisconnect?.error?.message || lastDisconnect?.error?.description || lastDisconnect?.error?.toString() || 'Unknown';
                addLog(`Connection closed. Reconnecting: ${shouldReconnect}. Error: ${errMsg}`);

                connectionStatus = 'DISCONNECTED';
                isClientReady = false;
                qrCodeData = null;
                lastError = errMsg || 'Connection Closed';
                reconnectAttempts += 1;

                // Reconnect if not logged out
                if (shouldReconnect) {
                    const flagPath = path.join(__dirname, '../../DISABLE_WHATSAPP');
                    if (fs.existsSync(flagPath)) {
                        addLog('Reconnect aborted: Service is manually disabled.');
                        return;
                    }

                    // After a few failed reconnects, clear auth to force a fresh QR
                    if (reconnectAttempts >= 3) {
                        try {
                            const authPath = path.join(__dirname, '../../auth_info_baileys');
                            if (fs.existsSync(authPath)) {
                                fs.rmSync(authPath, { recursive: true, force: true });
                                addLog('Cleared auth after repeated failures; will request new QR.');
                            }
                        } catch (err) {
                            addLog('Error clearing auth dir: ' + err.message);
                        }
                        reconnectAttempts = 0;
                    }
                    setTimeout(startSock, 5000); // Retry in 5s
                } else {
                    console.log('[WhatsApp] Logged out. Please scan QR again.');
                    addLog('Logged out. Clearing session and regenerating QR...');
                    try {
                        const authPath = path.join(__dirname, '../../auth_info_baileys');
                        if (fs.existsSync(authPath)) {
                            fs.rmSync(authPath, { recursive: true, force: true });
                            addLog('Auth directory cleared after logout.');
                        }
                    } catch (err) {
                        addLog('Error clearing auth dir: ' + err.message);
                    }
                    // Start fresh to emit a new QR
                    const flagPath = path.join(__dirname, '../../DISABLE_WHATSAPP');
                    if (!fs.existsSync(flagPath)) {
                        setTimeout(startSock, 2000);
                    }
                }
            } else if (connection === 'open') {
                console.log('[WhatsApp] Connection opened');
                addLog('Connection opened/Active');
                connectionStatus = 'CONNECTED';
                isClientReady = true;
                qrCodeData = null;
                lastError = null;
                reconnectAttempts = 0;

                // Attach CRM bridge — routes inbound WA messages to CRM inbox
                // Use .then() instead of await because this callback is not async
                import('./waToCrmBridge.js').then(({ attachCrmBridge }) => {
                    attachCrmBridge(sock);
                    addLog('CRM bridge attached — inbound WA messages will flow to inbox');
                }).catch(bridgeErr => {
                    console.warn('[WhatsApp] CRM bridge attach failed:', bridgeErr.message);
                });
                import('./notificationService.js').then(({ kickNotificationWorker }) => {
                    kickNotificationWorker();
                }).catch(workerErr => {
                    console.warn('[WhatsApp] Notification worker wake-up failed:', workerErr.message);
                });
            }
        });

        // Event: Credentials Update
        sock.ev.on('creds.update', saveCreds);

    } catch (err) {
        console.error('[WhatsApp] Start Error:', err);
        addLog('Start Error: ' + err.message);
        connectionStatus = 'ERROR';
        lastError = err.message || String(err);
    }
}

// Start the socket
console.log('[WhatsApp] Initializing Baileys...');
addLog('Initializing Service...');
const flagPath = path.join(__dirname, '../../DISABLE_WHATSAPP');
if (!fs.existsSync(flagPath)) {
    startSock(); // Enabled auto-start
} else {
    connectionStatus = 'DISABLED_MANUALLY';
    addLog('Auto-start skipped because it is disabled manually.');
}


export const restartClient = async () => {
    console.log('[WhatsApp] Restarting client...');
    addLog('Manual Restart requested...');
    try {
        const flagPath = path.join(__dirname, '../../DISABLE_WHATSAPP');
        if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
    } catch (e) {}
    try {
        sock?.end(undefined); // Close current socket
        sock = null;
    } catch (e) {
        console.error('Error closing socket', e);
    }

    isClientReady = false;
    connectionStatus = 'DISCONNECTED';
    qrCodeData = null;

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        console.log('[WhatsApp] Re-starting socket...');
        startSock();
    } catch (e) {
        console.error('Error re-starting socket', e);
        addLog('Error re-starting: ' + e.message);
        connectionStatus = 'ERROR';
        lastError = e.message;
    }
};

export const stopClient = async () => {
    console.log('[WhatsApp] Stopping client manually...');
    addLog('Service stopped manually.');
    try {
        const flagPath = path.join(__dirname, '../../DISABLE_WHATSAPP');
        fs.writeFileSync(flagPath, 'true');
    } catch (e) {}
    try {
        sock?.end(undefined);
        sock = null;
    } catch (e) {
        console.error('Error closing socket', e);
    }
    isClientReady = false;
    connectionStatus = 'DISABLED_MANUALLY';
    qrCodeData = null;
};

/**
 * Send an arbitrary text message to any phone number (TH/LA normalised).
 * Used by the rider job broadcast/claim flow via the notification worker.
 * Throws with code WHATSAPP_NOT_READY (so the outbox retries) when offline.
 */
export async function sendTextMessage(phoneRaw, text) {
  if (!isClientReady || !sock) {
    const error = new Error('WhatsApp client is not ready');
    error.code = 'WHATSAPP_NOT_READY';
    throw error;
  }
  const phone = toWaPhone(phoneRaw);
  if (!phone) return { skipped: true, reason: 'invalid phone' };
  const jid = phone + '@s.whatsapp.net';
  await sock.sendMessage(jid, { text });
  return { sent: true, recipient: phone };
}

/**
 * Service to handle WhatsApp notifications using Baileys
 */
export async function sendOrderUpdate(orderId, newStatus) {
    if (!isClientReady || !sock) {
        const error = new Error('WhatsApp client is not ready');
        error.code = 'WHATSAPP_NOT_READY';
        throw error;
    }

    try {
        // 1. Fetch Request Details
        const [[order]] = await pool.query(
            `SELECT o.*, 
              r.name as receiver_name, r.phone as receiver_phone,
              s.name as sender_name, s.phone as sender_phone,
              b.name as branch_name, b.phone as branch_phone
       FROM orders o
       LEFT JOIN customers r ON r.id = o.receiver_id
       LEFT JOIN customers s ON s.id = o.sender_id
       LEFT JOIN branches b ON b.id = o.dest_branch_id
       WHERE o.id = ?`,
            [orderId]
        );

        if (!order) return { skipped: true, reason: 'Order not found' };

        // 2. Determine Receiver
        let phone = order.receiver_phone || order.sender_phone;
        if (!phone) {
            console.log(`[WhatsApp] No phone number found for Order ${order.job_no}`);
            return { skipped: true, reason: 'Customer phone number is missing' };
        }

        // Same TH/LA normalisation used everywhere else (waPhone.js) — keeps
        // this path consistent with rider offer/reply matching instead of
        // re-guessing prefixes here.
        phone = toWaPhone(phone);
        if (!phone) {
            console.log(`[WhatsApp] Unusable phone number for Order ${order.job_no}`);
            return { skipped: true, reason: 'Customer phone number is invalid' };
        }

        const jid = phone + '@s.whatsapp.net';

        // 3. Craft Message
        let message = '';
        const jobNo = order.job_no;

        switch (newStatus) {
            case 'RECEIVED_WH_TH':
            case 'RECEIVED_WH_LA':
                message = `📦 *SNG EXPRESS*\nรับพัสดุ ${jobNo} เข้าคลังเรียบร้อยแล้ว สามารถติดตามสถานะได้จากระบบ SNG`;
                break;
            case 'ON_TRUCK':
                message = `🚚 *SNG EXPRESS*\nพัสดุ ${jobNo} ພັດສະດຸຂອງທ່ານໄດ້ນຳຂຶ້ນລົດແລ້ວ \nແລ້ວສິຮອດຈຸດຕໍ່ໄປໄວໆນີ້`;
                break;
            case 'CROSSING_BORDER':
                message = `🛂 *SNG EXPRESS*\nพัสดุ ${jobNo} กำลังผ่านขั้นตอนข้ามแดน`;
                break;
            case 'ARRIVED_BORDER_WH':
                message = `🏁 *SNG EXPRESS*\nພັດສະດຸ ${jobNo} **ຮອດດ່ານຊາຍແດນປາຍທາງແລ້ວ** \nກຳລັງດຳເນີນພິທີການ ລໍຖ້າໜ້ອຍໜຶ່ງ 🇱🇦`;
                break;
            case 'AT_DEST_WH': {
                const receiverName = order.receiver_name ? `ທ່ານ *${order.receiver_name}*` : 'ລູກຄ້າ';
                let branchInfo = '';
                if (order.branch_name) {
                    branchInfo = `\n(ສາຂາ: ${order.branch_name}${order.branch_phone ? ' ໂທ: ' + order.branch_phone : ''})`;
                }
                message = `📦 *SNG EXPRESS*\nພັດສະດຸ ${jobNo} ປາຍທາງຫາ ${receiverName} *ຮອດສຳນັກງານແລ້ວ*\nລູກຄ້າສາມາດມາຮັບເອງ ຫຼື ໃຫ້ໄລເດີ້ໄປສົ່ງກໍໄດ້ (ອາດມີຄ່າບໍລິການຕາມໄລຍະທາງ)\nສະຖານະ: ຕິດຕໍ່ແອດມິນໄດ້ເລີຍ${branchInfo}`;
                break;
            }
            case 'OUT_FOR_DELIVERY':
                message = `🚚 *SNG Logistics* \nພັດສະດຸ ${jobNo} **ກຳລັງນຳສົ່ງໄປຫາທ່ານ** \nລໍຖ້າຮັບໂທລະສັບຈາກໄລເດີ້ໄດ້ເລີຍເດີ້!`;
                break;
            case 'BRANCH_TRANSFER':
                message = `🏢 *SNG EXPRESS*\nพัสดุ ${jobNo} กำลังส่งต่อไปยังสาขาปลายทาง`;
                break;
            case 'BRANCH_RECEIVED':
                message = `🏢 *SNG EXPRESS*\nพัสดุ ${jobNo} ถึงสาขาปลายทางแล้ว และกำลังรอจัดส่ง`;
                break;
            case 'RIDER_ASSIGNED':
                message = `🛵 *SNG EXPRESS*\nพัสดุ ${jobNo} ได้รับการมอบหมายให้ไรเดอร์แล้ว`;
                break;
            case 'DELIVERED': {
                const rcvName = order.receiver_name ? `ທ່ານ *${order.receiver_name}*` : 'ລູກຄ້າ';
                message = `✅ *SNG Logistics*\nພັດສະດຸ ${jobNo} ຂອງ ${rcvName} *ສົ່ງຮອດມືແລ້ວ*\nຂອບໃຈທີ່ໃຊ້ບໍລິການ SNG Express 🙏`;
                break;
            }
            case 'DELIVERY_FAILED':
                message = `⚠️ *SNG EXPRESS*\nการนำส่งพัสดุ ${jobNo} ยังไม่สำเร็จ เจ้าหน้าที่จะติดต่อเพื่อดำเนินการอีกครั้ง`;
                break;
            case 'RETURN_TO_SENDER':
                message = `↩️ *SNG EXPRESS*\nพัสดุ ${jobNo} อยู่ระหว่างดำเนินการส่งคืนผู้ส่ง`;
                break;
            case 'SCREENING_CUSTOMS_REQUIRED':
                message = `🛡️ *SNG EXPRESS*\nพัสดุ ${jobNo} ต้องตรวจสอบเอกสารศุลกากรเพิ่มเติม เจ้าหน้าที่จะติดต่อกลับ`;
                break;
            case 'SCREENING_REJECTED':
                message = `⚠️ *SNG EXPRESS*\nพัสดุ ${jobNo} ไม่ผ่านการคัดกรอง กรุณารอเจ้าหน้าที่ติดต่อเพื่อแก้ไขหรือรับพัสดุคืน`;
                break;

            default:
                // ไม่ต้องแจ้งเตือนสถานะอื่น เพื่อไม่ให้รบกวนลูกค้ามากเกินไป
                return { skipped: true, reason: `No message template for ${newStatus}` };
        }

        console.log(`[WhatsApp] Sending to ${jid}:`, message);

        await sock.sendMessage(jid, { text: message });

        console.log(`[WhatsApp] Sent to ${jid}`);
        return { sent: true, recipient: phone };

    } catch (err) {
        console.error('[WhatsApp Send Error]', err);
        throw err;
    }
}
