import pool from './src/config/db.js';

console.log('=== Checking tables for Settings/Rates page ===\n');

try {
  const [t1] = await pool.query("SHOW TABLES LIKE '%exchange%'");
  console.log('exchange_rates table:', t1.length > 0 ? '✅ EXISTS' : '❌ NOT FOUND');

  const [t2] = await pool.query("SHOW TABLES LIKE '%company_settings%'");
  console.log('company_settings table:', t2.length > 0 ? '✅ EXISTS' : '❌ NOT FOUND');

  const [t3] = await pool.query("SHOW TABLES LIKE '%shipping_rates%'");
  console.log('shipping_rates table:', t3.length > 0 ? '✅ EXISTS' : '❌ NOT FOUND');

  // Try the actual query that fails
  console.log('\nTesting actual query...');
  const [fxRates] = await pool.query(
    'SELECT er.*, u.username AS set_by_name FROM exchange_rates er LEFT JOIN users u ON u.id = er.set_by ORDER BY er.created_at DESC LIMIT 5'
  );
  console.log('✅ exchange_rates query OK, rows:', fxRates.length);

  const [company] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
  console.log('✅ company_settings query OK, rows:', company.length);

} catch (e) {
  console.error('\n❌ Error:', e.message);
  console.error('SQL:', e.sql || '');
}

process.exit(0);
