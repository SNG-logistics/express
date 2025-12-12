
import pool from '../config/db.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// Initialize Client with LocalAuth to save session
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-acceleration',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

let isClientReady = false;
let qrCodeData = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, QR_READY, CONNECTED, AUTHENTICATED, AUTH_FAILURE, ERROR

client.on('qr', (qr) => {
    console.log('[WhatsApp] QR Generated');
    qrCodeData = qr;
    connectionStatus = 'QR_READY';
});

client.on('ready', () => {
    console.log('[WhatsApp] Client is ready!');
    isClientReady = true;
    connectionStatus = 'CONNECTED';
    qrCodeData = null; // Clear QR when connected
});

client.on('authenticated', () => {
    console.log('[WhatsApp] Authenticated successfully!');
    connectionStatus = 'AUTHENTICATED';
});

client.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Authentication failure:', msg);
    connectionStatus = 'AUTH_FAILURE';
});

client.on('disconnected', (reason) => {
    console.log('[WhatsApp] Disconnected:', reason);
    isClientReady = false;
    connectionStatus = 'DISCONNECTED';
    qrCodeData = null;
    // Auto reconnect could go here
});

// Initialize the client
console.log('[WhatsApp] Initializing...');
client.initialize().catch(err => {
    console.error('[WhatsApp] Init Error:', err);
    connectionStatus = 'ERROR';
});

export const getQr = () => qrCodeData;
export const getStatus = () => connectionStatus;

export const restartClient = async () => {
    console.log('[WhatsApp] Restarting client...');
    try {
        await client.destroy();
        console.log('[WhatsApp] Client destroyed');
    } catch (e) { console.error('Error destroying client', e); }

    isClientReady = false;
    connectionStatus = 'DISCONNECTED';
    qrCodeData = null;

    // Wait a bit to ensure resources are freed
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        console.log('[WhatsApp] Re-initializing client...');
        await client.initialize();
    } catch (e) {
        console.error('Error re-initializing client', e);
        connectionStatus = 'ERROR';
    }
};

/**
 * Service to handle WhatsApp notifications using whatsapp-web.js
 */
export async function sendOrderUpdate(orderId, newStatus) {
    if (!isClientReady) {
        console.log('[WhatsApp] Client not ready. Message skipped.');
        return;
    }

    try {
        // 1. Fetch Request Details (Customer Phone, etc.)
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

        // 2. Determine Receiver (Default to Receiver, fall back to Sender)
        let phone = order.receiver_phone || order.sender_phone;
        if (!phone) {
            console.log(`[WhatsApp] No phone number found for Order ${order.job_no}`);
            return;
        }

        // Format phone number to standard format
        // phone = phone.replace(/\D/g, '');
        // if (phone.startsWith('0')) {
        //     phone = '66' + phone.substring(1);
        // }

        // 3. Craft Message based on Status
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
                // Other statuses ignored
                return;
        }

        // 4. Send Message
        // Ensure phone has correct suffix
        const chatId = phone.endsWith('@c.us') ? phone : `${phone}@c.us`;

        console.log(`[WhatsApp] Sending to ${chatId}:`, message); // Log content for verification
        await client.sendMessage(chatId, message);
        console.log(`[WhatsApp] Sent to ${chatId}`);

    } catch (err) {
        console.error('[WhatsApp Send Error]', err);
    }
}
