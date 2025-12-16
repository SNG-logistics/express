
import pool from '../config/db.js';

import pino from 'pino';

// Variables to hold state
let sock;
let isClientReady = false;
let qrCodeData = null;
let connectionStatus = 'DISCONNECTED';
let lastError = null;
let reconnectAttempts = 0;

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
                    setTimeout(startSock, 2000);
                }
            } else if (connection === 'open') {
                console.log('[WhatsApp] Connection opened');
                addLog('Connection opened/Active');
                connectionStatus = 'CONNECTED';
                isClientReady = true;
                qrCodeData = null;
                lastError = null;
                reconnectAttempts = 0;
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
// startSock(); // Disabled auto-start to prevent OOM on low-memory server


export const restartClient = async () => {
    console.log('[WhatsApp] Restarting client...');
    addLog('Manual Restart requested...');
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

/**
 * Service to handle WhatsApp notifications using Baileys
 */
export async function sendOrderUpdate(orderId, newStatus) {
    if (!isClientReady || !sock) {
        console.log('[WhatsApp] Client not ready or socket null. Message skipped.');
        return;
    }

    try {
        // 1. Fetch Request Details
        const [[order]] = await pool.query(
            `SELECT o.*, 
              r.name as receiver_name, r.phone as receiver_phone,
              s.name as sender_name, s.phone as sender_phone
       FROM orders o
       LEFT JOIN customers r ON r.id = o.receiver_id
       LEFT JOIN customers s ON s.id = o.sender_id
       WHERE o.id = ?`,
            [orderId]
        );

        if (!order) return;

        // 2. Determine Receiver
        let phone = order.receiver_phone || order.sender_phone;
        if (!phone) {
            console.log(`[WhatsApp] No phone number found for Order ${order.job_no}`);
            return;
        }

        // Clean phone number (basic)
        phone = phone.replace(/\D/g, '');
        // Note: Baileys expects international format without + or 00, e.g. 66812345678
        // User provided phone might be "081..." or "20..." (Laos). 
        // Simple logic: If starts with 0, replace with 66? Or handle both TH/LA?
        // SNG Logistics handles TH and LA.
        // Laos prefix 20, 30. Thai prefix 08, 09, 06.

        if (phone.startsWith('0')) {
            phone = '66' + phone.substring(1); // Assume TH if 0 leading
        } else if (phone.startsWith('20') || phone.startsWith('30')) {
            phone = '856' + phone; // Laos Country Code
            // Wait, Laos phones usually entered as 20xxxxxxxx? 
            // If user stores "209999999", we need to check if 856 is needed.
            // Usually Baileys needs complete country code.
            // If it starts with 20 and length is 10, it's likely Laos local format without 856?
            // Let's assume user data might need slight fix differently than Puppeteer version which relied on whatsapp-web.js smarts.
            // For safety, let's try to send to what we have, but append country code if missing on obvious patterns.
        }

        // Better approach for now: Use the number directly like whatsapp-web.js did, 
        // but Baileys is stricter.
        // Let's rely on the existing logic flow but format for JID.

        const jid = phone + '@s.whatsapp.net';

        // 3. Craft Message
        let message = '';
        const jobNo = order.job_no;

        switch (newStatus) {
            case 'RECEIVED_WH_TH':
                message = `📦 *SNG Logistics* \nພັດສະດຸລູກຄ້າ ${jobNo} ຮອດ **ສາງໄທ** ແລ້ວເຈົ້າ \nສະຖານະ: ຢູ່ລະຫວ່າງດຳເນິນການ`;
                break;
            case 'RECEIVED_WH_LA':
                message = `📦 *SNG Logistics* \nພັດສະດຸລູກຄ້າ ${jobNo} ຮອດ **ສາງລາວ** ແລ້ວເຈົ້າ \nສະຖານະ: ຢູ່ລະຫວ່າງດຳເນິນການ`;
                break;
            case 'AT_DEST_WH':
                message = `📦 *SNG Logistics* \nພັດສະດຸລູກຄ້າ ${jobNo} ຮອດ **ບໍລິສັດ SNG ກຳລັງຄັດແຍກພັດສະດຸ** \nສະຖານະ: ຢູ່ລະຫວ່າງດຳເນິນການ`;
                break;
            case 'OUT_FOR_DELIVERY':
                message = `🛵 *SNG Logistics* \nພັດສະດຸລູກຄ້າ ${jobNo} **ກຳລັງນຳຈ່າຍ** \nໄລເດີ້ກຳລັງອອກໄປສົ່ງຂອງໃຫ້ລູກຄ້າເດີ້ເຈົ້າ`;
                break;
            case 'DELIVERED':
                message = `✅ *SNG Logistics* \nພັດສະດຸລູກຄ້າ ${jobNo} **ສິນຄ້າຮອດມືລູກຄ້າຮຽບຮ້ອຍແລ້ວເດີ້** \nຂອບໃຈທີ່ໃຊ້ບໍລິການຂອງເຮົາ SNG`;
                break;
            default:
                return;
        }

        console.log(`[WhatsApp] Sending to ${jid}:`, message);

        await sock.sendMessage(jid, { text: message });

        console.log(`[WhatsApp] Sent to ${jid}`);

    } catch (err) {
        console.error('[WhatsApp Send Error]', err);
    }
}

