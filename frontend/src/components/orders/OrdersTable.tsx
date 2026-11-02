import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Inbox } from 'lucide-react';
import type { Order } from '../../types';
import StatusBadge from '../ui/StatusBadge';
import EmptyState from '../ui/EmptyState';
import { formatUnixDate } from '../../lib/format';
import { shortTxHash } from '../../lib/escrow';
import { shortAddress } from '../../lib/wallet';

type Perspective = 'buyer' | 'seller' | 'admin';

interface OrdersTableProps {
  orders: Order[];
  perspective: Perspective;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}

function counterparty(order: Order, perspective: Perspective): string {
  if (perspective === 'seller') return shortAddress(order.buyerAddress);
  if (perspective === 'buyer') return shortAddress(order.sellerAddress);
  return `${shortAddress(order.buyerAddress)} → ${shortAddress(order.sellerAddress)}`;
}

export default function OrdersTable({
  orders,
  perspective,
  emptyIcon,
  emptyTitle = 'No escrow orders',
  emptyDescription = 'Escrow orders appear here once a payment is funded on-chain.',
  emptyAction,
}: OrdersTableProps) {
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon ?? <Inbox size={18} />}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Escrow</th>
            <th scope="col" className="text-right">
              Amount
            </th>
            <th scope="col">{perspective === 'admin' ? 'Parties' : 'Counterparty'}</th>
            <th scope="col">Created</th>
            <th scope="col" className="text-right">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => (
            <tr key={order.id}>
              <td className="whitespace-nowrap">
                <Link
                  to={`/order/${order.id}`}
                  className="font-mono text-body-sm font-medium text-accent-ink hover:underline"
                  title={order.id}
                >
                  {order.id.slice(0, 10)}…
                </Link>
                <p className="mt-1 max-w-[180px] truncate text-body-xs text-ink-muted">
                  {order.product || 'Product not recorded on-chain'}
                </p>
                {order.createdTxHash && (
                  <p
                    className="mt-1 max-w-[180px] truncate font-mono text-caption text-ink-muted"
                    title={order.createdTxHash}
                  >
                    fund {shortTxHash(order.createdTxHash)}
                  </p>
                )}
              </td>
              <td>
                <StatusBadge status={order.status} />
                {order.settledTxHash && (
                  <p
                    className="mt-1 max-w-[150px] truncate font-mono text-caption text-ink-muted"
                    title={order.settledTxHash}
                  >
                    settle {shortTxHash(order.settledTxHash)}
                  </p>
                )}
              </td>
              <td className="whitespace-nowrap text-right">
                <span className="amount amount-sm">{order.amountDisplay}</span>
                <span className="ml-1 text-caption font-semibold text-ink-muted">pUSD</span>
              </td>
              <td>
                <p className="font-mono text-body-xs text-ink-secondary">
                  {counterparty(order, perspective)}
                </p>
              </td>
              <td className="whitespace-nowrap">
                <p className="text-body-xs text-ink-secondary">
                  {formatUnixDate(order.createdAt)}
                </p>
              </td>
              <td className="whitespace-nowrap text-right">
                <Link
                  to={`/order/${order.id}`}
                  className="btn btn-ghost btn-sm px-2"
                  aria-label={`View ${order.id}`}
                  title="View on-chain escrow"
                >
                  <Eye size={14} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
