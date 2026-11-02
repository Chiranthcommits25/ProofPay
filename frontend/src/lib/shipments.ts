import type {
  RegisterShipmentInput,
  Shipment,
  ShipmentListResponse,
  ShipmentStatus,
} from '../types';

const DEFAULT_API_BASE_URL = 'http://localhost:5001';

/** Configurable via frontend/.env — point this at the Express API. */
export const SHIPMENT_API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  DEFAULT_API_BASE_URL;

const SIMULATOR_TOKEN =
  (import.meta.env.VITE_SHIPMENT_SIMULATOR_TOKEN as string | undefined)?.trim() ?? '';

export class ShipmentApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(message: string, status = 0, code = 'SHIPMENT_API_ERROR', details?: unknown) {
    super(message);
    this.name = 'ShipmentApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function writeHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (SIMULATOR_TOKEN) headers['x-simulator-token'] = SIMULATOR_TOKEN;
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${SHIPMENT_API_BASE_URL}/api/shipments${path}`, init);
  } catch {
    throw new ShipmentApiError(
      'Could not reach the shipment API. Check that the backend is running on port 5001.',
      0,
      'NETWORK_ERROR'
    );
  }

  const text = await response.text();
  let payload: unknown;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload as
      | { error?: unknown; code?: unknown; details?: unknown }
      | null;

    throw new ShipmentApiError(
      typeof error?.error === 'string'
        ? error.error
        : `Shipment API returned HTTP ${response.status}.`,
      response.status,
      typeof error?.code === 'string' ? error.code : 'SHIPMENT_API_ERROR',
      error?.details
    );
  }

  return payload as T;
}

export function registerShipment(input: RegisterShipmentInput): Promise<Shipment> {
  return request<Shipment>('', {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(input),
  });
}

export function getShipmentByTrackingId(trackingId: string): Promise<Shipment> {
  return request<Shipment>(`/${encodeURIComponent(trackingId)}`);
}

export function getShipmentByOrderId(orderId: string): Promise<Shipment> {
  return request<Shipment>(`/order/${encodeURIComponent(orderId)}`);
}

export function listShipments(filters: {
  orderId?: string;
  status?: ShipmentStatus;
} = {}): Promise<ShipmentListResponse> {
  const params = new URLSearchParams();
  if (filters.orderId) params.set('orderId', filters.orderId);
  if (filters.status) params.set('status', filters.status);
  const query = params.toString();
  return request<ShipmentListResponse>(query ? `?${query}` : '');
}

export function updateShipmentStatus(
  trackingId: string,
  status: ShipmentStatus,
  description?: string
): Promise<Shipment> {
  return request<Shipment>(`/${encodeURIComponent(trackingId)}/status`, {
    method: 'PATCH',
    headers: writeHeaders(),
    body: JSON.stringify({
      status,
      ...(description ? { description } : {}),
    }),
  });
}

export function shipmentErrorMessage(error: unknown): string {
  if (error instanceof ShipmentApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'The shipment API request failed.';
}

// UI hints only. The Express API is the authority for these transitions.
export const SHIPMENT_NEXT_STATUSES: Record<ShipmentStatus, ShipmentStatus[]> = {
  CREATED: ['SHIPPED'],
  SHIPPED: ['IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED', 'LOST'],
  DELIVERED: ['RETURNED'],
  LOST: [],
  RETURNED: [],
};

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  CREATED: 'Registered',
  SHIPPED: 'Shipped',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  LOST: 'Lost',
  RETURNED: 'Returned',
};
