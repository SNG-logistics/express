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
  // Starting policy template — reflects the deposit-covers-item-cost-only,
  // balance-on-COD policy already agreed on. Review/edit via Settings before
  // launch; bank/PromptPay/WhatsApp fields above are deliberately left blank
  // since only the owner can supply real account details.
  ['purchase_agent_policy_text_th', 'มัดจำที่ชำระคือค่าสินค้าที่ SNG ต้องจ่ายให้ร้านค้าล่วงหน้า ส่วนค่าขนส่งและค่าบริการเก็บปลายทางแบบ COD ตอนรับสินค้า หากสินค้าหมดหรือร้านค้ายกเลิกออเดอร์หลังชำระมัดจำแล้ว SNG จะคืนเงินมัดจำเต็มจำนวน'],
  ['purchase_agent_policy_text_lo', 'ຍອດມັດຈຳທີ່ຊຳລະແມ່ນຄ່າສິນຄ້າທີ່ SNG ຕ້ອງຈ່າຍໃຫ້ຮ້ານລ່ວງໜ້າ ສ່ວນຄ່າຂົນສົ່ງ ແລະ ຄ່າບໍລິການເກັບປາຍທາງແບບ COD ຕອນຮັບເຄື່ອງ ຫາກສິນຄ້າໝົດ ຫຼືຮ້ານຍົກເລີກອອເດີຫຼັງຊຳລະມັດຈຳແລ້ວ SNG ຈະຄືນເງິນມັດຈຳເຕັມຈຳນວນ'],
  // ── Referral reward (tunable without a deploy; "give one, get one" — see
  //    plan). Granted once, atomically, when a referred friend's first order
  //    reaches DELIVERED (src/services/referralRewardService.js). Two
  //    separate keys, not one shared amount, so asymmetric rewards never
  //    need a schema change later. 20000 is a functional placeholder, not a
  //    confirmed business number — set real values before launch.
  ['referral_reward_referrer_lak', '20000'],
  ['referral_reward_referred_lak', '20000'],
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
