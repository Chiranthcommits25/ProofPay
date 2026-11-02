// ── EIP-1193 browser wallet helpers (MetaMask) ──
// No dependency: the injected provider exposes everything needed.

export interface Eip1193Provider {
  request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** Target network for local development. */
export const HARDHAT_LOCAL = {
  chainId: 31337,
  chainIdHex: '0x7a69',
  chainName: 'Hardhat Local',
  rpcUrls: ['http://127.0.0.1:8545'],
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
} as const;

const KNOWN_CHAINS: Record<number, string> = {
  1: 'Ethereum Mainnet',
  10: 'OP Mainnet',
  56: 'BNB Smart Chain',
  137: 'Polygon',
  8453: 'Base',
  17000: 'Holesky',
  42161: 'Arbitrum One',
  11155111: 'Sepolia',
  1337: 'Localhost',
  31337: 'Hardhat Local',
};

export function getChainName(chainId: number | null): string {
  if (chainId === null) return '';
  return KNOWN_CHAINS[chainId] ?? `Chain ${chainId}`;
}

export function parseChainId(hexChainId: string): number | null {
  const parsed = Number.parseInt(hexChainId, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null;
  return window.ethereum ?? null;
}

/** Wei (hex) → ETH string with up to 4 decimals, e.g. "10,000" or "0.425". */
export function formatEther(weiHex: string): string {
  try {
    const wei = BigInt(weiHex);
    const unit = 10n ** 18n;
    const whole = wei / unit;
    const fraction = (wei % unit)
      .toString()
      .padStart(18, '0')
      .slice(0, 4)
      .replace(/0+$/, '');
    const wholeFormatted = whole.toLocaleString('en-US');
    return fraction ? `${wholeFormatted}.${fraction}` : wholeFormatted;
  } catch {
    return '';
  }
}

/** 0x70997970…79C8 */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface ProviderError {
  code?: number;
  message?: string;
  data?: unknown;
  error?: { message?: string };
}

export function providerErrorText(error: unknown): string {
  const root = (error ?? {}) as ProviderError;
  const data = root.data as
    | string
    | { message?: string; originalError?: { message?: string } }
    | undefined;

  const parts = [
    root.message,
    root.error?.message,
    typeof data === 'string' ? data : data?.message,
    typeof data === 'object' && data ? data.originalError?.message : undefined,
  ];

  return parts.filter((part): part is string => typeof part === 'string').join(' ');
}

/**
 * Maps EIP-1193 error codes to copy a user can act on.
 * 4001 = rejected by user, -32002 = request already pending,
 * 4902 = chain not added to the wallet.
 */
export function walletErrorMessage(error: unknown, fallback: string): string {
  const { code } = (error ?? {}) as ProviderError;
  const message = providerErrorText(error);

  switch (code) {
    case 4001:
      return 'Request rejected in MetaMask.';
    case -32002:
      return 'A MetaMask request is already pending. Open the MetaMask extension to continue.';
    case 4902:
      return 'Hardhat Local is not added to MetaMask yet.';
    case -32603:
      return 'MetaMask could not complete the request. Check that Hardhat is running on 127.0.0.1:8545.';
  }

  if (typeof message === 'string' && message.length > 0 && message.length <= 160) {
    return message;
  }

  return fallback;
}
