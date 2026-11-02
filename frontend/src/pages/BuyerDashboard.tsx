import { Link } from 'react-router-dom';
import { CheckCircle2, Lock, RefreshCw, RotateCcw, ShoppingBag, Wallet } from 'lucide-react';
import type { Order, ActivityItem, TokenState, WalletState } from '../types';
import StatCard from '../components/ui/StatCard';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';
import OrdersTable from '../components/orders/OrdersTable';
import ActivityFeed from '../components/ui/ActivityFeed';
import EmptyState from '../components/ui/EmptyState';
import EscrowLedger from '../components/ui/EscrowLedger';
import TokenBalance from '../components/ui/TokenBalance';
import { formatTokenAmount } from '../lib/contracts';

interface BuyerDashboardProps {
  orders: Order[];
  activities: ActivityItem[];
  wallet: WalletState;
  token: TokenState;
  onConnect: () => void;
  onRefresh: () => void;
}

export default function BuyerDashboard({
  orders,
  activities,
  wallet,
  token,
  onConnect,
  onRefresh,
}: BuyerDashboardProps) {
  const decimals = token.decimals || 18;
  const address = wallet.address?.toLowerCase() ?? '';

  // Only escrows where the connected wallet is the buyer.
  const mine = address
    ? orders.filter(order => order.buyerAddress.toLowerCase() === address)
    : [];

  const funded = mine.filter(order => order.status === 'FUNDED');
  const released = mine.filter(order => order.status === 'RELEASED');
  const refunded = mine.filter(order => order.status === 'REFUNDED');

  const mineIds = new Set(mine.map(order => order.id));
  const mineActivities = activities.filter(activity => mineIds.has(activity.orderId));

  const activeRaw = funded.reduce((sum, order) => sum + order.amountRaw, 0n);

  return (
    <main id="main" className="page-main">
      <div className="container-page page-stack">
        <PageHeader
          eyebrow="Buyer"
          title="Buyer dashboard"
          description="Escrow orders funded by the connected wallet, read from the contract."
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
              <Link to="/checkout" className="btn btn-primary">
                <ShoppingBag size={14} />
                New purchase
              </Link>
            </>
          }
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard
            title="Total purchases"
            value={mine.length}
            subtitle="Funded escrows"
            icon={<ShoppingBag size={15} />}
          />
          <StatCard
            title="Active escrow"
            value={formatTokenAmount(activeRaw, decimals)}
            unit="pUSD"
            subtitle={`${funded.length} ${funded.length === 1 ? 'order' : 'orders'} held`}
            icon={<Lock size={15} />}
            tone="accent"
          />
          <StatCard
            title="Completed"
            value={released.length}
            subtitle="Released to seller"
            icon={<CheckCircle2 size={15} />}
            tone="success"
          />
          <StatCard
            title="Refunded"
            value={refunded.length}
            subtitle="Returned to you"
            icon={<RotateCcw size={15} />}
            tone="warning"
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
                  <Lock size={12} className="shrink-0 text-accent-ink" aria-hidden="true" />
                  <span className="ledger-title">Escrow ledger</span>
                </span>
                <span className="ledger-total">
                  <span className="amount amount-sm">0</span>
                  <span className="ledger-unit">pUSD</span>
                </span>
              </div>
              <EmptyState
                icon={<Lock size={18} />}
                title={wallet.isConnected ? 'No active escrows' : 'Wallet not connected'}
                description={
                  wallet.isConnected
                    ? 'Fund an escrow from checkout. Each active order appears here until it is settled.'
                    : 'Connect your wallet to view escrows currently held for your address.'
                }
              />
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12 xl:gap-6">
          <Panel
            className="xl:col-span-8"
            title="Escrow orders"
            meta={<span className="section-meta">{mine.length} total</span>}
          >
            <OrdersTable
              orders={mine}
              perspective="buyer"
              emptyIcon={wallet.isConnected ? undefined : <Wallet size={18} />}
              emptyTitle={wallet.isConnected ? 'No escrow orders yet' : 'Wallet not connected'}
              emptyDescription={
                wallet.isConnected
                  ? 'Fund an escrow from checkout and it will appear here.'
                  : 'Connect your wallet to view escrow orders funded by your address.'
              }
              emptyAction={
                wallet.isConnected ? (
                  <Link to="/checkout" className="btn btn-subtle btn-sm">
                    Go to checkout
                  </Link>
                ) : (
                  <button type="button" onClick={onConnect} className="btn btn-primary btn-sm">
                    Connect wallet
                  </button>
                )
              }
            />
          </Panel>

          <Panel
            className="xl:col-span-4"
            title="Activity"
            meta={
              <span className="section-meta">
                {mineActivities.length} {mineActivities.length === 1 ? 'event' : 'events'}
              </span>
            }
            bodyClassName="max-h-[420px] overflow-y-auto"
          >
            <ActivityFeed activities={mineActivities} limit={8} />
          </Panel>
        </div>
      </div>
    </main>
  );
}
