import { getProvider } from './wallet';
import { PROOFPAY_USD_ADDRESS, encodeAddress, encodeUint } from './contracts';

export const ESCROW_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as const;

/**
 * Selectors verified against solc's evm.methodIdentifiers for the deployed build.
 * Never hand-edit — regenerate from the artifact if the contract changes.
 */
export const ESCROW_SELECTORS = {
  getEscrow: '0xf023b811', // getEscrow(bytes32)
  createEscrow: '0x6e629653', // createEscrow(bytes32,address,address,uint256)
  confirmDelivery: '0x74950ffd', // confirmDelivery(bytes32)
  confirmFailure: '0x441e0739', // confirmFailure(bytes32)
  oracle: '0x7dc0d1d0', // oracle()
  paymentToken: '0x3013ce29', // paymentToken()
} as const;

/** topic0 = keccak256 of the canonical event signature. */
export const ESCROW_TOPICS = {
  created:
    '0x0dd968c277d9dc6b36b6ec2b638324c3d937882c64ca109440bc050ebf26cb07',
  released:
    '0x3a9c1cd29cd3be251a72ce3c367c27dc1cb697ac4589965b76a83f9a25ca0710',
  refunded:
    '0xfc31a7ddbe933aa6e67f3c98c183fbc87addd2b602fcfb10238d2f85cf026617',
} as const;

/** enum EscrowStatus { None, Funded, Released, Refunded } */
export const ESCROW_CHAIN_STATUS = {
  None: 0,
  Funded: 1,
  Released: 2,
  Refunded: 3,
} as const;

export type EscrowChainStatus = 0 | 1 | 2 | 3;

export interface EscrowRecord {
  orderId: string;
  buyer: string;
  seller: string;
  amount: bigint;
  createdAt: number;
  settledAt: number;
  status: EscrowChainStatus;
}

const stripHex = (hex: string) => (hex.startsWith('0x') ? hex.slice(2) : hex);

function wordAt(data: string, index: number): string {
  const raw = stripHex(data);
  return raw.slice(index * 64, (index + 1) * 64);
}

/** bytes32 is left-aligned — no numeric padding. */
export function encodeBytes32(orderId: string): string {
  return stripHex(orderId).padEnd(64, '0').slice(0, 64);
}

/** `getEscrow` returns 7 static words. */
export function decodeEscrow(hex: string): EscrowRecord {
  return {
    orderId: `0x${wordAt(hex, 0)}`,
    buyer: `0x${wordAt(hex, 1).slice(24)}`,
    seller: `0x${wordAt(hex, 2).slice(24)}`,
    amount: BigInt(`0x${wordAt(hex, 3) || '0'}`),
    createdAt: Number(BigInt(`0x${wordAt(hex, 4) || '0'}`)),
    settledAt: Number(BigInt(`0x${wordAt(hex, 5) || '0'}`)),
    status: Number(BigInt(`0x${wordAt(hex, 6) || '0'}`)) as EscrowChainStatus,
  };
}

async function ethCall(data: string): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error('No injected wallet provider available.');
  return provider.request<string>({
    method: 'eth_call',
    params: [{ to: ESCROW_ADDRESS, data }, 'latest'],
  });
}

/** Returns null when the contract reports EscrowNotFound. */
export async function readEscrow(orderId: string): Promise<EscrowRecord | null> {
  try {
    const hex = await ethCall(`${ESCROW_SELECTORS.getEscrow}${encodeBytes32(orderId)}`);
    const record = decodeEscrow(hex);
    return record.status === ESCROW_CHAIN_STATUS.None ? null : record;
  } catch {
    return null;
  }
}

export async function readEscrowOracle(): Promise<string | null> {
  try {
    const hex = await ethCall(ESCROW_SELECTORS.oracle);
    return `0x${stripHex(hex).slice(24, 64)}`;
  } catch {
    return null;
  }
}

export async function readPaymentToken(): Promise<string | null> {
  try {
    const hex = await ethCall(ESCROW_SELECTORS.paymentToken);
    return `0x${stripHex(hex).slice(24, 64)}`;
  } catch {
    return null;
  }
}

export function buildCreateEscrowCalldata(
  orderId: string,
  buyer: string,
  seller: string,
  amount: bigint
): string {
  return `${ESCROW_SELECTORS.createEscrow}${encodeBytes32(orderId)}${encodeAddress(
    buyer
  )}${encodeAddress(seller)}${encodeUint(amount)}`;
}

export function buildConfirmDeliveryCalldata(orderId: string): string {
  return `${ESCROW_SELECTORS.confirmDelivery}${encodeBytes32(orderId)}`;
}

export function buildConfirmFailureCalldata(orderId: string): string {
  return `${ESCROW_SELECTORS.confirmFailure}${encodeBytes32(orderId)}`;
}

// Escrows live in a private mapping with no enumerator, so order IDs are
// discovered from logs and every field is re-read via getEscrow(). Logs are used
// for discovery only, never as the source of financial truth.
export interface EscrowLogIndex {
  orderIds: string[];
  createdTx: Record<string, string>;
  settlement: Record<string, { hash: string; kind: 'released' | 'refunded' }>;
}

interface RawLog {
  topics: string[];
  data: string;
  transactionHash: string;
}

export async function readEscrowLogs(): Promise<EscrowLogIndex> {
  const provider = getProvider();
  if (!provider) throw new Error('No injected wallet provider available.');

  const logs = await provider.request<RawLog[]>({
    method: 'eth_getLogs',
    params: [{ address: ESCROW_ADDRESS, fromBlock: '0x0', toBlock: 'latest' }],
  });

  const index: EscrowLogIndex = { orderIds: [], createdTx: {}, settlement: {} };

  for (const log of logs) {
    const topic0 = log.topics[0];
    const orderId = log.topics[1];
    if (!orderId) continue;

    if (topic0 === ESCROW_TOPICS.created) {
      if (!index.createdTx[orderId]) index.orderIds.push(orderId);
      index.createdTx[orderId] = log.transactionHash;
    } else if (topic0 === ESCROW_TOPICS.released) {
      index.settlement[orderId] = { hash: log.transactionHash, kind: 'released' };
    } else if (topic0 === ESCROW_TOPICS.refunded) {
      index.settlement[orderId] = { hash: log.transactionHash, kind: 'refunded' };
    }
  }

  return index;
}

/** 32 random bytes — unique per escrow, never derived from user input. */
export function generateOrderId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** 0x3f9a1c72… for table cells; the full hash stays available via title/copy. */
export function shortOrderId(orderId: string): string {
  return `${orderId.slice(0, 10)}…`;
}

/** 0x3519d82c…f8be for compact transaction references. */
export function shortTxHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-4)}`;
}

export function escrowContractAddress(): string {
  return ESCROW_ADDRESS;
}

export function paymentTokenAddress(): string {
  return PROOFPAY_USD_ADDRESS;
}
