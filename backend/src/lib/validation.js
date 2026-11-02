import { ApiError } from './errors.js';

export const SHIPMENT_STATUSES = Object.freeze([
  'CREATED',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'LOST',
  'RETURNED',
]);

const STATUS_SET = new Set(SHIPMENT_STATUSES);
const ORDER_ID_PATTERN = /^0x[0-9a-f]{64}$/i;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const TRACKING_ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{3,63}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function requiredString(value, field, code) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, code, `${field} is required.`);
  }
  return value.trim();
}

export function normalizeOrderId(value) {
  const raw = requiredString(value, 'orderId', 'INVALID_ORDER_ID');
  const prefixed = /^0x/i.test(raw) ? raw : `0x${raw}`;

  if (!ORDER_ID_PATTERN.test(prefixed)) {
    throw new ApiError(
      400,
      'INVALID_ORDER_ID',
      'orderId must be a 32-byte hex string (0x followed by 64 hex characters).'
    );
  }

  return prefixed.toLowerCase();
}

export function normalizeTrackingId(value) {
  const raw = requiredString(value, 'trackingId', 'INVALID_TRACKING_ID');
  const trackingId = raw.toUpperCase();

  if (!TRACKING_ID_PATTERN.test(trackingId)) {
    throw new ApiError(
      400,
      'INVALID_TRACKING_ID',
      'trackingId must be 4-64 characters using letters, numbers, hyphens or underscores.'
    );
  }

  return trackingId;
}

export function normalizeAddress(value, field = 'sellerAddress') {
  const raw = requiredString(value, field, 'INVALID_SELLER_ADDRESS');
  const address = raw.toLowerCase();

  if (!ADDRESS_PATTERN.test(address)) {
    throw new ApiError(
      400,
      'INVALID_SELLER_ADDRESS',
      `${field} must be a 0x address with 40 hex characters.`
    );
  }

  return address;
}

export function normalizeCarrier(value) {
  const carrier = requiredString(value, 'carrier', 'INVALID_CARRIER');

  if (carrier.length < 2 || carrier.length > 60 || CONTROL_CHARACTERS.test(carrier)) {
    throw new ApiError(
      400,
      'INVALID_CARRIER',
      'carrier must be 2-60 printable characters.'
    );
  }

  return carrier;
}

export function normalizeDescription(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_DESCRIPTION', 'description must be a string.');
  }

  const description = value.trim();
  if (description.length > 280) {
    throw new ApiError(
      400,
      'INVALID_DESCRIPTION',
      'description must be 280 characters or fewer.'
    );
  }

  return description.length > 0 ? description : null;
}

export function normalizeStatus(value) {
  const raw = requiredString(value, 'status', 'INVALID_STATUS');
  const status = raw.toUpperCase();

  if (!STATUS_SET.has(status)) {
    throw new ApiError(400, 'INVALID_STATUS', 'Unsupported shipment status.', {
      allowed: SHIPMENT_STATUSES,
    });
  }

  return status;
}

export function normalizeCreateShipment(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }

  return {
    orderId: normalizeOrderId(body.orderId),
    trackingId: normalizeTrackingId(body.trackingId),
    carrier: normalizeCarrier(body.carrier ?? body.courier),
    sellerAddress: normalizeAddress(body.sellerAddress),
    description: normalizeDescription(body.description),
  };
}

export function normalizeStatusUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }

  return {
    status: normalizeStatus(body.status),
    description: normalizeDescription(body.description),
  };
}

export function normalizeListFilters(query) {
  return {
    orderId: query.orderId ? normalizeOrderId(query.orderId) : null,
    status: query.status ? normalizeStatus(query.status) : null,
  };
}
