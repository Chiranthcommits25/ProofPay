import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, FlaskConical, Package } from 'lucide-react';
import type { Shipment } from '../../types';
import { formatDateTime } from '../../lib/format';
import { shortOrderId } from '../../lib/escrow';
import { shortAddress } from '../../lib/wallet';
import ShipmentStatusBadge from './ShipmentStatusBadge';
import ShipmentTimeline from './ShipmentTimeline';

interface ShipmentDetailsProps {
  shipment: Shipment;
}

export default function ShipmentDetails({ shipment }: ShipmentDetailsProps) {
  const [copied, setCopied] = useState(false);

  const copyTrackingId = () => {
    void navigator.clipboard.writeText(shipment.trackingId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Tracking ID</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="font-mono text-body font-medium text-ink">
              {shipment.trackingId}
            </p>
            <button
              type="button"
              onClick={copyTrackingId}
              aria-label="Copy tracking ID"
              className="icon-btn"
            >
              {copied ? (
                <Check size={12} className="text-success-ink" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </div>
        </div>
        <ShipmentStatusBadge status={shipment.status} size="md" />
      </div>

      <dl className="grid grid-cols-1 gap-2 text-body-xs sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
          <dt className="text-ink-muted">Order</dt>
          <dd>
            <Link
              to={`/order/${shipment.orderId}`}
              className="font-mono text-accent-ink hover:underline"
              title={shipment.orderId}
            >
              {shortOrderId(shipment.orderId)}
            </Link>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
          <dt className="text-ink-muted">Courier</dt>
          <dd className="text-ink-secondary">{shipment.carrier}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
          <dt className="text-ink-muted">Seller</dt>
          <dd className="font-mono text-ink-secondary" title={shipment.sellerAddress}>
            {shortAddress(shipment.sellerAddress)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-elevated px-3 py-2.5">
          <dt className="text-ink-muted">Last updated</dt>
          <dd className="text-ink-secondary">{formatDateTime(shipment.updatedAt)}</dd>
        </div>
      </dl>

      {shipment.description && (
        <p className="rounded-control border border-line bg-elevated px-3 py-2.5 text-body-sm leading-5 text-ink-secondary">
          {shipment.description}
        </p>
      )}

      <div className="flex items-start gap-2 rounded-control border border-warning/25 bg-warning/10 px-3 py-2.5 text-body-xs leading-5 text-warning-ink">
        <FlaskConical size={13} className="mt-0.5 shrink-0" />
        <span>
          Simulated courier data. Shipment status is stored in the Express API, not
          on-chain, and it does not release or refund escrow funds.
        </span>
      </div>

      <div className="border-t border-line-soft pt-4">
        <p className="mb-3 flex items-center gap-1.5 text-body-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
          <Package size={12} />
          Shipment events
        </p>
        <ShipmentTimeline events={shipment.events} />
      </div>

      <p className="text-caption text-ink-muted">
        Registered {formatDateTime(shipment.createdAt)}
      </p>
    </div>
  );
}
