import { CheckCircle2, DollarSign, RefreshCw, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { Order, ActivityItem, TokenState, WalletState } from '../types';
import StatCard from '../components/ui/StatCard';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';
import OrdersTable from '../components/orders/OrdersTable';
import ActivityFeed from '../components/ui/ActivityFeed';
import TokenBalance from '../components/ui/TokenBalance';
import MintPanel from '../components/admin/MintPanel';
import OraclePanel from '../components/admin/OraclePanel';
import ShipmentSimulatorPanel from '../components/admin/ShipmentSimulatorPanel';
import { formatTokenAmount } from '../lib/contracts';

interface AdminDashboardProps {
  orders: Order[];
  activities: ActivityItem[];
  wallet: WalletState;
  token: TokenState;
  /** Re-reads escrows and balances after a transaction settles. */
  onRefresh: () => void;
}

export default function AdminDashboard({
  orders,
  activities,
  wallet,
  token,
  onRefresh,
}: AdminDashboardProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const decimals = token.decimals || 18;

  const totalVolume = orders.reduce((sum, order) => sum + order.amountRaw, 0n);
  const funded = orders.filter(order => order.status === 'FUNDED');
  const released = orders.filter(order => order.status === 'RELEASED');
  const refunded = orders.filter(order => order.status === 'REFUNDED');

  const query = searchTerm.trim().toLowerCase();
  const filtered = query
    ? orders.filter(
        order =>
          order.id.toLowerCase().includes(query) ||
          order.product.toLowerCase().includes(query) ||
          order.buyerAddress.toLowerCase().includes(query) ||
          order.sellerAddress.toLowerCase().includes(query)
      )
    : orders;

  return (
    <main id="main" className="page-main">
      <div className="container-page page-stack">
        <PageHeader
          eyebrow="Admin"
          title="Admin dashboard"
          description="On-chain escrow monitoring and oracle settlement."
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
            </>
          }
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard
            title="Escrow volume"
            value={formatTokenAmount(totalVolume, decimals)}
            unit="pUSD"
            subtitle={`${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`}
            icon={<DollarSign size={15} />}
            tone="accent"
          />
          <StatCard
            title="Funded escrows"
            value={funded.length}
            subtitle="Awaiting settlement"
            icon={<ShieldCheck size={15} />}
          />
          <StatCard
            title="Released"
            value={released.length}
            subtitle="Paid to sellers"
            icon={<CheckCircle2 size={15} />}
            tone="success"
          />
          <StatCard
            title="Refunded"
            value={refunded.length}
            subtitle="Returned to buyers"
            icon={<RotateCcw size={15} />}
            tone="danger"
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 xl:gap-6">
          <MintPanel wallet={wallet} token={token} onSettled={onRefresh} />
          <OraclePanel wallet={wallet} orders={orders} onSettled={onRefresh} />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-1 xl:gap-6">
          <ShipmentSimulatorPanel />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12 xl:gap-6">
          <Panel
            className="xl:col-span-8"
            title="All escrows"
            meta={
              <div className="relative w-40 sm:w-64">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                />
                <input
                  type="text"
                  placeholder="Search orders"
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                  aria-label="Search escrow orders"
                  className="field h-9 pl-8 text-body-sm"
                />
              </div>
            }
          >
            <OrdersTable
              orders={filtered}
              perspective="admin"
              emptyTitle={query ? 'No matching orders' : 'No escrows yet'}
              emptyDescription={
                query
                  ? 'Try a different order ID, product or address.'
                  : 'Escrows appear here once a buyer funds one on-chain.'
              }
            />
          </Panel>

          <Panel
            className="xl:col-span-4"
            title="Activity log"
            meta={
              <span className="section-meta">
                {activities.length} {activities.length === 1 ? 'event' : 'events'}
              </span>
            }
            bodyClassName="max-h-[420px] overflow-y-auto"
          >
            <ActivityFeed activities={activities} limit={8} />
          </Panel>
        </div>

        <div className="flex items-center gap-2 rounded-surface border border-line bg-surface px-4 py-3 text-body-xs text-ink-muted">
          <ShieldCheck size={13} className="shrink-0 text-success-ink" />
          Settlement is executed by the escrow contract. The oracle check is enforced
          on-chain, not in this interface.
        </div>
      </div>
    </main>
  );
}
