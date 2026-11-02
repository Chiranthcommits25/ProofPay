import {
  AlertTriangle,
  CheckCircle2,
  Package,
  Radio,
  RotateCcw,
  Truck,
} from 'lucide-react';
import type { ShipmentEvent, ShipmentStatus } from '../../types';
import { formatDateTime } from '../../lib/format';
import { SHIPMENT_STATUS_LABELS } from '../../lib/shipments';

interface ShipmentTimelineProps {
  events: ShipmentEvent[];
}

const ICONS: Record<ShipmentStatus, typeof Package> = {
  CREATED: Package,
  SHIPPED: Truck,
  IN_TRANSIT: Radio,
  DELIVERED: CheckCircle2,
  LOST: AlertTriangle,
  RETURNED: RotateCcw,
};

function tone(status: ShipmentStatus): string {
  if (status === 'DELIVERED') return 'border-success/30 bg-success/10 text-success-ink';
  if (status === 'LOST') return 'border-danger/30 bg-danger/10 text-danger-ink';
  if (status === 'RETURNED') return 'border-warning/30 bg-warning/10 text-warning-ink';
  return 'border-accent-ink/40 bg-accent-soft text-accent-strong';
}

export default function ShipmentTimeline({ events }: ShipmentTimelineProps) {
  if (events.length === 0) {
    return <p className="text-body-sm text-ink-muted">No shipment events yet.</p>;
  }

  return (
    <div>
      {events.map((event, index) => {
        const Icon = ICONS[event.status] ?? Package;
        const isLast = index === events.length - 1;

        return (
          <div key={`${event.status}-${event.timestamp}-${index}`} className="relative flex gap-4">
            {!isLast && (
              <span
                className="absolute left-[13px] top-7 bottom-0 w-px bg-line"
                aria-hidden="true"
              />
            )}

            <div className="relative z-10 shrink-0">
              <span
                className={`flex size-[26px] items-center justify-center rounded-pill border ${tone(event.status)}`}
              >
                <Icon size={13} />
              </span>
            </div>

            <div className="min-w-0 flex-1 pb-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-body font-medium text-ink">
                  {SHIPMENT_STATUS_LABELS[event.status] ?? event.status}
                </p>
                <time className="text-label text-ink-muted">
                  {formatDateTime(event.timestamp)}
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
  );
}
