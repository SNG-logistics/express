
import pool from '../config/db.js';
import { toWaPhone } from '../utils/waPhone.js';

import pino from 'pino';
import { classifyDisconnect } from './whatsappDisconnect.js';

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
// CONFLICT counts as down and deliberately never clears on its own: the
// service stops reconnecting there, so without the alert the outbox would
// quietly stop delivering with nothing on screen to say why.
const DOWN_STATUSES = new Set(['DISCONNECTED', 'ERROR', 'CONFLICT']);
setInterval(() => {
    const isDown = DOWN_STATUSES.has(connectionStatus);
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

/**
 * Both paths are absolute, and every reader and writer uses these constants.
 *
 * Baileys was previously handed the bare string 'auth_info_baileys', which it
 * resolves against process.cwd(), while every place that CLEARS the session
 * used __dirname. Those agree only when the app happens to be started from the
 * project root — Passenger and pm2 do not set the same working directory — so
 * credentials could be written to one folder while "Delete session" emptied
 * another, and the reset button appeared to do nothing at all.
 */
const AUTH_PATH = path.join(__dirname, '../../auth_info_baileys');
const DISABLE_FLAG_PATH = path.join(__dirname, '../../DISABLE_WHATSAPP');

const isDisabled = () => fs.existsSync(DISABLE_FLAG_PATH);

function clearAuthFolder(reason) {
    try {
        if (fs.existsSync(AUTH_PATH)) {
            fs.rmSync(AUTH_PATH, { recursive: true, force: true });
            addLog(`Auth directory cleared (${reason}).`);
        }
    } catch (err) {
        addLog('Error clearing auth dir: ' + err.message);
    }
}

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

    clearAuthFolder('manual delete');

    // Wait and restart
    await new Promise(resolve => setTimeout(resolve, 2000));
    startSock();
};

async function startSock() {
    if (isDisabled()) {
        addLog('Start skipped: Service is manually disabled.');
        connectionStatus = 'DISABLED_MANUALLY';
        return;
    }

    addLog('Connecting to WhatsApp...');
    connectionStatus = 'CONNECTING';
    lastError = null;
    try {
        // Dynamic Import to save memory on startup
        const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');

        const { version } = await fetchLatestBaileysVersion();
        addLog(`Using WA version ${version.join('.')}`);
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

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
                const errMsg = lastDisconnect?.error?.message || lastDisconnect?.error?.description || lastDisconnect?.error?.toString() || 'Unknown';
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                // The decision itself lives in whatsappDisconnect.js, where it
                // can be tested; this block only carries it out.
                const plan = classifyDisconnect({
                    statusCode,
                    errorMessage: errMsg,
                    reconnectAttempts,
                    manuallyDisabled: isDisabled(),
                });

                console.log('[WhatsApp] Connection closed:', errMsg, '->', plan.action);
                isClientReady = false;
                qrCodeData = null;
                connectionStatus = plan.status;
                reconnectAttempts = plan.countsAsFailure ? reconnectAttempts + 1 : 0;

                if (plan.action === 'refresh-qr') {
                    addLog('QR หมดอายุ (ยังไม่สแกน) กำลังสร้าง QR ใหม่...');
                    lastError = null;
                } else if (plan.action === 'stand-down') {
                    // Scanning a new QR cannot fix this, so say what will.
                    console.warn('[WhatsApp] Session taken over by another client (440). Standing down.');
                    addLog('พบการเชื่อมต่อซ้ำ (conflict) — มีโปรแกรมอื่นใช้บัญชีนี้อยู่');
                    addLog('ตรวจว่ามีแอปรันซ้ำสองที่หรือไม่ (pm2 + Plesk/Passenger) แล้วกด Restart');
                    lastError = 'Session replaced by another client (conflict)';
                } else {
                    addLog(`Connection closed (${plan.action}). Error: ${errMsg}`);
                    lastError = errMsg || 'Connection Closed';
                }

                if (plan.clearAuth) {
                    clearAuthFolder(plan.action === 'reauthenticate' ? 'logged out' : 'repeated reconnect failures');
                    reconnectAttempts = 0;
                }

                if (plan.retryInMs !== null) setTimeout(startSock, plan.retryInMs);
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
if (!isDisabled()) {
    startSock(); // Enabled auto-start
} else {
    connectionStatus = 'DISABLED_MANUALLY';
    addLog('Auto-start skipped because it is disabled manually.');
}


export const restartClient = async () => {
    console.log('[WhatsApp] Restarting client...');
    addLog('Manual Restart requested...');
    try {
        if (isDisabled()) fs.unlinkSync(DISABLE_FLAG_PATH);
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
        fs.writeFileSync(DISABLE_FLAG_PATH, 'true');
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
                // The pin request rides on this message because this is the
                // moment the customer chooses between collecting the parcel and
                // having it delivered — and the distance from their pin is what
                // sets the delivery fee we quote them in the same breath.
                message = `📦 *SNG EXPRESS*\nພັດສະດຸ ${jobNo} ປາຍທາງຫາ ${receiverName} *ຮອດສຳນັກງານແລ້ວ*\nລູກຄ້າສາມາດມາຮັບເອງ ຫຼື ໃຫ້ໄລເດີ້ໄປສົ່ງກໍໄດ້ (ອາດມີຄ່າບໍລິການຕາມໄລຍະທາງ)\n\n📍 ຢາກໃຫ້ໄລເດີ້ໄປສົ່ງເຖິງບ້ານບໍ? ກົດ 📎 → ຕຳແໜ່ງ (Location) ແລ້ວສົ່ງມາໃນແຊັດນີ້ ເພື່ອໃຫ້ພວກເຮົາຄິດໄລ່ຄ່າສົ່ງໄດ້ຖືກຕ້ອງ\n\nສະຖານະ: ຕິດຕໍ່ແອດມິນໄດ້ເລີຍ${branchInfo}`;
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
