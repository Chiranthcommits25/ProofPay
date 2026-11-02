import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Coins, Copy, Check, Loader2, ShieldCheck } from 'lucide-react';
import type { TokenState, WalletState } from '../../types';
import { useMintToken } from '../../store/useMintToken';
import {
  ZERO_ADDRESS,
  formatTokenAmount,
  isValidAddress,
  parseTokenAmount,
} from '../../lib/contracts';
import { shortAddress } from '../../lib/wallet';
import Panel from '../ui/Panel';

interface MintPanelProps {
  wallet: WalletState;
  token: TokenState;
  onSettled: () => void;
}

interface FieldErrors {
  recipient?: string;
  amount?: string;
}

export default function MintPanel({ wallet, token, onSettled }: MintPanelProps) {
  const { mintState, mint, reset } = useMintToken(wallet, token, onSettled);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [copied, setCopied] = useState(false);

  const decimals = token.decimals || 18;
  const busy = mintState.phase === 'signing' || mintState.phase === 'pending';

  const isOwner =
    Boolean(wallet.address) &&
    Boolean(token.owner) &&
    wallet.address?.toLowerCase() === token.owner?.toLowerCase();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const next: FieldErrors = {};
    const address = recipient.trim();

    if (!address) {
      next.recipient = 'Recipient address is required.';
    } else if (!isValidAddress(address)) {
      next.recipient = 'Enter a 0x address with 40 hex characters.';
    } else if (address.toLowerCase() === ZERO_ADDRESS) {
      next.recipient = 'The zero address cannot receive tokens.';
    }

    const parsed = parseTokenAmount(amount, decimals);
    if (parsed.error) next.amount = parsed.error;

    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;

    void mint(address, amount);
  };

  const copyHash = () => {
    if (!mintState.hash) return;
    void navigator.clipboard.writeText(mintState.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Panel
      title="Mint pUSD"
      description="Owner-only issuance. The token contract enforces the owner check on-chain."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Owner status — a hint only; the contract is the authority. */}
        {wallet.isConnected && token.owner && (
          <p
            className={`flex items-start gap-2 text-body-xs leading-5 ${
              isOwner ? 'text-success-ink' : 'text-warning-ink'
            }`}
          >
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            {isOwner
              ? 'This wallet is the contract owner and can mint.'
              : `Only ${shortAddress(token.owner)} can mint. A transaction from this wallet will revert on-chain.`}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="mint-recipient" className="field-label">
              Recipient address
            </label>
            <input
              id="mint-recipient"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={recipient}
              onChange={event => {
                setRecipient(event.target.value);
                if (fieldErrors.recipient) {
                  setFieldErrors(prev => ({ ...prev, recipient: undefined }));
                }
              }}
              placeholder="0x…"
              disabled={busy}
              aria-invalid={Boolean(fieldErrors.recipient)}
              aria-describedby={fieldErrors.recipient ? 'mint-recipient-error' : undefined}
              className="field field-mono"
            />
            {fieldErrors.recipient && (
              <p
                id="mint-recipient-error"
                className="mt-1.5 flex items-start gap-1.5 text-body-xs leading-5 text-danger-ink"
              >
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {fieldErrors.recipient}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="mint-amount" className="field-label">
              Amount
            </label>
            <div className="relative">
              <input
                id="mint-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={event => {
                  setAmount(event.target.value);
                  if (fieldErrors.amount) {
                    setFieldErrors(prev => ({ ...prev, amount: undefined }));
                  }
                }}
                placeholder="0.00"
                disabled={busy}
                aria-invalid={Boolean(fieldErrors.amount)}
                aria-describedby={fieldErrors.amount ? 'mint-amount-error' : undefined}
                className="field pr-16 tabular-nums"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-caption font-semibold text-ink-muted">
                {token.symbol || 'pUSD'}
              </span>
            </div>
            {fieldErrors.amount && (
              <p
                id="mint-amount-error"
                className="mt-1.5 flex items-start gap-1.5 text-body-xs leading-5 text-danger-ink"
              >
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {fieldErrors.amount}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="submit"
            disabled={busy || !wallet.isConnected || !wallet.isCorrectNetwork}
            aria-busy={busy}
            className="btn btn-primary"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}
            {mintState.phase === 'signing'
              ? 'Confirm in MetaMask…'
              : mintState.phase === 'pending'
                ? 'Mining…'
                : `Mint ${token.symbol || 'pUSD'}`}
          </button>

          {mintState.phase !== 'idle' && !busy && (
            <button type="button" onClick={reset} className="btn btn-ghost btn-sm">
              Clear
            </button>
          )}

          <p className="text-body-xs text-ink-muted">
            Contract{' '}
            <span className="font-mono text-ink-secondary">
              {token.totalSupply > 0n
                ? `supply ${formatTokenAmount(token.totalSupply, decimals, 0)}`
                : 'supply —'}
            </span>
          </p>
        </div>

        {/* Errors: rejected, reverted, unaffordable gas */}
        {mintState.error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {mintState.error}
          </p>
        )}

        {/* Progress and confirmation */}
        {(mintState.phase === 'signing' ||
          mintState.phase === 'pending' ||
          mintState.phase === 'confirmed') && (
          <div
            role="status"
            aria-live="polite"
            className="space-y-2 rounded-control border border-line bg-elevated px-3 py-2.5"
          >
            <p
              className={`flex items-center gap-2 text-body-xs font-medium ${
                mintState.phase === 'confirmed' ? 'text-success-ink' : 'text-ink'
              }`}
            >
              {mintState.phase === 'confirmed' ? (
                <CheckCircle2 size={13} className="shrink-0" />
              ) : (
                <Loader2 size={13} className="shrink-0 animate-spin" />
              )}
              {mintState.phase === 'signing' && 'Waiting for approval in MetaMask…'}
              {mintState.phase === 'pending' && 'Submitted. Waiting for the receipt…'}
              {mintState.phase === 'confirmed' &&
                `Confirmed${mintState.blockNumber !== null ? ` in block ${mintState.blockNumber}` : ''}.`}
            </p>

            {mintState.hash && (
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-mono text-caption leading-5 break-all text-ink-muted">
                  {/* Full hash is shown, not truncated — it is the receipt */}
                  {mintState.hash}
                </p>
                <button
                  type="button"
                  onClick={copyHash}
                  aria-label="Copy transaction hash"
                  className="icon-btn shrink-0"
                >
                  {copied ? (
                    <Check size={12} className="text-success-ink" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {!wallet.isConnected && (
          <p className="text-body-xs text-ink-muted">
            Connect MetaMask to mint ProofPay USD.
          </p>
        )}
      </form>
    </Panel>
  );
}
