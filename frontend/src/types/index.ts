export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Populated exclusively from the injected MetaMask provider.
export interface WalletState {
  isConnected: boolean;
  address: string | null;
  chainId: number | null;
  network: string;
  ethBalance: string; // native balance in ETH, '' when unreadable
  isCorrectNetwork: boolean; // connected to Hardhat Local (31337)
  status: WalletStatus;
  error: string | null;
}

export type TokenStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TokenState {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  balance: bigint;
  balanceFormatted: string;
  owner: string | null;
  status: TokenStatus;
  error: string | null;
}

export type MintPhase = 'idle' | 'signing' | 'pending' | 'confirmed' | 'error';

export interface MintState {
  phase: MintPhase;
  hash: string | null;
  blockNumber: number | null;
  error: string | null;
}

/** Mirrors ProofPayEscrow.EscrowStatus, minus the unused `None`. */
export type EscrowStatus = 'FUNDED' | 'RELEASED' | 'REFUNDED';

/**
 * An escrow order. Every financial field mirrors `getEscrow()`.
 * `product` / `productDescription` / `sellerLabel` are off-chain display
 * metadata (see lib/metadata.ts) and never drive money logic.
 */
export interface Order {
  id: string; // bytes32 orderId
  buyerAddress: string;
  sellerAddress: string;
  amountRaw: bigint;
  amountDisplay: string;
  status: EscrowStatus;
  createdAt: number; // unix seconds
  settledAt: number | null; // unix seconds
  createdTxHash: string | null;
  settledTxHash: string | null;
  product: string;
  productDescription: string;
  sellerLabel: string;
}

export type EscrowTxPhase =
  | 'idle'
  | 'approving'
  | 'approved'
  | 'creating'
  | 'confirmed'
  | 'error';

export interface EscrowTxState {
  phase: EscrowTxPhase;
  /** Human-readable step shown while the flow runs. */
  step: string;
  approveHash: string | null;
  createHash: string | null;
  blockNumber: number | null;
  error: string | null;
  orderId: string | null;
}

export interface ActivityItem {
  id: string;
  orderId: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  icon: string;
}

export interface CheckoutItem {
  product: string;
  productDescription: string;
  seller: string;
  amount: number;
  category: string;
}

export type ShipmentStatus =
  | 'CREATED'
  | 'SHIPPED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'LOST'
  | 'RETURNED';

export interface ShipmentEvent {
  status: ShipmentStatus;
  timestamp: string; // ISO 8601
  description: string;
}

export interface Shipment {
  trackingId: string;
  orderId: string;
  carrier: string;
  sellerAddress: string;
  description: string | null;
  status: ShipmentStatus;
  simulated: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
  events: ShipmentEvent[];
}

export interface ShipmentListResponse {
  shipments: Shipment[];
  count: number;
  simulated: boolean;
}

export interface RegisterShipmentInput {
  orderId: string;
  trackingId: string;
  carrier: string;
  sellerAddress: string;
  description?: string;
}
