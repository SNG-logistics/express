import pool from '../config/db.js';

export async function getCompanySettings() {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
    return Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
  } catch (error) {
    // The public site stays renderable during a pre-bootstrap deploy.
    if (error.code === 'ER_NO_SUCH_TABLE') return {};
    throw error;
  }
}

export async function getCompanyBilingual() {
  const settings = await getCompanySettings();
  const pick = suffix => Object.fromEntries(Object.entries(settings)
    .filter(([key]) => key.endsWith('_' + suffix))
    .map(([key, value]) => [key.slice(0, -(suffix.length + 1)), value]));
  return { th: pick('th'), la: pick('la') };
}
