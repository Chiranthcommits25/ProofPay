import { RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, RotateCcw, Truck } from 'lucide-react';
import type { Order, TokenState, WalletState } from '../types';
import StatCard from '../components/ui/StatCard';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';
import OrdersTable from '../components/orders/OrdersTable';
import EmptyState from '../components/ui/EmptyState';
import EscrowLedger from '../components/ui/EscrowLedger';
import TokenBalance from '../components/ui/TokenBalance';
import SellerShipmentPanel from '../components/shipments/SellerShipmentPanel';
import { formatTokenAmount } from '../lib/contracts';
import { readEscrowOracle, shortOrderId } from '../lib/escrow';
import { shortAddress } from '../lib/wallet';

interface SellerDashboardProps {
  orders: Order[];
  wallet: WalletState;
  token: TokenState;
  onRefresh: () => void;
}

export default function SellerDashboard({
  orders,
  wallet,
  token,
  onRefresh,
}: SellerDashboardProps) {
  const [oracle, setOracle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readEscrowOracle().then(value => {
      if (!cancelled) setOracle(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const decimals = token.decimals || 18;
  const address = wallet.address?.toLowerCase() ?? '';

  // Only escrows where the connected wallet is the seller.
  const mine = address
    ? orders.filter(order => order.sellerAddress.toLowerCase() === address)
    : [];

  const funded = mine.filter(order => order.status === 'FUNDED');
  const released = mine.filter(order => order.status === 'RELEASED');
  const refunded = mine.filter(order => order.status === 'REFUNDED');

  const heldRaw = funded.reduce((sum, order) => sum + order.amountRaw, 0n);
  const paidRaw = released.reduce((sum, order) => sum + order.amountRaw, 0n);

  return (
    <main id="main" className="page-main">
      <div className="container-page page-stack">
        <PageHeader
          eyebrow="Seller"
          title="Seller dashboard"
          description="Escrow orders where the connected wallet is the seller."
          actions={
            <>
              {wallet.isConnected && <TokenBalance token={token} />}
              <button
                type="button"
                onClick={onRefresh}
                disabled={!wallet.isConnected || !wallet.isCorrectNetwork}
                className="btn btn-secondary btn-sm"
              >
                <RefreshCw size={13} />
                Refresh
              </button>
              {wallet.isConnected && (
                <span className="chip font-mono">
                  <span className="size-1.5 rounded-pill bg-success" />
                  {shortAddress(wallet.address ?? '')}
                </span>
              )}
            </>
          }
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard
            title="Funded orders"
            value={funded.length}
            subtitle="Awaiting settlement"
            icon={<Clock size={15} />}
            tone="accent"
          />
          <StatCard
            title="Held in escrow"
            value={formatTokenAmount(heldRaw, decimals)}
            unit="pUSD"
            subtitle="Not yet released"
            icon={<ShieldCheck size={15} />}
          />
          <StatCard
            title="Settled payments"
            value={formatTokenAmount(paidRaw, decimals)}
            unit="pUSD"
            subtitle={`${released.length} released`}
            icon={<CheckCircle2 size={15} />}
            tone="success"
          />
          <StatCard
            title="Refunded"
            value={refunded.length}
            subtitle="Failed deliveries"
            icon={<RotateCcw size={15} />}
            tone="danger"
          />
        </div>

        <section aria-label="Active escrow ledger">
          {funded.length > 0 ? (
            <div className="space-y-3">
              {funded.map(order => (
                <EscrowLedger key={order.id} order={order} />
              ))}
            </div>
          ) : (
            <div className="ledger">
              <div className="ledger-head">
                <span className="flex items-center gap-2">
                  <ShieldCheck size={12} className="shrink-0 text-accent-ink" aria-hidden="true" />
                  <span className="ledger-title">Escrow ledger</span>
                </span>
                <span className="ledger-total">
                  <span className="amount amount-sm">0</span>
                  <span className="ledger-unit">pUSD</span>
                </span>
              </div>
              <EmptyState
                icon={<ShieldCheck size={18} />}
                title={wallet.isConnected ? 'No active escrows' : 'Wallet not connected'}
                description={
                  wallet.isConnected
                    ? 'Escrows funded to this address appear here until they are settled.'
                    : 'Connect the seller wallet to view active escrows held for it.'
                }
              />
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12 xl:gap-6">
          <Panel
            className="xl:col-span-8"
            title="Incoming escrows"
            meta={
              <span className="section-meta">
                {mine.length} {mine.length === 1 ? 'order' : 'orders'}
              </span>
            }
          >
            <OrdersTable
              orders={mine}
              perspective="seller"
              emptyIcon={wallet.isConnected ? undefined : <Wallet size={18} />}
              emptyTitle={wallet.isConnected ? 'No escrow orders yet' : 'Wallet not connected'}
              emptyDescription={
                wallet.isConnected
                  ? 'Escrows funded to this address will appear here.'
                  : 'Connect the seller wallet to view escrows held for it.'
              }
            />
          </Panel>

          <div className="space-y-4 xl:col-span-4">
            <Panel
              title="Settlement"
              description="Funds are released by the escrow contract only."
            >
              <div className="space-y-3 text-body-xs">
                <p className="flex items-start gap-2 leading-5 text-ink-secondary">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0 text-accent-ink" />
                  <span>
                    There is no withdraw function. The full amount is paid to this wallet
                    when the oracle confirms delivery, and refunded to the buyer if it
                    confirms failure.
                  </span>
                </p>

                <dl className="space-y-2">
                  <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
                    <dt className="text-ink-muted">Held for you</dt>
                    <dd className="amount amount-sm">
                      {formatTokenAmount(heldRaw, decimals)}
                      <span className="ml-1 text-caption font-semibold text-ink-muted">
                        pUSD
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
                    <dt className="text-ink-muted">Oracle</dt>
                    <dd className="font-mono text-ink-secondary">
                      {oracle ? shortAddress(oracle) : '—'}
                    </dd>
                  </div>
                </dl>

                {funded.length > 0 && (
                  <p className="leading-5 text-ink-muted">
                    {funded.length === 1 ? 'One escrow is' : `${funded.length} escrows are`}{' '}
                    awaiting settlement, e.g.{' '}
                    <Link
                      to={`/order/${funded[0].id}`}
                      className="font-mono text-accent-ink hover:underline"
                    >
                      {shortOrderId(funded[0].id)}
                    </Link>
                    .
                  </p>
                )}

                <p className="flex items-start gap-1.5 leading-5 text-ink-muted">
                  <Truck size={12} className="mt-0.5 shrink-0" />
                  Shipment tracking is off-chain mock data and does not settle escrow.
                </p>
              </div>
            </Panel>

            <SellerShipmentPanel wallet={wallet} orders={orders} />
          </div>
        </div>
      </div>
    </main>
  );
}
