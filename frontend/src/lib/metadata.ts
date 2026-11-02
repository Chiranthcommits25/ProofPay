/**
 * Off-chain order metadata.
 *
 * ProofPayEscrow stores only orderId, buyer, seller, amount, timestamps and
 * status. Product names/descriptions are not on-chain, so they live here in
 * localStorage, keyed by the on-chain orderId. This is display metadata only:
 * every financial field always comes from the contract.
 */

export interface OrderMetadata {
  product: string;
  description: string;
  sellerLabel: string;
}

const STORAGE_KEY = 'proofpay.orderMetadata.v1';

type MetadataMap = Record<string, OrderMetadata>;

function readAll(): MetadataMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MetadataMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function listOrderMetadata(): MetadataMap {
  return readAll();
}

export function getOrderMetadata(orderId: string): OrderMetadata | null {
  return readAll()[orderId] ?? null;
}

export function saveOrderMetadata(orderId: string, metadata: OrderMetadata): void {
  try {
    const all = readAll();
    all[orderId] = metadata;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked — metadata is non-critical.
  }
}

export function clearOrderMetadata(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
