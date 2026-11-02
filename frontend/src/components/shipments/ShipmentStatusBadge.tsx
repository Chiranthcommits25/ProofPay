import type { ShipmentStatus } from '../../types';

interface ShipmentStatusBadgeProps {
  status: ShipmentStatus;
  size?: 'sm' | 'md';
}

interface StatusConfig {
  label: string;
  dotColor: string;
  badgeClass: string;
}

const STATUS_CONFIG: Record<ShipmentStatus, StatusConfig> = {
  CREATED: {
    label: 'Registered',
    dotColor: 'bg-accent',
    badgeClass: 'border-accent/25 bg-accent/10 text-accent-ink',
  },
  SHIPPED: {
    label: 'Shipped',
    dotColor: 'bg-accent',
    badgeClass: 'border-accent/25 bg-accent/10 text-accent-ink',
  },
  IN_TRANSIT: {
    label: 'In transit',
    dotColor: 'bg-accent',
    badgeClass: 'border-accent/25 bg-accent/10 text-accent-ink',
  },
  DELIVERED: {
    label: 'Delivered',
    dotColor: 'bg-success',
    badgeClass: 'border-success/25 bg-success/10 text-success-ink',
  },
  LOST: {
    label: 'Lost',
    dotColor: 'bg-danger',
    badgeClass: 'border-danger/25 bg-danger/10 text-danger-ink',
  },
  RETURNED: {
    label: 'Returned',
    dotColor: 'bg-warning',
    badgeClass: 'border-warning/25 bg-warning/10 text-warning-ink',
  },
};

export default function ShipmentStatusBadge({
  status,
  size = 'sm',
}: ShipmentStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.CREATED;
  const sizeClasses =
    size === 'sm' ? 'px-2 py-0.5 text-label' : 'px-2.5 py-1 text-label';

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border font-medium leading-5 ${sizeClasses} ${config.badgeClass}`}
    >
      <span className={`size-1.5 shrink-0 rounded-pill ${config.dotColor}`} />
      {config.label}
    </span>
  );
}
