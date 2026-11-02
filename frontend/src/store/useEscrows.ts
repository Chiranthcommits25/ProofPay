import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityItem, Order, WalletState } from '../types';
import { ESCROW_CHAIN_STATUS, readEscrow, readEscrowLogs, shortOrderId } from '../lib/escrow';
import { formatTokenAmount } from '../lib/contracts';
import { listOrderMetadata } from '../lib/metadata';
import { getProvider, shortAddress } from '../lib/wallet';

export interface UseEscrowsResult {
  orders: Order[];
  activities: ActivityItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const isoFromUnix = (seconds: number) => new Date(seconds * 1000).toISOString();

function buildActivities(orders: Order[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const order of orders) {
    const label = order.product || shortOrderId(order.id);

    items.push({
      id: `${order.id}-created`,
      orderId: order.id,
      type: 'ESCROW_CREATED',
      title: 'Escrow funded',
      description: `${order.amountDisplay} pUSD locked for ${label}`,
      timestamp: isoFromUnix(order.createdAt),
      icon: 'lock',
    });

    if (order.settledAt === null) continue;

    if (order.status === 'RELEASED') {
      items.push({
        id: `${order.id}-released`,
        orderId: order.id,
        type: 'PAYMENT_RELEASED',
        title: 'Escrow released',
        description: `${order.amountDisplay} pUSD paid to ${shortAddress(order.sellerAddress)}`,
        timestamp: isoFromUnix(order.settledAt),
        icon: 'check-circle',
      });
    }

    if (order.status === 'REFUNDED') {
      items.push({
        id: `${order.id}-refunded`,
        orderId: order.id,
        type: 'REFUND_PROCESSED',
        title: 'Escrow refunded',
        description: `${order.amountDisplay} pUSD returned to ${shortAddress(order.buyerAddress)}`,
        timestamp: isoFromUnix(order.settledAt),
        icon: 'rotate-ccw',
      });
    }
  }

  return items.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/** Order IDs come from logs, every field is read back through getEscrow(). */
export function useEscrows(wallet: WalletState, decimals = 18): UseEscrowsResult {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(
    wallet.isConnected && wallet.isCorrectNetwork
  );
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const readable = wallet.isConnected && wallet.isCorrectNetwork;

  const refresh = useCallback(async () => {
    if (!readable) {
      setOrders([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (refreshing.current) return;

    refreshing.current = true;
    setLoading(true);

    try {
      const index = await readEscrowLogs();
      const metadata = listOrderMetadata();
      const records = await Promise.all(index.orderIds.map(id => readEscrow(id)));

      const next: Order[] = [];
      const seen = new Set<string>();

      for (const record of records) {
        if (!record) continue;

        const key = record.orderId.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const meta = metadata[record.orderId];

        const status =
          record.status === ESCROW_CHAIN_STATUS.Released
            ? 'RELEASED'
            : record.status === ESCROW_CHAIN_STATUS.Refunded
              ? 'REFUNDED'
              : 'FUNDED';

        next.push({
          id: record.orderId,
          buyerAddress: record.buyer,
          sellerAddress: record.seller,
          amountRaw: record.amount,
          amountDisplay: formatTokenAmount(record.amount, decimals),
          status,
          createdAt: record.createdAt,
          settledAt: record.settledAt > 0 ? record.settledAt : null,
          createdTxHash: index.createdTx[record.orderId] ?? null,
          settledTxHash: index.settlement[record.orderId]?.hash ?? null,
          product: meta?.product ?? '',
          productDescription: meta?.description ?? '',
          sellerLabel: meta?.sellerLabel ?? '',
        });
      }

      next.sort((a, b) => b.createdAt - a.createdAt);
      setOrders(next);
      setError(null);
    } catch {
      setOrders([]);
      setError(
        'Could not read escrows from the Hardhat node. Check that it is running on 127.0.0.1:8545.'
      );
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [readable, decimals]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Escrows can also change outside this tab (another account, the oracle
  // panel, a script). Watch block numbers so new or settled orders appear
  // without requiring a manual refresh.
  useEffect(() => {
    if (!readable) return;

    const provider = getProvider();
    if (!provider) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let lastBlock: string | null = null;

    const tick = async () => {
      try {
        if (!cancelled && document.visibilityState === 'visible') {
          const block = await provider.request<string>({ method: 'eth_blockNumber' });
          if (cancelled) return;

          if (lastBlock === null || block !== lastBlock) {
            lastBlock = block;
            await refresh();
          }
        }
      } catch {
        // Node unavailable — the manual refresh and the next poll retry.
      } finally {
        if (!cancelled) timeoutId = window.setTimeout(() => void tick(), 5000);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    void tick();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [readable, refresh]);

  const activities = useMemo(() => buildActivities(orders), [orders]);

  return { orders, activities, loading, error, refresh };
}
