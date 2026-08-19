import pool from '../config/db.js';
import { listAllProhibitedItems, invalidateProhibitedItemsCache } from '../services/prohibitedItemsService.js';
import { listAllTestimonials, invalidateTestimonialsCache } from '../services/testimonialsService.js';
import bcrypt from 'bcryptjs';
import { getCompanySettings } from '../services/companySettingsService.js';
import { findBestShippingRate } from '../services/pricingService.js';

// ─── Helper: load all company_settings into a plain object ───────────────────
export async function showRates(req, res) {
    try {
        const [rates] = await pool.query('SELECT * FROM shipping_rates WHERE active = 1 ORDER BY max_weight ASC');
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
    const { name, max_weight, max_dimension, price, price_per_kg } = req.body;
    try {
        const values = {
            name: String(name || '').trim(),
            maxWeight: Number(max_weight),
            maxDimension: Number(max_dimension || 0),
            price: Number(price),
            pricePerKg: Number(price_per_kg || 0),
        };
        if (!values.name || !Number.isFinite(values.maxWeight) || values.maxWeight <= 0 ||
            !Number.isFinite(values.maxDimension) || values.maxDimension < 0 ||
            !Number.isFinite(values.price) || values.price < 0 ||
            !Number.isFinite(values.pricePerKg) || values.pricePerKg < 0) {
            throw new Error('Invalid shipping rate values');
        }
        await pool.query(
            `INSERT INTO shipping_rates
               (name, max_weight, max_dimension, price, price_per_kg)
             VALUES (?, ?, ?, ?, ?)`,
            [values.name, values.maxWeight, values.maxDimension, values.price, values.pricePerKg]
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
        await pool.query('UPDATE shipping_rates SET active=0 WHERE id = ?', [id]);
        req.session.flash = { type: 'success', message: 'ลบเรทราคาเรียบร้อยแล้ว' };
        res.redirect('/settings/rates');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting rate');
    }
}

export async function calculatePrice(req, res) {
    const { weight, width, length, height } = req.query;
    try {
        const quote = await findBestShippingRate({
            weightKg: parseFloat(weight) || 0,
            widthCm: parseFloat(width) || 0,
            lengthCm: parseFloat(length) || 0,
            heightCm: parseFloat(height) || 0,
        });
        res.json(quote);
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
    const { admin_password, clear_orders, clear_trips, clear_payments, clear_expenses, clear_crm } = req.body;
    const userId = req.session.user?.id;

    if (!admin_password) {
        req.session.flash = { type: 'error', message: 'กรุณากรอกรหัสผ่านเพื่อยืนยัน' };
        return res.redirect('/settings/rates');
    }

    if (!clear_orders && !clear_trips && !clear_payments && !clear_expenses && !clear_crm) {
        req.session.flash = { type: 'error', message: 'กรุณาเลือกหัวข้อที่ต้องการล้างข้อมูลอย่างน้อย 1 รายการ' };
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

        const clearedItems = [];

        // 1. Clear CRM Chats
        if (clear_crm === '1') {
            const crmTables = [
                'crm_messages',
                'crm_conversation_tags',
                'crm_internal_notes',
                'crm_assignments',
                'crm_cases',
                'crm_conversations'
            ];
            for (const table of crmTables) {
                try {
                    await pool.query(`TRUNCATE TABLE ${table}`);
                } catch (e) {
                    console.warn(`Warning: Could not truncate CRM table ${table}`, e.message);
                }
            }
            clearedItems.push('ประวัติแชทลูกค้า CRM');
        }

        // 2. Clear Payments & COD
        // Note: If clear_orders is checked, payments must also be cleared since payments has order_id NOT NULL
        const actualClearPayments = (clear_payments === '1' || clear_orders === '1');
        if (actualClearPayments) {
            const paymentTables = [
                'payments',
                'cod_settlements'
            ];
            for (const table of paymentTables) {
                try {
                    await pool.query(`TRUNCATE TABLE ${table}`);
                } catch (e) {
                    console.warn(`Warning: Could not truncate payment table ${table}`, e.message);
                }
            }
            clearedItems.push('ยอดเงินชำระ & COD');
        }

        // 3. Clear Expenses
        if (clear_expenses === '1') {
            try {
                await pool.query('TRUNCATE TABLE expenses');
            } catch (e) {
                console.warn('Warning: Could not truncate expenses', e.message);
            }
            clearedItems.push('ยอดเงินรายจ่าย');
        }

        // 4. Clear Trips
        if (clear_trips === '1') {
            const tripTables = [
                'trips',
                'trip_orders'
            ];
            for (const table of tripTables) {
                try {
                    await pool.query(`TRUNCATE TABLE ${table}`);
                } catch (e) {
                    console.warn(`Warning: Could not truncate trip table ${table}`, e.message);
                }
            }
            // If orders are NOT cleared, update order's trip_id reference to NULL
            if (clear_orders !== '1') {
                try {
                    await pool.query('UPDATE orders SET trip_id = NULL');
                } catch (e) {
                    console.warn('Warning: Could not clear trip_id in orders', e.message);
                }
            }
            // If expenses are NOT cleared, update expense's trip_id reference to NULL
            if (clear_expenses !== '1') {
                try {
                    await pool.query('UPDATE expenses SET trip_id = NULL');
                } catch (e) {
                    console.warn('Warning: Could not clear trip_id in expenses', e.message);
                }
            }
            // Reset space bookings' trip_id references to NULL
            try {
                await pool.query('UPDATE space_bookings SET trip_id = NULL');
            } catch (e) {
                console.warn('Warning: Could not clear trip_id in space_bookings', e.message);
            }

            clearedItems.push('ข้อมูลรอบรถ');
        }

        // 5. Clear Orders
        if (clear_orders === '1') {
            const orderTables = [
                'orders',
                'order_status_logs',
                'order_flags',
                'dispatch_assignments',
                'branch_deliveries',
                'delivery_events',
                'trip_orders',
                'branch_revenue'
            ];
            for (const table of orderTables) {
                try {
                    await pool.query(`TRUNCATE TABLE ${table}`);
                } catch (e) {
                    console.warn(`Warning: Could not truncate order table ${table}`, e.message);
                }
            }
            // Clean up order references in other tables
            try {
                await pool.query('UPDATE partner_quotations SET order_id = NULL');
            } catch (e) {
                console.warn('Warning: Could not clear order_id in partner_quotations', e.message);
            }
            try {
                await pool.query('UPDATE crm_cases SET related_order_id = NULL');
            } catch (e) {
                console.warn('Warning: Could not clear related_order_id in crm_cases', e.message);
            }

            clearedItems.push('ข้อมูลออเดอร์');
        }

        // Re-enable foreign keys
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');

        let msg = 'ล้างข้อมูลการทดสอบที่เลือกสำเร็จ: ' + clearedItems.join(', ');
        if (clear_orders === '1' && clear_payments !== '1') {
            msg += ' (หมายเหตุ: ลบยอดเงินชำระ & COD อัตโนมัติเนื่องจากอิงตามออเดอร์ที่ถูกลบ)';
        }

        req.session.flash = { type: 'success', message: msg };
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

// ─── Prohibited / restricted goods ────────────────────────────────────────────
// Customs practice changes, and the person who learns it is at the counter, not
// at a keyboard with a deploy pipeline. The list is data, editable here, so a
// correction reaches customers the same day.

export async function showProhibitedItems(req, res) {
    try {
        const items = await listAllProhibitedItems();
        const flash = req.session.flash;
        delete req.session.flash;
        res.render('settings/prohibited', {
            user: req.session.user,
            title: 'ของที่รับ / ไม่รับ',
            banned: items.filter(i => i.category === 'BANNED'),
            askFirst: items.filter(i => i.category === 'ASK_FIRST'),
            flash,
        });
    } catch (err) {
        console.error('[Settings] showProhibitedItems:', err);
        res.status(500).send(err.message);
    }
}

export async function createProhibitedItem(req, res) {
    const { category, label_th, label_lo, note_th, note_lo, sort_order } = req.body;
    try {
        if (!['BANNED', 'ASK_FIRST'].includes(category)) {
            throw new Error('หมวดหมู่ไม่ถูกต้อง');
        }
        if (!label_th?.trim() || !label_lo?.trim()) {
            // Both languages are required because a customer reading in Lao must
            // never be shown a blank where a restriction should be.
            throw new Error('ต้องกรอกชื่อรายการทั้งภาษาไทยและภาษาลาว');
        }
        await pool.query(
            `INSERT INTO prohibited_items
               (category, label_th, label_lo, note_th, note_lo, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                category, label_th.trim(), label_lo.trim(),
                note_th?.trim() || null, note_lo?.trim() || null,
                Number(sort_order) || 0,
            ]
        );
        invalidateProhibitedItemsCache();
        req.session.flash = { type: 'success', message: 'เพิ่มรายการแล้ว' };
    } catch (err) {
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect('/settings/prohibited');
}

export async function updateProhibitedItem(req, res) {
    const { id } = req.params;
    const { label_th, label_lo, note_th, note_lo, sort_order, active } = req.body;
    try {
        if (!label_th?.trim() || !label_lo?.trim()) {
            throw new Error('ต้องกรอกชื่อรายการทั้งภาษาไทยและภาษาลาว');
        }
        await pool.query(
            `UPDATE prohibited_items
                SET label_th = ?, label_lo = ?, note_th = ?, note_lo = ?,
                    sort_order = ?, active = ?
              WHERE id = ?`,
            [
                label_th.trim(), label_lo.trim(),
                note_th?.trim() || null, note_lo?.trim() || null,
                Number(sort_order) || 0, active ? 1 : 0, id,
            ]
        );
        invalidateProhibitedItemsCache();
        req.session.flash = { type: 'success', message: 'บันทึกแล้ว' };
    } catch (err) {
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect('/settings/prohibited');
}

export async function deleteProhibitedItem(req, res) {
    try {
        await pool.query('DELETE FROM prohibited_items WHERE id = ?', [req.params.id]);
        invalidateProhibitedItemsCache();
        req.session.flash = { type: 'success', message: 'ลบรายการแล้ว' };
    } catch (err) {
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect('/settings/prohibited');
}

// ─── Customer proof ───────────────────────────────────────────────────────────
// Photos and words customers sent us. Nothing here is invented, and nothing
// reaches a public page without recorded permission — publishing someone who
// never agreed would damage the exact trust this feature exists to build.

export async function showTestimonials(req, res) {
    try {
        const rows = await listAllTestimonials();
        const flash = req.session.flash;
        delete req.session.flash;
        res.render('settings/testimonials', {
            user: req.session.user,
            title: 'หลักฐานจากลูกค้า',
            rows,
            flash,
        });
    } catch (err) {
        console.error('[Settings] showTestimonials:', err);
        res.status(500).send(err.message);
    }
}

/** Consent is resolved here, not trusted from whatever the form posted. */
function consentFields(req, existing = null) {
    const given = req.body.consent_given ? 1 : 0;
    if (!given) return { given: 0, note: null, by: null, at: null };
    // Keep the original attribution once consent has been recorded — re-saving
    // the row must not rewrite who obtained it or when.
    if (existing?.consent_given) {
        return {
            given: 1,
            note: req.body.consent_note?.trim() || existing.consent_note,
            by: existing.consent_by,
            at: existing.consent_at,
        };
    }
    return {
        given: 1,
        note: req.body.consent_note?.trim() || null,
        by: req.session.user?.id ?? null,
        at: new Date(),
    };
}

export async function createTestimonial(req, res) {
    try {
        const { display_name, message, source_ref, sort_order, status } = req.body;
        if (!display_name?.trim()) throw new Error('ต้องระบุชื่อที่จะแสดง');

        const consent = consentFields(req);
        // Published without consent is the one combination that must never
        // persist, so it is downgraded here rather than rejected — the staff
        // member keeps their typing and sees why it stayed a draft.
        const safeStatus = consent.given && status === 'published' ? 'published' : 'draft';

        await pool.query(
            `INSERT INTO testimonials
               (display_name, message, photo_path, source_ref,
                consent_given, consent_note, consent_by, consent_at, status, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                display_name.trim(), message?.trim() || null,
                req.file ? '/uploads/testimonials/' + req.file.filename : null,
                source_ref?.trim() || null,
                consent.given, consent.note, consent.by, consent.at,
                safeStatus, Number(sort_order) || 0,
            ]
        );
        invalidateTestimonialsCache();
        req.session.flash = safeStatus === 'published'
            ? { type: 'success', message: 'เพิ่มและเผยแพร่แล้ว' }
            : { type: 'success', message: 'บันทึกเป็นฉบับร่าง — ต้องยืนยันว่าขออนุญาตลูกค้าแล้วจึงเผยแพร่ได้' };
    } catch (err) {
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect('/settings/testimonials');
}

export async function updateTestimonial(req, res) {
    const { id } = req.params;
    try {
        const [[existing]] = await pool.query('SELECT * FROM testimonials WHERE id = ?', [id]);
        if (!existing) throw new Error('ไม่พบรายการนี้');

        const { display_name, message, source_ref, sort_order, status } = req.body;
        if (!display_name?.trim()) throw new Error('ต้องระบุชื่อที่จะแสดง');

        const consent = consentFields(req, existing);
        const safeStatus = consent.given && status === 'published' ? 'published'
            : status === 'hidden' ? 'hidden' : 'draft';

        await pool.query(
            `UPDATE testimonials
                SET display_name = ?, message = ?, source_ref = ?,
                    consent_given = ?, consent_note = ?, consent_by = ?, consent_at = ?,
                    status = ?, sort_order = ?
                    ${req.file ? ', photo_path = ?' : ''}
              WHERE id = ?`,
            req.file
                ? [display_name.trim(), message?.trim() || null, source_ref?.trim() || null,
                   consent.given, consent.note, consent.by, consent.at,
                   safeStatus, Number(sort_order) || 0,
                   '/uploads/testimonials/' + req.file.filename, id]
                : [display_name.trim(), message?.trim() || null, source_ref?.trim() || null,
                   consent.given, consent.note, consent.by, consent.at,
                   safeStatus, Number(sort_order) || 0, id]
        );
        invalidateTestimonialsCache();
        req.session.flash = { type: 'success', message: 'บันทึกแล้ว' };
    } catch (err) {
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect('/settings/testimonials');
}

export async function deleteTestimonial(req, res) {
    try {
        await pool.query('DELETE FROM testimonials WHERE id = ?', [req.params.id]);
        invalidateTestimonialsCache();
        req.session.flash = { type: 'success', message: 'ลบแล้ว' };
    } catch (err) {
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect('/settings/testimonials');
}
