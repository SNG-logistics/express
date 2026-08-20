/**
 * companyContact.js — one place that answers "which phone number do we show?"
 *
 * company_settings stores contact details under three shapes of key: a legacy
 * shared one (`company_phone`) plus a per-entity pair (`company_phone_th`,
 * `company_phone_la`) for the Thai and Lao sides of the business. The settings
 * form only edits the pair; several pages read only the legacy key, and a few
 * had the number typed straight into the markup. The result was a Lao customer
 * seeing a Lao address next to a Thai mobile, and an owner changing the number
 * in Settings with no visible effect anywhere.
 *
 * Note the suffix mismatch this has to bridge: the i18n language code is
 * 'th'/'lo', but the settings suffix is '_th'/'_la' — 'lo' never matches '_la'
 * on its own, which is how the Lao page silently fell back to Thai data.
 */

const isBlank = value => value === undefined || value === null || String(value).trim() === '';

function firstPresent(...values) {
  for (const value of values) if (!isBlank(value)) return String(value).trim();
  return '';
}

/** '_la' for a Lao reader, '_th' otherwise. */
export function entitySuffix(lang) {
  return lang === 'lo' || lang === 'la' ? 'la' : 'th';
}

/**
 * A company contact field for the language being read, falling back to the
 * shared legacy key and then to the other entity.
 *
 * Falling back across entities is deliberate: a Lao customer shown a Thai
 * number can at least reach somebody, while an empty contact panel loses them
 * entirely. Filling in both fields in Settings is what stops it happening.
 */
export function companyField(company, field, lang = 'th') {
  const c = company || {};
  const mine = entitySuffix(lang);
  const other = mine === 'la' ? 'th' : 'la';
  return firstPresent(
    c[`company_${field}_${mine}`],
    c[`company_${field}`],
    c[`company_${field}_${other}`],
  );
}

export const companyPhone   = (company, lang) => companyField(company, 'phone', lang);
export const companyEmail   = (company, lang) => companyField(company, 'email', lang);
export const companyName    = (company, lang) => companyField(company, 'name', lang) || 'SNG Express';
export const companyAddress = (company, lang) => companyField(company, 'address', lang);

/**
 * The dialable form of a number written for humans: '083-754-3623' is not a
 * valid tel: target, '+8562012345678' is. A leading '+' is kept because
 * dropping it turns an international number into an unreachable local one.
 */
export function telHref(phone) {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return raw.startsWith('+') ? `+${digits}` : digits;
}
