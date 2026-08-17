import pool from '../src/config/db.js';

const defaults = [
  ['company_name', 'SNG Express'],
  ['company_address', ''],
  ['company_phone', ''],
  ['company_logo', '/images/snglogo.png'],
  ['company_tax_id', ''],
  ['company_email', ''],
  // ── Purchase-Agent service (tunable without a deploy; see plan Phase 3.2) ──
  // Service fee = MAX(minimum_flat_lak, productLak × fee_pct / 100).
  ['purchase_agent_fee_min_lak', '20000'],
  ['purchase_agent_fee_pct', '6'],
  // Unused in v1 (payment proof is WhatsApp-manual); reserved for later.
  ['purchase_agent_deposit_min_lak', '0'],
  // Bank / PromptPay details shown on the customer's quote detail page.
  ['purchase_agent_bank_name', ''],
  ['purchase_agent_bank_account_name', ''],
  ['purchase_agent_bank_account_no', ''],
  ['purchase_agent_promptpay_no', ''],
  ['purchase_agent_whatsapp_contact', ''],
  ['purchase_agent_policy_text_th', ''],
  ['purchase_agent_policy_text_lo', ''],
];

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_settings (
      id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      setting_key VARCHAR(80) NOT NULL UNIQUE,
      setting_value TEXT NULL,
      updated_by INT UNSIGNED NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  for (const [key, value] of defaults) {
    await pool.query(
      'INSERT IGNORE INTO company_settings (setting_key, setting_value) VALUES (?, ?)',
      [key, value]
    );
  }
  console.log('✅ company_settings table created and seeded');
} finally {
  await pool.end();
}
