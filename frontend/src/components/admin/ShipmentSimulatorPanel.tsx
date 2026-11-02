import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Truck,
  XCircle,
} from 'lucide-react';
import type { ShipmentStatus } from '../../types';
import { SHIPMENT_NEXT_STATUSES, SHIPMENT_STATUS_LABELS } from '../../lib/shipments';
import { shortOrderId } from '../../lib/escrow';
import { useShipmentSimulator } from '../../store/useShipment';
import Panel from '../ui/Panel';
import EmptyState from '../ui/EmptyState';
import ShipmentDetails from '../shipments/ShipmentDetails';

const STATUS_ICONS: Record<ShipmentStatus, typeof Truck> = {
  CREATED: Truck,
  SHIPPED: Truck,
  IN_TRANSIT: Truck,
  DELIVERED: CheckCircle2,
  LOST: XCircle,
  RETURNED: RotateCcw,
};

function buttonClass(status: ShipmentStatus): string {
  if (status === 'DELIVERED') return 'btn btn-primary';
  if (status === 'LOST') return 'btn btn-danger';
  return 'btn btn-secondary';
}

export default function ShipmentSimulatorPanel() {
  const {
    shipments,
    loading,
    error,
    updating,
    actionError,
    refresh,
    update,
    clearActionError,
  } = useShipmentSimulator();

  const [selectedId, setSelectedId] = useState('');

  const selected = shipments.find(shipment => shipment.trackingId === selectedId);
  const nextStatuses = selected ? SHIPMENT_NEXT_STATUSES[selected.status] : [];

  return (
    <Panel
      title="Shipment simulator"
      description="Advance mock courier status for the local demonstration."
      meta={<span className="chip">Simulated</span>}
      action={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="btn btn-secondary btn-sm"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-control border border-warning/25 bg-warning/10 px-3 py-2.5 text-body-xs leading-5 text-warning-ink">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            This simulator changes only mock shipment records in the Express API. It
            does not call ProofPayEscrow, move pUSD, or settle any order. Settlement
            remains a separate manual oracle action.
          </span>
        </p>

        {loading && shipments.length === 0 ? (
          <p className="flex items-center gap-2 text-body-sm text-ink-muted">
            <Loader2 size={14} className="animate-spin" />
            Loading shipments…
          </p>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {error}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="btn btn-secondary btn-sm shrink-0"
            >
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        ) : shipments.length === 0 ? (
          <EmptyState
            icon={<Truck size={18} />}
            title="No shipments registered"
            description="Register a mock shipment from the seller dashboard to test status transitions here."
          />
        ) : (
          <>
            <div>
              <label htmlFor="simulator-shipment" className="field-label">
                Shipment
              </label>
              <select
                id="simulator-shipment"
                value={selectedId}
                onChange={event => {
                  setSelectedId(event.target.value);
                  clearActionError();
                }}
                disabled={Boolean(updating)}
                className="field cursor-pointer"
              >
                <option value="">Select a shipment</option>
                {shipments.map(shipment => (
                  <option key={shipment.trackingId} value={shipment.trackingId}>
                    {shipment.trackingId} · {shipment.carrier} ·{' '}
                    {SHIPMENT_STATUS_LABELS[shipment.status]} ·{' '}
                    {shortOrderId(shipment.orderId)}
                  </option>
                ))}
              </select>
            </div>

            {selected && (
              <>
                <ShipmentDetails shipment={selected} />

                <div className="border-t border-line-soft pt-4">
                  <p className="mb-2.5 text-body-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
                    Simulate next status
                  </p>

                  {nextStatuses.length === 0 ? (
                    <p className="text-body-sm text-ink-muted">
                      Terminal state. No further transitions are allowed.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2.5">
                      {nextStatuses.map(status => {
                        const Icon = STATUS_ICONS[status] ?? Truck;
                        const isUpdating = updating === selected.trackingId;

                        return (
                          <button
                            key={status}
                            type="button"
                            onClick={() => void update(selected.trackingId, status)}
                            disabled={isUpdating}
                            aria-busy={isUpdating}
                            className={buttonClass(status)}
                          >
                            {isUpdating ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Icon size={14} />
                            )}
                            Mark {SHIPMENT_STATUS_LABELS[status]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {actionError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink"
              >
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {actionError}
              </p>
            )}

            <p className="text-body-xs leading-5 text-ink-muted">
              Mutations are restricted to localhost by default. Set{' '}
              <span className="font-mono">SHIPMENT_SIMULATOR_TOKEN</span> on the backend
              and <span className="font-mono">VITE_SHIPMENT_SIMULATOR_TOKEN</span> on the
              frontend to enable an authenticated remote demo.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
