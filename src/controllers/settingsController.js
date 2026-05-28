import pool from '../config/db.js';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Helper: load all company_settings into a plain object ───────────────────
async function getCompanySettings() {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
  return Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]));
}

export async function showRates(req, res) {
    try {
        const [rates] = await pool.query('SELECT * FROM shipping_rates ORDER BY max_weight ASC');
        const [fxRates] = await pool.query(
            'SELECT er.*, u.username AS set_by_name FROM exchange_rates er LEFT JOIN users u ON u.id = er.set_by ORDER BY er.created_at DESC LIMIT 20'
        );
        const company = await getCompanySettings();
        const flash = req.session.flash;
        delete req.session.flash;
        res.render('settings/rates', {
            user: req.session.user,
            title: 'ตั้งค่าระบบ',
            rates,
            fxRates,
            company,
            error: null,
            success: flash?.type === 'success' ? flash.message : null,
            flashError: flash?.type === 'error' ? flash.message : null,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading rates');
    }
}

export async function createRate(req, res) {
    const { name, max_weight, max_dimension, price } = req.body;
    try {
        await pool.query(
            'INSERT INTO shipping_rates (name, max_weight, max_dimension, price) VALUES (?, ?, ?, ?)',
            [name, max_weight, max_dimension || 0, price]
        );
        req.session.flash = { type: 'success', message: 'เพิ่มเรทราคาเรียบร้อยแล้ว' };
        res.redirect('/settings/rates');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating rate');
    }
}

export async function deleteRate(req, res) {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM shipping_rates WHERE id = ?', [id]);
        req.session.flash = { type: 'success', message: 'ลบเรทราคาเรียบร้อยแล้ว' };
        res.redirect('/settings/rates');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting rate');
    }
}

export async function calculatePrice(req, res) {
    const { weight, width, length, height } = req.query;
    const w = parseFloat(weight) || 0;
    const dimSum = (parseFloat(width) || 0) + (parseFloat(length) || 0) + (parseFloat(height) || 0);

    try {
        // 1. Find price by Weight
        const [weightRates] = await pool.query(
            'SELECT price FROM shipping_rates WHERE max_weight >= ? AND active = 1 ORDER BY price ASC LIMIT 1',
            [w]
        );

        // 2. Find price by Dimension
        let dimPrice = 0;
        if (dimSum > 0) {
            const [dimRates] = await pool.query(
                'SELECT price FROM shipping_rates WHERE max_dimension >= ? AND active = 1 ORDER BY price ASC LIMIT 1',
                [dimSum]
            );
            if (dimRates.length > 0) dimPrice = Number(dimRates[0].price);
        }

        let weightPrice = 0;
        if (weightRates.length > 0) weightPrice = Number(weightRates[0].price);

        // Take MAX
        const finalPrice = Math.max(weightPrice, dimPrice);

        res.json({
            price: finalPrice,
            found: finalPrice > 0,
            details: { weightPrice, dimPrice, dimSum }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal error calculating price' });
    }
}

// ─── Exchange Rate Manager ────────────────────────────────────────────────────

export async function setExchangeRate(req, res) {
    const { pair, rate, note } = req.body;
    const parsedRate = parseFloat(rate);
    if (!parsedRate || parsedRate <= 0) {
        req.session.flash = { type: 'error', message: 'อัตราแลกเปลี่ยนไม่ถูกต้อง' };
        return res.redirect('/settings/rates#fx');
    }
    try {
        await pool.query(
            'INSERT INTO exchange_rates (pair, rate, set_by, note) VALUES (?, ?, ?, ?)',
            [pair || 'THB_LAK', parsedRate, req.session.user?.id || null, note || null]
        );
        req.session.flash = { type: 'success', message: `บันทึกอัตราแลกเปลี่ยน ${pair || 'THB_LAK'} = ${parsedRate.toLocaleString()} สำเร็จ` };
        res.redirect('/settings/rates#fx');
    } catch (err) {
        console.error(err);
        req.session.flash = { type: 'error', message: err.message };
        res.redirect('/settings/rates#fx');
    }
}

// API: get latest exchange rate (accessible by staff)
export async function getLatestRate(req, res) {
    const { pair = 'THB_LAK' } = req.query;
    try {
        const [[row]] = await pool.query(
            'SELECT rate, created_at FROM exchange_rates WHERE pair = ? ORDER BY created_at DESC LIMIT 1',
            [pair]
        );
        res.json({ pair, rate: row?.rate || null, updated_at: row?.created_at || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ─── Danger Zone (Clear Test Data) ────────────────────────────────────────────

export async function clearTestData(req, res) {
    const { admin_password } = req.body;
    const userId = req.session.user?.id;

    if (!admin_password) {
        req.session.flash = { type: 'error', message: 'กรุณากรอกรหัสผ่านเพื่อยืนยัน' };
        return res.redirect('/settings/rates');
    }

    try {
        // Verify password
        const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
        if (!user) {
            req.session.flash = { type: 'error', message: 'ไม่พบผู้ใช้งานนี้' };
            return res.redirect('/settings/rates');
        }

        const isMatch = await bcrypt.compare(admin_password, user.password_hash);
        if (!isMatch) {
            req.session.flash = { type: 'error', message: 'รหัสผ่านแอดมินไม่ถูกต้อง ไม่อนุญาตให้ล้างข้อมูล' };
            return res.redirect('/settings/rates');
        }

        // Disable foreign keys to safely truncate
        await pool.query('SET FOREIGN_KEY_CHECKS = 0');

        // Truncate transaction tables
        const tablesToClear = [
            'orders',
            'order_status_logs',
            'order_flags',
            'payments',
            'trip_orders',
            'trips',
            'cod_settlements',
            'dispatch_assignments'
        ];

        for (const table of tablesToClear) {
            try {
                await pool.query(`TRUNCATE TABLE ${table}`);
            } catch (e) {
                console.warn(`Warning: Could not truncate ${table}`, e.message);
            }
        }

        // Re-enable foreign keys
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');

        req.session.flash = { type: 'success', message: 'ล้างข้อมูลการทดสอบ (ออเดอร์, ทริป) ทั้งหมดออกจากระบบเรียบร้อยแล้ว' };
        res.redirect('/settings/rates');

    } catch (err) {
        console.error('Clear Test Data Error:', err);
        // Ensure foreign key checks are re-enabled even on error
        await pool.query('SET FOREIGN_KEY_CHECKS = 1').catch(console.error);
        
        req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาดในการล้างข้อมูล: ' + err.message };
        res.redirect('/settings/rates');
    }
}

// ─── Company Profile ─────────────────────────────────────────────────────────

export async function updateCompanyProfile(req, res) {
    const userId = req.session.user?.id || null;
    try {
        // รับ fields ทั้งสองฝั่ง (TH + LA) + shared
        const allowed = [
            'company_name',    'company_address',    'company_phone',    'company_tax_id',    'company_email',
            'company_name_th', 'company_address_th', 'company_phone_th', 'company_tax_id_th', 'company_email_th',
            'company_name_la', 'company_address_la', 'company_phone_la', 'company_tax_id_la', 'company_email_la',
        ];
        for (const key of allowed) {
            if (key in req.body) {
                await pool.query(
                    'INSERT INTO company_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)',
                    [key, req.body[key] ?? '', userId]
                );
            }
        }
        req.session.flash = { type: 'success', message: '✅ บันทึกข้อมูลบริษัทเรียบร้อยแล้ว / ບັນທຶກຂໍ້ມູນສຳເລັດ' };
        res.redirect('/settings/rates#company');
    } catch (err) {
        console.error('[COMPANY] updateCompanyProfile error:', err);
        req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
        res.redirect('/settings/rates#company');
    }
}

export async function uploadCompanyLogo(req, res) {
    const userId  = req.session.user?.id || null;
    const logoKey = req.body.logo_target === 'la' ? 'company_logo_la' : 'company_logo';
    try {
        if (!req.file) {
            req.session.flash = { type: 'error', message: 'กรุณาเลือกไฟล์รูปโลโก้' };
            return res.redirect('/settings/rates#company');
        }
        const logoUrl = '/uploads/logo/' + req.file.filename;
        await pool.query(
            'INSERT INTO company_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)',
            [logoKey, logoUrl, userId]
        );
        // Ensure the key exists in DB for first-time LA logo
        if (logoKey === 'company_logo_la') {
            await pool.query(
                'INSERT IGNORE INTO company_settings (setting_key, setting_value) VALUES (?, ?)',
                ['company_logo_la', logoUrl]
            );
        }
        req.session.flash = { type: 'success', message: '✅ อัปโหลดโลโก้เรียบร้อยแล้ว' };
        res.redirect('/settings/rates#company');
    } catch (err) {
        console.error('[COMPANY] uploadCompanyLogo error:', err);
        req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
        res.redirect('/settings/rates#company');
    }
}
