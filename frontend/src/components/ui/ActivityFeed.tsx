import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Package,
  PackageCheck,
  RotateCcw,
  Truck,
  Activity,
} from 'lucide-react';
import type { ActivityItem } from '../../types';
import { formatRelativeTime } from '../../lib/format';

interface ActivityFeedProps {
  activities: ActivityItem[];
  limit?: number;
  className?: string;
}

const ICON_MAP: Record<string, typeof Package> = {
  'check-circle': CheckCircle2,
  'package-check': PackageCheck,
  truck: Truck,
  'rotate-ccw': RotateCcw,
  package: Package,
  lock: Lock,
};

const TONE_MAP: Record<string, string> = {
  PAYMENT_RELEASED: 'text-success-ink',
  DELIVERY_CONFIRMED: 'text-success-ink',
  REFUND_PROCESSED: 'text-warning-ink',
  LOST: 'text-danger-ink',
  RETURNED: 'text-warning-ink',
  ESCROW_CREATED: 'text-accent-ink',
  SHIPPED: 'text-accent-ink',
  IN_TRANSIT: 'text-accent-ink',
};

export default function ActivityFeed({ activities, limit, className = '' }: ActivityFeedProps) {
  const items = limit ? activities.slice(0, limit) : activities;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
        <div className="mb-4 flex size-10 items-center justify-center rounded-control border border-line bg-elevated text-ink-secondary">
          <Activity size={18} />
        </div>
        <p className="text-h3 text-ink">No activity yet</p>
        <p className="mt-1 max-w-xs text-body-sm leading-5 text-ink-muted">
          Escrow and shipment events will show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className={`divide-y divide-line-soft ${className}`}>
      {items.map(activity => {
        const Icon = ICON_MAP[activity.icon] ?? (activity.type === 'LOST' ? AlertTriangle : Activity);
        const tone = TONE_MAP[activity.type] ?? 'text-ink-secondary';

        return (
          <li key={activity.id} className="flex gap-3 px-6 py-4">
            <span
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-pill border border-line bg-elevated ${tone}`}
            >
              <Icon size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-body font-medium text-ink" title={activity.title}>
                  {activity.title}
                </p>
                <time className="shrink-0 text-caption text-ink-muted">
                  {formatRelativeTime(activity.timestamp)}
                </time>
              </div>
              <p className="mt-0.5 text-body-sm leading-5 text-ink-secondary">
                {activity.description}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
