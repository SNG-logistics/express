import pool from '../src/config/db.js';

async function main() {
  try {
    const [r1] = await pool.query(`
      UPDATE crm_customers 
      SET full_name = CASE 
        WHEN phone IS NOT NULL AND phone != '' THEN CONCAT('+', phone)
        ELSE 'ลูกค้า WhatsApp' 
      END 
      WHERE full_name LIKE '%@lid%' OR full_name LIKE '%@s.whatsapp.net%'
    `);
    const [r2] = await pool.query(`
      UPDATE crm_customer_identities 
      SET external_display_name = CASE 
        WHEN phone_normalized IS NOT NULL AND phone_normalized != '' THEN CONCAT('+', phone_normalized)
        ELSE 'ลูกค้า WhatsApp' 
      END 
      WHERE external_display_name LIKE '%@lid%' OR external_display_name LIKE '%@s.whatsapp.net%'
    `);
    console.log(`Successfully cleaned ${r1.affectedRows} crm_customers and ${r2.affectedRows} crm_customer_identities`);
  } catch (err) {
    console.error('Error cleaning CRM names:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
