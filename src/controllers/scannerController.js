import pool from '../config/db.js';

export async function showScanner(req, res) {
    try {
        // Get recent scan history for this user
        const [recentScans] = await pool.query(
            `SELECT o.id, o.job_no, o.status, o.updated_at,
              s.name AS sender_name, r.name AS receiver_name
       FROM orders o
       LEFT JOIN customers s ON o.sender_id = s.id
       LEFT JOIN customers r ON o.receiver_id = r.id
       ORDER BY o.updated_at DESC
       LIMIT 10`
        );

        res.render('orders/scan', {
            user: req.session.user,
            title: 'สแกนพัสดุ',
            recentScans
        });
    } catch (error) {
        console.error('Scanner page error:', error);
        res.status(500).send('Error loading scanner: ' + error.message);
    }
}

export async function processScan(req, res) {
    try {
        const { barcode } = req.body;

        // Find order by job_no
        const [[order]] = await pool.query(
            `SELECT o.*, 
              s.name AS sender_name, s.phone AS sender_phone,
              r.name AS receiver_name, r.phone AS receiver_phone
       FROM orders o
       LEFT JOIN customers s ON o.sender_id = s.id
       LEFT JOIN customers r ON o.receiver_id = r.id
       WHERE o.job_no = ?`,
            [barcode]
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'ไม่พบเลขพัสดุนี้ในระบบ'
            });
        }

        res.json({
            success: true,
            order
        });
    } catch (error) {
        console.error('Process scan error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาด: ' + error.message
        });
    }
}

export async function quickStatusUpdate(req, res) {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.session.user.id;

        // Update order status
        await pool.query(
            'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, id]
        );

        // Log status change
        await pool.query(
            `INSERT INTO order_status_logs (order_id, to_status, action_by, action_at)
       VALUES (?, ?, ?, NOW())`,
            [id, status, userId]
        );

        res.json({
            success: true,
            message: 'อัพเดทสถานะสำเร็จ'
        });
    } catch (error) {
        console.error('Quick status update error:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาด: ' + error.message
        });
    }
}
