import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, Package, Truck } from 'lucide-react';
import type { Order, Shipment, WalletState } from '../../types';
import { shortOrderId } from '../../lib/escrow';
import { formatTokenAmount } from '../../lib/contracts';
import { getExplorerTxUrl } from '../../lib/explorer';
import { SHIPMENT_STATUS_LABELS } from '../../lib/shipments';
import Panel from '../ui/Panel';
import ShipmentTimeline from '../shipments/ShipmentTimeline';

interface OrderTrackingProps {
  order: Order;
  shipment: Shipment | null;
  shipmentLoading: boolean;
  shipmentNotFound: boolean;
  shipmentError: string | null;
  wallet: WalletState;
}

function statusTone(status: Order['status']): string {
  if (status === 'RELEASED') return 'text-success-ink';
  if (status === 'REFUNDED') return 'text-danger-ink';
  return 'text-warning-ink';
}

function statusLabel(status: Order['status']): string {
  if (status === 'RELEASED') return 'Released to seller';
  if (status === 'REFUNDED') return 'Refunded to buyer';
  return 'Awaiting settlement';
}

function shipmentStatusTone(status: Shipment['status']): string {
  if (status === 'DELIVERED') return 'text-success-ink';
  if (status === 'LOST' || status === 'RETURNED') return 'text-danger-ink';
  if (status === 'IN_TRANSIT' || status === 'SHIPPED') return 'text-accent-ink';
  return 'text-ink-muted';
}

export default function OrderTracking({
  order,
  shipment,
  shipmentLoading,
  shipmentNotFound,
  shipmentError,
}: OrderTrackingProps) {
  const decimals = 18;
  const createdDate = new Date(order.createdAt * 1000).toLocaleString();
  const settledDate =
    order.settledAt !== null ? new Date(order.settledAt * 1000).toLocaleString() : null;

  return (
    <div className="space-y-4">
      <Panel
        title="Escrow status"
        description="On-chain settlement state for this order."
        meta={<span className="chip">On-chain</span>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-control border border-line-soft p-3">
            <p className="text-body-xs text-ink-muted">Order ID</p>
            <p className="mt-1 font-mono text-body-sm text-ink">{shortOrderId(order.id)}</p>
          </div>
          <div className="rounded-control border border-line-soft p-3">
            <p className="text-body-xs text-ink-muted">Amount</p>
            <p className="mt-1 text-body-sm text-ink">
              {formatTokenAmount(order.amountRaw, decimals)} pUSD
            </p>
          </div>
          <div className="rounded-control border border-line-soft p-3">
            <p className="text-body-xs text-ink-muted">Escrow status</p>
            <p className={`mt-1 flex items-center gap-2 text-body-sm font-medium ${statusTone(order.status)}`}>
              {order.status === 'FUNDED' ? <Clock size={14} /> : <CheckCircle2 size={14} />}
              {statusLabel(order.status)}
            </p>
          </div>
          <div className="rounded-control border border-line-soft p-3">
            <p className="text-body-xs text-ink-muted">Created</p>
            <p className="mt-1 text-body-sm text-ink">{createdDate}</p>
          </div>
          {order.settledAt !== null && settledDate && (
            <div className="rounded-control border border-line-soft p-3 sm:col-span-2">
              <p className="text-body-xs text-ink-muted">Settled</p>
              <p className="mt-1 text-body-sm text-ink">{settledDate}</p>
              {order.settledTxHash && (
                <a
                  href={getExplorerTxUrl(order.settledTxHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 text-body-xs text-accent-ink transition-colors hover:text-accent"
                >
                  View transaction
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="Shipment tracking"
        description="Mock courier data from the ProofPay API."
        meta={<span className="chip">Simulated</span>}
      >
        {shipmentLoading && (
          <p className="flex items-center gap-2 text-body-sm text-ink-muted">
            <Loader2 size={14} className="animate-spin" />
            Loading shipment status…
          </p>
        )}

        {!shipmentLoading && shipmentNotFound && (
          <p className="flex items-center gap-2 text-body-sm text-ink-muted">
            <Package size={14} />
            Shipment not registered yet.
          </p>
        )}

        {!shipmentLoading && shipmentError && (
          <p className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {shipmentError}
          </p>
        )}

        {shipment && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-control border border-line-soft p-3">
                <p className="text-body-xs text-ink-muted">Tracking ID</p>
                <p className="mt-1 font-mono text-body-sm text-ink">{shipment.trackingId}</p>
              </div>
              <div className="rounded-control border border-line-soft p-3">
                <p className="text-body-xs text-ink-muted">Carrier</p>
                <p className="mt-1 text-body-sm text-ink">{shipment.carrier}</p>
              </div>
              <div className="rounded-control border border-line-soft p-3 sm:col-span-2">
                <p className="text-body-xs text-ink-muted">Shipment status</p>
                <p className={`mt-1 flex items-center gap-2 text-body-sm font-medium ${shipmentStatusTone(shipment.status)}`}>
                  <Truck size={14} />
                  {SHIPMENT_STATUS_LABELS[shipment.status]}
                </p>
              </div>
            </div>

            <ShipmentTimeline events={shipment.events} />

            <div className="rounded-control border border-accent/25 bg-accent/10 p-3">
              <p className="text-body-xs leading-5 text-accent-ink">
                <strong>Chainlink CRE:</strong> This shipment can be monitored by the CRE workflow for automated settlement. 
                DELIVERED triggers release, LOST triggers refund. Status is retrieved by workflow from the API - 
                never trust frontend data for settlement decisions.
              </p>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
