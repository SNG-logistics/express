import { getQr, getStatus, getLastError, restartClient } from '../services/whatsappService.js';

export function showStatus(req, res) {
    res.render('whatsapp/index', {
        title: 'WhatsApp Connection Manager',
        user: req.session.user
    });
}

export function getStatusApi(req, res) {
    res.json({
        status: getStatus(),
        qr: getQr(),
        error: getLastError()
    });
}

export async function restartApi(req, res) {
    await restartClient();
    res.json({ success: true, message: 'Restarting client...' });
}
