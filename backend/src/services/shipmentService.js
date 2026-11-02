import { ApiError } from '../lib/errors.js';
import {
  normalizeCreateShipment,
  normalizeListFilters,
  normalizeOrderId,
  normalizeStatusUpdate,
  normalizeTrackingId,
} from '../lib/validation.js';

/**
 * Allowed mock-courier transitions.
 *
 * DELIVERED → RETURNED is the only post-delivery transition, and it is a
 * simulation-only return path. LOST and RETURNED are terminal. Nothing here
 * interacts with the escrow contract or triggers a payment.
 */
export const SHIPMENT_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(['SHIPPED']),
  SHIPPED: Object.freeze(['IN_TRANSIT']),
  IN_TRANSIT: Object.freeze(['DELIVERED', 'LOST']),
  DELIVERED: Object.freeze(['RETURNED']),
  LOST: Object.freeze([]),
  RETURNED: Object.freeze([]),
});

const ESCROW_STATUS_LABELS = Object.freeze({
  0: 'None',
  1: 'Funded',
  2: 'Released',
  3: 'Refunded',
});

const DEFAULT_EVENT_DESCRIPTIONS = Object.freeze({
  SHIPPED: 'Simulated courier: package dispatched.',
  IN_TRANSIT: 'Simulated courier: package is in transit.',
  DELIVERED: 'Simulated courier: package delivered.',
  LOST: 'Simulated courier: package reported lost.',
  RETURNED: 'Simulated courier: package returned to the seller.',
});

function escrowStatusLabel(status) {
  return ESCROW_STATUS_LABELS[status] ?? `Unknown (${status})`;
}

export class ShipmentService {
  constructor({ store, chainVerifier, clock = () => new Date() }) {
    this.store = store;
    this.chainVerifier = chainVerifier;
    this.clock = clock;
  }

  assertNoDuplicates({ trackingId, orderId }) {
    if (this.store.findByTrackingId(trackingId)) {
      throw new ApiError(
        409,
        'DUPLICATE_TRACKING_ID',
        `Tracking ID ${trackingId} is already registered.`
      );
    }

    if (this.store.findByOrderId(orderId)) {
      throw new ApiError(
        409,
        'SHIPMENT_ALREADY_EXISTS',
        'A shipment is already registered for this escrow order.'
      );
    }
  }

  async register(body) {
    const input = normalizeCreateShipment(body);

    // Fail fast on duplicates, then verify the order against the chain. The
    // checks are repeated after the async RPC call to avoid a concurrent
    // double-registration race.
    this.assertNoDuplicates(input);

    const escrow = await this.chainVerifier.verifyEscrow(input.orderId);

    if (!escrow) {
      throw new ApiError(
        404,
        'ESCROW_NOT_FOUND',
        'No escrow exists on-chain for this order ID.'
      );
    }

    if (escrow.status !== 1) {
      throw new ApiError(
        409,
        'ESCROW_NOT_FUNDED',
        `Escrow status is ${escrowStatusLabel(escrow.status)}, not Funded. Only funded escrows can register a shipment.`
      );
    }

    if (escrow.seller.toLowerCase() !== input.sellerAddress) {
      throw new ApiError(
        409,
        'SELLER_MISMATCH',
        'sellerAddress does not match the seller recorded in the escrow contract.'
      );
    }

    this.assertNoDuplicates(input);

    const now = this.clock().toISOString();
    const shipment = {
      trackingId: input.trackingId,
      orderId: input.orderId,
      carrier: input.carrier,
      sellerAddress: input.sellerAddress,
      description: input.description,
      status: 'CREATED',
      simulated: true,
      source: 'mock-courier-simulator',
      createdAt: now,
      updatedAt: now,
      events: [
        {
          status: 'CREATED',
          timestamp: now,
          description: `Shipment registered with ${input.carrier} (simulated courier data).`,
        },
      ],
    };

    return this.store.add(shipment);
  }

  getByTrackingId(value) {
    const trackingId = normalizeTrackingId(value);
    const shipment = this.store.findByTrackingId(trackingId);

    if (!shipment) {
      throw new ApiError(
        404,
        'SHIPMENT_NOT_FOUND',
        `No shipment exists for tracking ID ${trackingId}.`
      );
    }

    return shipment;
  }

  getByOrderId(value) {
    const orderId = normalizeOrderId(value);
    const shipment = this.store.findByOrderId(orderId);

    if (!shipment) {
      throw new ApiError(
        404,
        'SHIPMENT_NOT_FOUND',
        `No shipment exists for order ${orderId}.`
      );
    }

    return shipment;
  }

  list(query = {}) {
    const filters = normalizeListFilters(query);
    let shipments = this.store.list();

    if (filters.orderId) {
      shipments = shipments.filter(
        shipment => shipment.orderId.toLowerCase() === filters.orderId
      );
    }

    if (filters.status) {
      shipments = shipments.filter(shipment => shipment.status === filters.status);
    }

    shipments.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return { shipments, count: shipments.length, simulated: true };
  }

  async updateStatus(trackingIdValue, body) {
    const trackingId = normalizeTrackingId(trackingIdValue);
    const input = normalizeStatusUpdate(body);
    const now = this.clock().toISOString();
    const description =
      input.description ??
      DEFAULT_EVENT_DESCRIPTIONS[input.status] ??
      `Simulated courier status changed to ${input.status}.`;

    // Validate against the state inside the store's serialized updater so two
    // concurrent PATCH requests cannot both apply the same transition.
    const updated = await this.store.update(trackingId, shipment => {
      const allowed = SHIPMENT_TRANSITIONS[shipment.status] ?? [];

      if (!allowed.includes(input.status)) {
        throw new ApiError(
          409,
          'INVALID_STATUS_TRANSITION',
          `Cannot move a shipment from ${shipment.status} to ${input.status}.`,
          { from: shipment.status, to: input.status, allowed }
        );
      }

      return {
        ...shipment,
        status: input.status,
        updatedAt: now,
        events: [
          ...shipment.events,
          {
            status: input.status,
            timestamp: now,
            description,
          },
        ],
      };
    });

    if (!updated) {
      throw new ApiError(
        404,
        'SHIPMENT_NOT_FOUND',
        `No shipment exists for tracking ID ${trackingId}.`
      );
    }

    return updated;
  }
}
