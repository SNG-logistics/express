import { WorkflowError } from './orderWorkflowService.js';

function finiteNonNegative(value, field) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new WorkflowError(`${field} must be a non-negative number`, 400, 'INVALID_PRICE_INPUT');
  }
  return number;
}

export function computeRatePrice(rate, chargeableKg = 0) {
  const basePrice = finiteNonNegative(rate?.price, 'Rate price');
  const perKg = finiteNonNegative(rate?.price_per_kg, 'Rate price per kg');
  const weight = finiteNonNegative(chargeableKg, 'Chargeable weight');
  return Number((basePrice + (perKg * weight)).toFixed(2));
}

export function parseDimensionSum(value) {
  if (!value) return 0;
  const parts = String(value).trim().split(/[xX×,*\s]+/).filter(Boolean).map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part) || part < 0)) {
    throw new WorkflowError('Invalid parcel dimensions; use LxWxH', 400, 'INVALID_DIMENSIONS');
  }
  return parts.reduce((sum, part) => sum + part, 0);
}

export async function resolveShippingRate(connection, {
  rateId,
  chargeableKg = 0,
  dimensionSum = 0,
}) {
  const id = Number(rateId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new WorkflowError('Please select an active shipping rate', 400, 'SHIPPING_RATE_REQUIRED');
  }

  const [[rate]] = await connection.query(
    'SELECT * FROM shipping_rates WHERE id=? AND active=1',
    [id]
  );
  if (!rate) {
    throw new WorkflowError('Shipping rate not found or inactive', 400, 'SHIPPING_RATE_NOT_FOUND');
  }

  const weight = finiteNonNegative(chargeableKg, 'Chargeable weight');
  const dimensions = finiteNonNegative(dimensionSum, 'Parcel dimension sum');
  if (Number(rate.max_weight) > 0 && weight > Number(rate.max_weight)) {
    throw new WorkflowError(
      `Weight ${weight} kg exceeds rate ${rate.name} limit (${Number(rate.max_weight)} kg)`,
      400,
      'RATE_WEIGHT_EXCEEDED'
    );
  }
  if (Number(rate.max_dimension) > 0 && dimensions > Number(rate.max_dimension)) {
    throw new WorkflowError(
      `Parcel dimensions ${dimensions} cm exceed rate ${rate.name} limit (${Number(rate.max_dimension)} cm)`,
      400,
      'RATE_DIMENSION_EXCEEDED'
    );
  }

  return {
    rate,
    price: computeRatePrice(rate, weight),
  };
}
