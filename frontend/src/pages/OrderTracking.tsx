import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  Package,
  Radio,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import type { Order, WalletState } from '../types';
import StatusBadge from '../components/ui/StatusBadge';
import Panel from '../components/ui/Panel';
import EscrowLedger from '../components/ui/EscrowLedger';
import ShipmentDetails from '../components/shipments/ShipmentDetails';
import { useShipmentByOrder } from '../store/useShipment';
import { formatUnixDateTime } from '../lib/format';
import { shortAddress } from '../lib/wallet';

interface OrderTrackingProps {
  orders: Order[];
  wallet: WalletState;
  loading: boolean;
}

interface TimelineRow {
  title: string;
  description: string;
  timestamp: number | null;
  state: 'completed' | 'active' | 'pending' | 'error';
}

function buildTimeline(order: Order): TimelineRow[] {
  const rows: TimelineRow[] = [
    {
      title: 'Escrow funded',
      description: `${order.amountDisplay} pUSD locked in the escrow contract by ${shortAddress(order.buyerAddress)}`,
      timestamp: order.createdAt,
      state: 'completed',
    },
  ];

  if (order.status === 'FUNDED') {
    rows.push({
      title: 'Awaiting oracle settlement',
      description:
        'Release or refund is executed by the contract oracle. Mock shipment tracking is off-chain and does not settle escrow.',
      timestamp: null,
      state: 'active',
    });
    return rows;
  }

  rows.push({
    title: order.status === 'RELEASED' ? 'Released to seller' : 'Refunded to buyer',
    description:
      order.status === 'RELEASED'
        ? `${order.amountDisplay} pUSD paid to ${shortAddress(order.sellerAddress)}`
        : `${order.amountDisplay} pUSD returned to ${shortAddress(order.buyerAddress)}`,
    timestamp: order.settledAt,
    state: 'completed',
  });

  return rows;
}

function HashRow({ label, hash }: { label: string; hash: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!hash) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-muted">{label}</span>
        <span className="text-ink-muted">—</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="min-w-0 truncate font-mono text-caption text-ink-secondary" title={hash}>
        {hash.slice(0, 14)}…{hash.slice(-6)}
      </span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(hash);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        aria-label={`Copy ${label} hash`}
        className="icon-btn shrink-0"
      >
        {copied ? <Check size={12} className="text-success-ink" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

export default function OrderTracking({ orders, wallet, loading }: OrderTrackingProps) {
  const { orderId } = useParams<{ orderId: string }>();
  const order = orders.find(item => item.id.toLowerCase() === (orderId ?? '').toLowerCase());
  const shipmentState = useShipmentByOrder(order?.id ?? null);

  if (!order) {
    const syncing = loading && wallet.isConnected && wallet.isCorrectNetwork;

    return (
      <main id="main" className="page-main flex flex-1 items-center">
        <div className="container-page">
          <div className="card mx-auto max-w-md p-8 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-control border border-line bg-elevated text-ink-secondary">
              {syncing ? <Loader2 size={22} className="animate-spin" /> : <Package size={22} />}
            </span>
            <h1 className="mt-5 text-h2 text-ink">
              {syncing ? 'Reading escrow…' : 'Order not found'}
            </h1>
            <p className="mt-2 text-body text-ink-secondary">
              {syncing
                ? 'Reading the escrow record from ProofPayEscrow.'
                : wallet.isConnected && wallet.isCorrectNetwork
                  ? 'No escrow with this ID exists on the contract.'
                  : 'Connect MetaMask to Hardhat Local (31337) to read escrows from the contract.'}
            </p>
            {!syncing && (
              <Link to="/buyer" className="btn btn-primary mt-6">
                Return to dashboard
              </Link>
            )}
          </div>
        </div>
      </main>
    );
  }

  const timeline = buildTimeline(order);

  return (
    <main id="main" className="page-main">
      <div className="container-page page-stack">
        <div>
          <Link to="/buyer" className="btn btn-ghost btn-sm -ml-2">
            <ArrowLeft size={13} />
            Back to dashboard
          </Link>

          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="eyebrow">On-chain escrow</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1
                  className="font-mono text-h1 text-ink"
                  title={order.id}
                >
                  {order.id.slice(0, 12)}…
                </h1>
                <StatusBadge status={order.status} size="md" />
              </div>
              <p className="mt-2 text-body text-ink-secondary">
                {order.product || 'Product not recorded on-chain'}
                <span className="mx-2 text-line-strong">/</span>
                {order.sellerLabel || shortAddress(order.sellerAddress)}
              </p>
            </div>

            <div className="sm:text-right">
              <p className="eyebrow">Escrow amount</p>
              <p className="mt-2 flex items-baseline gap-1.5 sm:justify-end">
                <span className="amount amount-lg">{order.amountDisplay}</span>
                <span className="text-caption font-semibold tracking-[0.06em] text-ink-muted">
                  pUSD
                </span>
              </p>
            </div>
          </div>
        </div>

        <EscrowLedger order={order} />

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-6">
          <Panel className="lg:col-span-7" title="Escrow timeline" bodyClassName="panel-body">
            <div>
              {timeline.map((event, index) => {
                const isLast = index === timeline.length - 1;
                return (
                  <div key={event.title} className="relative flex gap-4">
                    {!isLast && (
                      <span
                        className={`absolute left-[13px] top-7 bottom-0 w-px ${
                          event.state === 'completed' ? 'bg-success/35' : 'bg-line'
                        }`}
                        aria-hidden="true"
                      />
                    )}

                    <div className="relative z-10 shrink-0">
                      {event.state === 'completed' ? (
                        <span className="flex size-[26px] items-center justify-center rounded-pill border border-success/30 bg-success/10 text-success-ink">
                          <CheckCircle2 size={14} />
                        </span>
                      ) : event.state === 'active' ? (
                        <span className="flex size-[26px] items-center justify-center rounded-pill border border-accent-ink/40 bg-accent-soft text-accent-strong">
                          <Radio size={11} />
                        </span>
                      ) : (
                        <span className="flex size-[26px] items-center justify-center rounded-pill border border-line bg-elevated text-ink-muted">
                          <Circle size={9} />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 pb-7">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="text-body font-medium text-ink">{event.title}</p>
                        <time className="text-label text-ink-muted">
                          {event.timestamp ? formatUnixDateTime(event.timestamp) : 'Pending'}
                        </time>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-ink-secondary">
                        {event.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel
            className="lg:col-span-5"
            title="Escrow record"
            description="Read from ProofPayEscrow.getEscrow()."
            meta={<span className="chip">On-chain</span>}
          >
            <div className="space-y-3 text-body-xs">
              <dl className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
                  <dt className="text-ink-muted">Buyer</dt>
                  <dd className="font-mono text-ink" title={order.buyerAddress}>
                    {shortAddress(order.buyerAddress)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
                  <dt className="text-ink-muted">Seller</dt>
                  <dd className="font-mono text-ink" title={order.sellerAddress}>
                    {shortAddress(order.sellerAddress)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
                  <dt className="text-ink-muted">Funded</dt>
                  <dd className="text-ink-secondary">
                    {formatUnixDateTime(order.createdAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
                  <dt className="text-ink-muted">Settled</dt>
                  <dd className="text-ink-secondary">
                    {order.settledAt ? formatUnixDateTime(order.settledAt) : 'Not settled'}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2 border-t border-line-soft pt-3">
                <HashRow label="Escrow tx" hash={order.createdTxHash} />
                <HashRow label="Settlement tx" hash={order.settledTxHash} />
              </div>

              <p className="flex items-start gap-1.5 border-t border-line-soft pt-3 leading-5 text-ink-muted">
                <ShieldCheck size={12} className="mt-0.5 shrink-0 text-accent-ink" />
                Settlement is a manual local-oracle action. Chainlink is not integrated
                in this phase.
              </p>
            </div>
          </Panel>
        </div>

        <Panel
          title="Shipment tracking"
          description="Mock courier data read from the ProofPay Express API."
          meta={<span className="chip">Simulated</span>}
          action={
            shipmentState.shipment ? (
              <button
                type="button"
                onClick={() => void shipmentState.refresh()}
                disabled={shipmentState.loading}
                className="btn btn-secondary btn-sm"
              >
                <RefreshCw size={13} />
                Refresh
              </button>
            ) : undefined
          }
        >
          {shipmentState.loading ? (
            <p className="flex items-center gap-2 text-body-sm text-ink-muted">
              <Loader2 size={14} className="animate-spin" />
              Loading shipment…
            </p>
          ) : shipmentState.error ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink"
            >
              <span className="flex items-start gap-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {shipmentState.error}
              </span>
              <button
                type="button"
                onClick={() => void shipmentState.refresh()}
                className="btn btn-secondary btn-sm shrink-0"
              >
                <RefreshCw size={13} />
                Retry
              </button>
            </div>
          ) : shipmentState.notFound ? (
            <div className="flex items-start gap-3 rounded-control border border-line bg-elevated px-4 py-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-secondary">
                <Truck size={16} />
              </span>
              <div>
                <p className="text-body font-medium text-ink">Shipment not registered yet</p>
                <p className="mt-1 text-body-sm leading-5 text-ink-muted">
                  The seller can register a mock shipment from the seller dashboard.
                  Shipment tracking does not settle escrow.
                </p>
              </div>
            </div>
          ) : shipmentState.shipment ? (
            <ShipmentDetails shipment={shipmentState.shipment} />
          ) : null}
        </Panel>

        {order.status === 'FUNDED' && (
          <div className="flex items-start gap-2 rounded-surface border border-line bg-surface px-4 py-3 text-body-xs text-ink-muted">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning-ink" />
            Funds remain in the escrow contract until the oracle confirms delivery or
            failure. Neither party can move them.
          </div>
        )}
      </div>
    </main>
  );
}
