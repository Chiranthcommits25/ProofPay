import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Loader2,
  Lock,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { TokenState, WalletState, CheckoutItem } from '../types';
import { DEMO_PRODUCTS } from '../data/mockData';
import { useEscrowActions } from '../store/useEscrowActions';
import {
  ZERO_ADDRESS,
  formatTokenAmount,
  isValidAddress,
  parseTokenAmount,
} from '../lib/contracts';
import { shortAddress } from '../lib/wallet';
import { escrowContractAddress, shortOrderId } from '../lib/escrow';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';

/** Seed seller account for the local demo — editable in the form. */
const DEFAULT_SELLER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

interface CheckoutPageProps {
  wallet: WalletState;
  token: TokenState;
  /** Called after a confirmed escrow so the app can re-read the chain. */
  onCreated: () => void;
}

interface FieldErrors {
  seller?: string;
  amount?: string;
}

export default function CheckoutPage({ wallet, token, onCreated }: CheckoutPageProps) {
  const decimals = token.decimals || 18;
  const { tx, createEscrow, reset } = useEscrowActions(wallet, decimals);

  const [selected, setSelected] = useState<CheckoutItem | null>(null);
  const [seller, setSeller] = useState(DEFAULT_SELLER);
  const [amount, setAmount] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [copied, setCopied] = useState<string | null>(null);

  const busy = tx.phase === 'approving' || tx.phase === 'approved' || tx.phase === 'creating';

  const parsed = parseTokenAmount(amount, decimals);
  const overBalance =
    token.status === 'ready' && parsed.error === null && parsed.value > token.balance;

  const selectProduct = (product: CheckoutItem) => {
    setSelected(product);
    setAmount(String(product.amount));
    setSeller(DEFAULT_SELLER);
    setFieldErrors({});
    reset();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;

    const next: FieldErrors = {};
    const sellerAddress = seller.trim();

    if (!isValidAddress(sellerAddress)) {
      next.seller = 'Enter a 0x address with 40 hex characters.';
    } else if (sellerAddress.toLowerCase() === ZERO_ADDRESS) {
      next.seller = 'The zero address cannot receive funds.';
    } else if (sellerAddress.toLowerCase() === (wallet.address ?? '').toLowerCase()) {
      next.seller = 'The seller cannot be your own wallet.';
    }

    if (parsed.error) next.amount = parsed.error;

    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;

    void createEscrow({
      seller: sellerAddress,
      amountRaw: parsed.value,
      product: selected.product,
      description: selected.productDescription,
      sellerLabel: selected.seller,
    }).then(orderId => {
      if (orderId) onCreated();
    });
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 2000);
  };

  const confirmed = tx.phase === 'confirmed' && tx.orderId;

  return (
    <main id="main" className="page-main">
      <div className="container-page page-stack">
        <PageHeader
          eyebrow="Buyer"
          title="Checkout"
          description="Fund a real escrow with pUSD. Funds are held by the escrow contract until settlement."
        />

        {!selected ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {DEMO_PRODUCTS.map((product, index) => (
              <button
                key={`${product.product}-${index}`}
                type="button"
                onClick={() => selectProduct(product)}
                className="card group flex flex-col justify-between p-5 text-left transition-colors hover:border-line-strong hover:bg-elevated/40"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="chip">{product.category}</span>
                    <span className="flex items-baseline gap-1 whitespace-nowrap">
                      <span className="amount amount-sm">
                        {formatTokenAmount(BigInt(product.amount) * 10n ** BigInt(decimals), decimals)}
                      </span>
                      <span className="text-caption font-semibold text-ink-muted">pUSD</span>
                    </span>
                  </div>

                  <h2 className="mt-5 text-h3 text-ink">{product.product}</h2>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-ink-secondary">
                    {product.productDescription}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 border-t border-line-soft pt-4">
                  <span className="flex min-w-0 items-center gap-1.5 text-body-xs text-ink-muted">
                    <Building2 size={12} className="shrink-0" />
                    <span className="truncate">{product.seller}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-body-xs font-medium text-accent-ink">
                    Select
                    <ChevronRight
                      size={12}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                reset();
              }}
              className="btn btn-ghost btn-sm -ml-2"
            >
              <ArrowLeft size={13} />
              Back to products
            </button>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-6">
              <div className="space-y-4 lg:col-span-8 lg:space-y-6">
                <Panel bodyClassName="panel-body">
                  <span className="chip">{selected.category}</span>
                  <h2 className="mt-4 text-h2 text-ink">{selected.product}</h2>
                  <p className="mt-2 max-w-2xl text-body text-ink-secondary">
                    {selected.productDescription}
                  </p>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line-soft pt-5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-control border border-line bg-elevated text-ink-secondary">
                        <Building2 size={14} />
                      </span>
                      <div>
                        <p className="text-body font-medium text-ink">{selected.seller}</p>
                        <p className="text-body-xs text-ink-muted">
                          Merchant label (off-chain)
                        </p>
                      </div>
                    </div>
                    <span className="chip font-mono">{shortAddress(seller)}</span>
                  </div>
                </Panel>

                <Panel
                  title="Escrow protection"
                  description="What the contract does with your payment."
                  bodyClassName="divide-y divide-line-soft"
                >
                  <div className="flex gap-4 px-6 py-4">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-elevated text-accent-ink">
                      <Lock size={14} />
                    </span>
                    <div>
                      <p className="text-body font-medium text-ink">Funds held by the contract</p>
                      <p className="mt-0.5 text-sm leading-5 text-ink-muted">
                        pUSD moves from your wallet into the escrow contract, not to the
                        seller.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4 px-6 py-4">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-elevated text-success-ink">
                      <CheckCircle2 size={14} />
                    </span>
                    <div>
                      <p className="text-body font-medium text-ink">Settlement by the oracle</p>
                      <p className="mt-0.5 text-sm leading-5 text-ink-muted">
                        Delivery releases the amount to the seller; failure refunds it to
                        you.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4 px-6 py-4">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-elevated text-ink-secondary">
                      <ShieldCheck size={14} />
                    </span>
                    <div>
                      <p className="text-body font-medium text-ink">Enforced on-chain</p>
                      <p className="mt-0.5 text-sm leading-5 text-ink-muted">
                        Contract{' '}
                        <span className="font-mono">{shortAddress(escrowContractAddress())}</span>{' '}
                        enforces the owner and oracle checks.
                      </p>
                    </div>
                  </div>
                </Panel>
              </div>

              <div className="lg:col-span-4 lg:sticky lg:top-24">
                <Panel title="Payment summary">
                  <form onSubmit={handleSubmit} noValidate className="space-y-4">
                    <div>
                      <label htmlFor="checkout-seller" className="field-label">
                        Seller wallet
                      </label>
                      <input
                        id="checkout-seller"
                        type="text"
                        value={seller}
                        onChange={event => {
                          setSeller(event.target.value);
                          if (fieldErrors.seller) {
                            setFieldErrors(prev => ({ ...prev, seller: undefined }));
                          }
                        }}
                        disabled={busy}
                        spellCheck={false}
                        autoComplete="off"
                        aria-invalid={Boolean(fieldErrors.seller)}
                        aria-describedby={fieldErrors.seller ? 'checkout-seller-error' : undefined}
                        className="field field-mono"
                      />
                      {fieldErrors.seller && (
                        <p
                          id="checkout-seller-error"
                          className="mt-1.5 flex items-start gap-1.5 text-body-xs leading-5 text-danger-ink"
                        >
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          {fieldErrors.seller}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="checkout-amount" className="field-label">
                        Escrow amount
                      </label>
                      <div className="relative">
                        <input
                          id="checkout-amount"
                          type="text"
                          inputMode="decimal"
                          value={amount}
                          onChange={event => {
                            setAmount(event.target.value);
                            if (fieldErrors.amount) {
                              setFieldErrors(prev => ({ ...prev, amount: undefined }));
                            }
                          }}
                          disabled={busy}
                          autoComplete="off"
                          aria-invalid={Boolean(fieldErrors.amount)}
                          aria-describedby={
                            fieldErrors.amount ? 'checkout-amount-error' : undefined
                          }
                          className="field pr-16 tabular-nums"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-caption font-semibold text-ink-muted">
                          pUSD
                        </span>
                      </div>
                      {fieldErrors.amount && (
                        <p
                          id="checkout-amount-error"
                          className="mt-1.5 flex items-start gap-1.5 text-body-xs leading-5 text-danger-ink"
                        >
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          {fieldErrors.amount}
                        </p>
                      )}
                    </div>

                    <dl className="space-y-3 text-body">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-ink-secondary">Escrowed total</dt>
                        <dd className="amount text-h3">
                          {parsed.error ? '—' : formatTokenAmount(parsed.value, decimals)}{' '}
                          <span className="text-caption font-semibold text-ink-muted">pUSD</span>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-3">
                        <dt className="text-ink-secondary">Escrow fee</dt>
                        <dd className="font-medium text-ink">0.00 pUSD</dd>
                      </div>
                    </dl>

                    <div className="space-y-3 rounded-control border border-line bg-elevated p-3.5 text-body-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-ink-muted">
                          <Wallet size={12} />
                          Your pUSD
                        </span>
                        <span className="flex items-baseline gap-1">
                          <span className="amount amount-xs">
                            {token.status === 'ready' ? token.balanceFormatted : '—'}
                          </span>
                          <span className="font-semibold text-accent-ink">
                            {token.symbol || 'pUSD'}
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ink-muted">ETH for gas</span>
                        <span className="flex items-baseline gap-1">
                          <span className="amount amount-xs">{wallet.ethBalance || '—'}</span>
                          <span className="font-semibold text-ink-muted">ETH</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ink-muted">Network</span>
                        <span className="text-right text-ink-secondary">
                          {wallet.network || 'Not connected'}
                          {wallet.chainId !== null && (
                            <span className="ml-1.5 font-mono text-caption text-ink-muted">
                              {wallet.chainId}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    {overBalance && (
                      <p className="flex items-start gap-1.5 text-body-xs leading-5 text-warning-ink">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        This amount exceeds your pUSD balance.
                      </p>
                    )}

                    {wallet.isConnected && !wallet.isCorrectNetwork && (
                      <p className="flex items-start gap-1.5 text-body-xs leading-5 text-warning-ink">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        Switch MetaMask to Hardhat Local (31337) before paying.
                      </p>
                    )}

                    <p role="status" aria-live="polite" className="sr-only">
                      {busy ? tx.step : tx.phase === 'confirmed' ? tx.step : ''}
                    </p>

                    <button
                      type="submit"
                      disabled={
                        busy ||
                        Boolean(confirmed) ||
                        !wallet.isConnected ||
                        !wallet.isCorrectNetwork ||
                        Boolean(parsed.error) ||
                        overBalance
                      }
                      aria-busy={busy}
                      className="btn btn-primary w-full"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                      {busy ? 'Processing…' : confirmed ? 'Payment confirmed' : `Confirm payment`}
                    </button>

                    <p className="flex items-center justify-center gap-1.5 text-center text-body-xs text-ink-muted">
                      <ShieldCheck size={12} />
                      You approve pUSD, then create the escrow.
                    </p>
                  </form>

                  {/* Live transaction states */}
                  {tx.phase !== 'idle' && !confirmed && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mt-4 space-y-2 rounded-control border border-line bg-elevated px-3 py-2.5"
                    >
                      <p className="flex items-center gap-2 text-body-xs font-medium text-ink">
                        {tx.error ? (
                          <AlertTriangle size={13} className="shrink-0 text-danger-ink" />
                        ) : (
                          <Loader2 size={13} className="shrink-0 animate-spin" />
                        )}
                        {tx.step || 'Preparing transaction…'}
                      </p>
                      {tx.approveHash && (
                        <HashLine
                          label="Approval"
                          hash={tx.approveHash}
                          copied={copied === tx.approveHash}
                          onCopy={copy}
                        />
                      )}
                      {tx.createHash && (
                        <HashLine
                          label="Escrow"
                          hash={tx.createHash}
                          copied={copied === tx.createHash}
                          onCopy={copy}
                        />
                      )}
                    </div>
                  )}

                  {tx.error && (
                    <p
                      role="alert"
                      className="mt-4 flex items-start gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink"
                    >
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      {tx.error}
                    </p>
                  )}

                  {confirmed && tx.orderId && (
                    <div
                      role="status"
                      className="mt-4 space-y-3 rounded-control border border-success/25 bg-success/10 px-3 py-3"
                    >
                      <p className="flex items-center gap-2 text-body-xs font-semibold text-success-ink">
                        <CheckCircle2 size={14} className="shrink-0" />
                        Escrow funded on-chain
                      </p>
                      <dl className="space-y-1.5 text-body-xs">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-ink-muted">Order</dt>
                          <dd className="font-mono text-ink" title={tx.orderId}>
                            {shortOrderId(tx.orderId)}
                          </dd>
                        </div>
                        {tx.blockNumber !== null && (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-ink-muted">Block</dt>
                            <dd className="text-ink-secondary">{tx.blockNumber}</dd>
                          </div>
                        )}
                      </dl>
                      {tx.createHash && (
                        <HashLine
                          label="Escrow tx"
                          hash={tx.createHash}
                          copied={copied === tx.createHash}
                          onCopy={copy}
                        />
                      )}
                      <Link to={`/order/${tx.orderId}`} className="btn btn-secondary btn-sm w-full">
                        View order
                      </Link>
                    </div>
                  )}
                </Panel>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function HashLine({
  label,
  hash,
  copied,
  onCopy,
}: {
  label: string;
  hash: string;
  copied: boolean;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <p className="min-w-0 text-caption text-ink-muted">
        <span className="mr-1 uppercase tracking-[0.1em]">{label}</span>
        <span className="font-mono break-all text-ink-secondary">{hash}</span>
      </p>
      <button
        type="button"
        onClick={() => onCopy(hash)}
        aria-label={`Copy ${label} transaction hash`}
        className="icon-btn shrink-0"
      >
        {copied ? <Check size={12} className="text-success-ink" /> : <Copy size={12} />}
      </button>
    </div>
  );
}
