import { findBestShippingRate } from '../services/pricingService.js';
import { getCompanySettings } from '../services/companySettingsService.js';

function numberParam(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function publicView(res, view, data) {
  return res.render(view, { ...data, layout: 'layouts/public' });
}

export async function home(req, res) {
  const company = await getCompanySettings();
  return publicView(res, 'public/home', {
    title: 'SNG Express | ไทย ↔ ลาว',
    company,
  });
}

export async function calculatePage(req, res, next) {
  try {
    const values = {
      weight_kg: numberParam(req.query.weight_kg),
      length_cm: numberParam(req.query.length_cm),
      width_cm: numberParam(req.query.width_cm),
      height_cm: numberParam(req.query.height_cm),
    };
    const hasValues = Object.keys(req.query).some(key => key in values);
    const quote = hasValues ? await findBestShippingRate({
      weightKg: values.weight_kg,
      lengthCm: values.length_cm,
      widthCm: values.width_cm,
      heightCm: values.height_cm,
    }) : null;
    return publicView(res, 'public/calculate', {
      title: 'คำนวณค่าส่ง | SNG Express',
      values,
      quote,
    });
  } catch (error) {
    return next(error);
  }
}

export async function shippingQuote(req, res) {
  try {
    const quote = await findBestShippingRate({
      weightKg: numberParam(req.query.weight_kg),
      lengthCm: numberParam(req.query.length_cm),
      widthCm: numberParam(req.query.width_cm),
      heightCm: numberParam(req.query.height_cm),
    });
    return res.json(quote);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid shipping quote input' });
  }
}

