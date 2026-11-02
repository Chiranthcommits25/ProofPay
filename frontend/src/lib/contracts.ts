import { HARDHAT_LOCAL, getProvider } from './wallet';

export const PROOFPAY_USD_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
export const ESCROW_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as const;

export const TOKEN_CHAIN_ID = HARDHAT_LOCAL.chainId;

/**
 * Function selectors, verified against the deployed bytecode:
 * keccak256(signature)[0..4]. Only the surface ProofPay needs.
 */
export const SELECTORS = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  balanceOf: '0x70a08231',
  owner: '0x8da5cb5b',
  mint: '0x40c10f19', // mint(address,uint256)
  approve: '0x095ea7b3', // approve(address,uint256)
  allowance: '0xdd62ed3e', // allowance(address,address)
} as const;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const stripHex = (hex: string) => (hex.startsWith('0x') ? hex.slice(2) : hex);

function padWord(hex: string): string {
  return stripHex(hex).padStart(64, '0');
}

export function encodeAddress(address: string): string {
  return padWord(address.toLowerCase());
}

export function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

export function decodeUint(hex: string): bigint {
  return BigInt(`0x${stripHex(hex).slice(0, 64)}`);
}

export function decodeAddress(hex: string): string {
  return `0x${stripHex(hex).slice(24, 64)}`;
}

/** Decodes a single ABI-encoded `string` (offset + length + utf8 bytes). */
export function decodeString(hex: string): string {
  const data = stripHex(hex);
  if (data.length < 128) return '';

  const offset = Number.parseInt(data.slice(0, 64), 16) * 2;
  const length = Number.parseInt(data.slice(offset, offset + 64), 16) * 2;
  const bytes = data.slice(offset + 64, offset + 64 + length);

  let output = '';
  for (let i = 0; i < bytes.length; i += 2) {
    output += String.fromCharCode(Number.parseInt(bytes.slice(i, i + 2), 16));
  }
  return output;
}

export function buildMintCalldata(recipient: string, amount: bigint): string {
  return `${SELECTORS.mint}${encodeAddress(recipient)}${encodeUint(amount)}`;
}

async function ethCall(data: string): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error('No injected wallet provider available.');

  return provider.request<string>({
    method: 'eth_call',
    params: [{ to: PROOFPAY_USD_ADDRESS, data }, 'latest'],
  });
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

export async function readTokenMetadata(): Promise<TokenMetadata> {
  const [nameRaw, symbolRaw, decimalsRaw, supplyRaw] = await Promise.all([
    ethCall(SELECTORS.name),
    ethCall(SELECTORS.symbol),
    ethCall(SELECTORS.decimals),
    ethCall(SELECTORS.totalSupply),
  ]);

  let name = '';
  let symbol = '';
  try {
    name = decodeString(nameRaw);
    symbol = decodeString(symbolRaw);
  } catch {
    // Non-standard string encoding — fall through to empty labels.
  }

  const decimals = Number(decodeUint(decimalsRaw));

  return {
    name: name || 'ProofPay USD',
    symbol: symbol || 'pUSD',
    decimals: Number.isFinite(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18,
    totalSupply: decodeUint(supplyRaw),
  };
}

export async function readTokenBalance(holder: string): Promise<bigint> {
  return decodeUint(await ethCall(`${SELECTORS.balanceOf}${encodeAddress(holder)}`));
}

export async function readTokenOwner(): Promise<string | null> {
  try {
    return decodeAddress(await ethCall(SELECTORS.owner));
  } catch {
    return null;
  }
}

/** ERC-20 allowance an owner has granted to a spender. */
export async function readAllowance(owner: string, spender: string): Promise<bigint> {
  const data = `${SELECTORS.allowance}${encodeAddress(owner)}${encodeAddress(spender)}`;
  return decodeUint(await ethCall(data));
}

export function buildApproveCalldata(spender: string, amount: bigint): string {
  return `${SELECTORS.approve}${encodeAddress(spender)}${encodeUint(amount)}`;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function isValidAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value.trim());
}

export interface ParseResult {
  /** Base units; 0n when the input is invalid. */
  value: bigint;
  /** Human-readable problem, or null when the value is usable. */
  error: string | null;
}

/** "1,250.5" + 18 decimals → 1250500000000000000000n */
export function parseTokenAmount(input: string, decimals: number): ParseResult {
  const invalid = (error: string): ParseResult => ({ value: 0n, error });
  const cleaned = input.trim().replace(/,/g, '');

  if (cleaned === '') return invalid('Enter an amount.');
  if (!/^\d*(\.\d*)?$/.test(cleaned)) {
    return invalid('Use digits with a single decimal point.');
  }

  const [wholePart = '', fractionPart = ''] = cleaned.split('.');

  if (wholePart.length > 30) return invalid('That amount is too large.');
  if (fractionPart.length > decimals) {
    return invalid(`At most ${decimals} decimal places.`);
  }

  const whole = wholePart === '' ? 0n : BigInt(wholePart);
  const fraction = fractionPart === '' ? 0n : BigInt(fractionPart.padEnd(decimals, '0'));
  const value = whole * 10n ** BigInt(decimals) + fraction;

  if (value <= 0n) return invalid('Amount must be greater than zero.');

  return { value, error: null };
}

/** 1250500000000000000000n + 18 → "1,250.5" */
export function formatTokenAmount(
  raw: bigint,
  decimals: number,
  maxFractionDigits = 2
): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;

  let fraction = (abs % unit).toString().padStart(decimals, '0');
  if (maxFractionDigits < decimals) fraction = fraction.slice(0, maxFractionDigits);
  fraction = fraction.replace(/0+$/, '');

  // A non-zero balance that rounds away is shown as "<0.01", never as "0".
  if (abs > 0n && whole === 0n && fraction === '' && maxFractionDigits > 0) {
    return `<0.${'0'.repeat(maxFractionDigits - 1)}1`;
  }

  const wholeFormatted = whole.toLocaleString('en-US');
  return `${negative ? '-' : ''}${wholeFormatted}${fraction ? `.${fraction}` : ''}`;
}
