import { getQr, getStatus, getLastError, restartClient, stopClient, getLogs, deleteSession } from '../services/whatsappService.js';
import { requeueFailedNotifications } from '../services/notificationService.js';

export function showStatus(req, res) {
    res.render('whatsapp/index', {
        title: 'WhatsApp Connection Manager',
        user: req.session.user
    });
}

export async function stopApi(req, res) {
    await stopClient();
    res.json({ success: true, message: 'Stopping client...' });
}

export function getStatusApi(req, res) {
    res.json({
        status: getStatus(),
        qr: getQr(),
        error: getLastError(),
        logs: getLogs()
    });
}

export async function restartApi(req, res) {
    const requeued = await requeueFailedNotifications();
    await restartClient();
    res.json({ success: true, message: 'Restarting client...', requeued });
}

export async function logoutApi(req, res) {
    await deleteSession();
    res.json({ success: true, message: 'Session deleted. Restarting...' });
}
