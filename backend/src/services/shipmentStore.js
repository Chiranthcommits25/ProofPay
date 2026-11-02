import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SHIPMENT_STATUSES } from '../lib/validation.js';

const STATUS_SET = new Set(SHIPMENT_STATUSES);

export class ShipmentStorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShipmentStorageError';
  }
}

function assertShipmentShape(shipment, index) {
  const prefix = `shipments[${index}]`;

  if (!shipment || typeof shipment !== 'object' || Array.isArray(shipment)) {
    throw new ShipmentStorageError(`${prefix} must be an object.`);
  }

  for (const field of ['trackingId', 'orderId', 'carrier', 'sellerAddress']) {
    if (typeof shipment[field] !== 'string' || shipment[field].length === 0) {
      throw new ShipmentStorageError(`${prefix}.${field} is missing or invalid.`);
    }
  }

  if (!STATUS_SET.has(shipment.status)) {
    throw new ShipmentStorageError(`${prefix}.status is invalid.`);
  }

  if (typeof shipment.createdAt !== 'string' || typeof shipment.updatedAt !== 'string') {
    throw new ShipmentStorageError(`${prefix} timestamps are missing or invalid.`);
  }

  if (!Array.isArray(shipment.events)) {
    throw new ShipmentStorageError(`${prefix}.events must be an array.`);
  }
}

/**
 * JSON-file persistence for mock shipments.
 *
 * - The file is read once at startup; mutations are kept in memory and written
 *   through a serialized queue.
 * - Writes go to a temporary file in the same directory and are renamed into
 *   place, so a crash cannot leave a half-written JSON document.
 * - Corrupt JSON fails startup instead of silently discarding shipment history.
 */
export class ShipmentStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.shipments = [];
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.shipments;

      if (!Array.isArray(list)) {
        throw new ShipmentStorageError(
          `Shipment data file must contain a shipments array: ${this.filePath}`
        );
      }

      list.forEach(assertShipmentShape);
      this.shipments = list;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.shipments = [];
        await this.persist();
        return;
      }

      if (error instanceof ShipmentStorageError) throw error;

      if (error instanceof SyntaxError) {
        throw new ShipmentStorageError(
          `Shipment data file is not valid JSON: ${this.filePath}`
        );
      }

      throw new ShipmentStorageError(
        `Could not read shipment data file: ${error?.message ?? 'unknown error'}`
      );
    }
  }

  list() {
    return this.shipments.map(shipment => structuredClone(shipment));
  }

  findByTrackingId(trackingId) {
    const match = this.shipments.find(
      shipment => shipment.trackingId.toUpperCase() === trackingId.toUpperCase()
    );
    return match ? structuredClone(match) : null;
  }

  findByOrderId(orderId) {
    const match = this.shipments.find(
      shipment => shipment.orderId.toLowerCase() === orderId.toLowerCase()
    );
    return match ? structuredClone(match) : null;
  }

  async add(shipment) {
    this.shipments.push(structuredClone(shipment));
    await this.persist();
    return structuredClone(shipment);
  }

  async update(trackingId, updater) {
    const index = this.shipments.findIndex(
      shipment => shipment.trackingId.toUpperCase() === trackingId.toUpperCase()
    );

    if (index === -1) return null;

    const next = updater(structuredClone(this.shipments[index]));
    this.shipments[index] = structuredClone(next);
    await this.persist();
    return structuredClone(next);
  }

  async persist() {
    const payload = `${JSON.stringify({ version: 1, shipments: this.shipments }, null, 2)}\n`;

    // Recover from a previous failed write so later mutations can still persist.
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });

      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;

      try {
        await writeFile(temporaryPath, payload, 'utf8');
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {});
        throw new ShipmentStorageError(
          `Could not persist shipment data: ${error?.message ?? 'unknown error'}`
        );
      }
    });

    return this.writeQueue;
  }
}
