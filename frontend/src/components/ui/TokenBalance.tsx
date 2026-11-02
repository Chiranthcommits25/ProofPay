import type { TokenState } from '../../types';

interface TokenBalanceProps {
  token: TokenState;
  className?: string;
}

/**
 * Compact pUSD balance chip. Shows an em dash until a real balance has been
 * read from the contract — never a placeholder number.
 */
export default function TokenBalance({ token, className = '' }: TokenBalanceProps) {
  const ready = token.status === 'ready';

  return (
    <span
      className={`chip ${className}`}
      title={
        ready
          ? `${token.balanceFormatted} ${token.symbol}`
          : 'Token balance unavailable'
      }
    >
      <span
        className={`size-1.5 rounded-pill ${
          token.status === 'error' ? 'bg-danger' : 'bg-accent'
        }`}
        aria-hidden="true"
      />
      <span className="amount amount-xs text-ink">
        {ready ? token.balanceFormatted : '—'}
      </span>
      <span className="font-semibold text-accent-ink">{token.symbol || 'pUSD'}</span>
    </span>
  );
}
