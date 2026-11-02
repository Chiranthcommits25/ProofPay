import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Package, RefreshCw, Truck } from 'lucide-react';
import type { Order, WalletState } from '../../types';
import { shortOrderId } from '../../lib/escrow';
import { useShipmentByOrder, useShipmentRegistration } from '../../store/useShipment';
import Panel from '../ui/Panel';
import ShipmentDetails from './ShipmentDetails';

interface SellerShipmentPanelProps {
  wallet: WalletState;
  orders: Order[];
}

interface FieldErrors {
  order?: string;
  carrier?: string;
  trackingId?: string;
  description?: string;
}

const TRACKING_ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{3,63}$/;

export default function SellerShipmentPanel({ wallet, orders }: SellerShipmentPanelProps) {
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [carrier, setCarrier] = useState('MockCourier');
  const [trackingId, setTrackingId] = useState('');
  const [description, setDescription] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const registration = useShipmentRegistration();
  const shipmentState = useShipmentByOrder(selectedOrderId || null);

  const address = wallet.address?.toLowerCase() ?? '';
  const funded = address
    ? orders.filter(
        order =>
          order.status === 'FUNDED' && order.sellerAddress.toLowerCase() === address
      )
    : [];

  const selectedOrder = funded.find(order => order.id === selectedOrderId);
  const shipment =
    registration.shipment?.orderId === selectedOrderId
      ? registration.shipment
      : shipmentState.shipment;

  const busy = registration.phase === 'submitting';
  const canUseApi = wallet.isConnected && wallet.isCorrectNetwork;

  const handleSelect = (value: string) => {
    setSelectedOrderId(value);
    setFieldErrors({});
    registration.reset();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const next: FieldErrors = {};
    const normalizedCarrier = carrier.trim();
    const normalizedTrackingId = trackingId.trim().toUpperCase();
    const normalizedDescription = description.trim();

    if (!selectedOrder) {
      next.order = 'Select a funded escrow order.';
    }

    if (normalizedCarrier.length < 2 || normalizedCarrier.length > 60) {
      next.carrier = 'Courier name must be 2-60 characters.';
    }

    if (!TRACKING_ID_PATTERN.test(normalizedTrackingId)) {
      next.trackingId =
        'Use 4-64 letters, numbers, hyphens or underscores, starting with a letter or number.';
    }

    if (normalizedDescription.length > 280) {
      next.description = 'Description must be 280 characters or fewer.';
    }

    setFieldErrors(next);
    if (Object.keys(next).length > 0 || !selectedOrder || !wallet.address) return;

    void registration
      .register({
        orderId: selectedOrder.id,
        trackingId: normalizedTrackingId,
        carrier: normalizedCarrier,
        sellerAddress: wallet.address,
        description: normalizedDescription || undefined,
      })
      .then(created => {
        if (created) {
          setTrackingId('');
          setDescription('');
          void shipmentState.refresh();
        }
      });
  };

  return (
    <Panel
      title="Shipment tracking"
      description="Register a mock courier shipment for a funded escrow order."
      meta={<span className="chip">Simulated</span>}
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-control border border-warning/25 bg-warning/10 px-3 py-2.5 text-body-xs leading-5 text-warning-ink">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            This is simulated courier data from the ProofPay API. It is not an
            independent delivery-verification authority and it does not release or
            refund escrow funds.
          </span>
        </p>

        {!wallet.isConnected ? (
          <p className="text-body-sm text-ink-muted">
            Connect the seller wallet to register shipments.
          </p>
        ) : !wallet.isCorrectNetwork ? (
          <p className="text-body-sm text-warning-ink">
            Switch to Hardhat Local (31337) to register shipments.
          </p>
        ) : funded.length === 0 ? (
          <p className="text-body-sm text-ink-muted">
            No funded escrow orders are waiting to ship.
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="shipment-order" className="field-label">
                Funded escrow order
              </label>
              <select
                id="shipment-order"
                value={selectedOrderId}
                onChange={event => handleSelect(event.target.value)}
                disabled={busy}
                className="field cursor-pointer"
              >
                <option value="">Select a funded order</option>
                {funded.map(order => (
                  <option key={order.id} value={order.id}>
                    {shortOrderId(order.id)} · {order.amountDisplay} pUSD ·{' '}
                    {order.product || 'Product not recorded'}
                  </option>
                ))}
              </select>
              {fieldErrors.order && (
                <p className="mt-1.5 text-body-xs text-danger-ink">{fieldErrors.order}</p>
              )}
            </div>

            {selectedOrder && (
              <>
                {shipmentState.loading && !shipment && (
                  <p className="flex items-center gap-2 text-body-sm text-ink-muted">
                    <Loader2 size={14} className="animate-spin" />
                    Checking for an existing shipment…
                  </p>
                )}

                {shipmentState.error && (
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
                )}

                {shipment ? (
                  <div className="space-y-3">
                    <p className="flex items-center gap-2 text-body-xs font-medium text-success-ink">
                      <CheckCircle2 size={13} />
                      Shipment registered for this order.
                    </p>
                    <ShipmentDetails shipment={shipment} />
                    <button
                      type="button"
                      onClick={() => void shipmentState.refresh()}
                      disabled={shipmentState.loading}
                      className="btn btn-secondary btn-sm"
                    >
                      <RefreshCw size={13} />
                      Refresh shipment
                    </button>
                  </div>
                ) : (
                  !shipmentState.loading &&
                  !shipmentState.error && (
                    <form onSubmit={handleSubmit} noValidate className="space-y-3">
                      <div>
                        <label htmlFor="shipment-carrier" className="field-label">
                          Courier name
                        </label>
                        <input
                          id="shipment-carrier"
                          type="text"
                          value={carrier}
                          onChange={event => setCarrier(event.target.value)}
                          disabled={busy}
                          placeholder="MockCourier"
                          aria-invalid={Boolean(fieldErrors.carrier)}
                          className="field"
                        />
                        {fieldErrors.carrier && (
                          <p className="mt-1.5 text-body-xs text-danger-ink">
                            {fieldErrors.carrier}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="shipment-tracking-id" className="field-label">
                          Tracking ID
                        </label>
                        <input
                          id="shipment-tracking-id"
                          type="text"
                          value={trackingId}
                          onChange={event => setTrackingId(event.target.value)}
                          disabled={busy}
                          placeholder="TRK123456"
                          autoCapitalize="characters"
                          aria-invalid={Boolean(fieldErrors.trackingId)}
                          className="field field-mono"
                        />
                        {fieldErrors.trackingId && (
                          <p className="mt-1.5 text-body-xs text-danger-ink">
                            {fieldErrors.trackingId}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="shipment-description" className="field-label">
                          Description <span className="normal-case">(optional)</span>
                        </label>
                        <textarea
                          id="shipment-description"
                          value={description}
                          onChange={event => setDescription(event.target.value)}
                          disabled={busy}
                          rows={2}
                          placeholder="Package contents or handling notes"
                          aria-invalid={Boolean(fieldErrors.description)}
                          className="field min-h-20 py-2.5"
                        />
                        {fieldErrors.description && (
                          <p className="mt-1.5 text-body-xs text-danger-ink">
                            {fieldErrors.description}
                          </p>
                        )}
                      </div>

                      {registration.error && (
                        <p
                          role="alert"
                          className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink"
                        >
                          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                          {registration.error}
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={busy || !canUseApi}
                        aria-busy={busy}
                        className="btn btn-primary w-full"
                      >
                        {busy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Truck size={14} />
                        )}
                        Register shipment
                      </button>
                    </form>
                  )
                )}
              </>
            )}

            <p className="flex items-start gap-1.5 text-body-xs leading-5 text-ink-muted">
              <Package size={12} className="mt-0.5 shrink-0" />
              The backend verifies that the order is funded and that this wallet is
              the seller recorded in the escrow contract.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
