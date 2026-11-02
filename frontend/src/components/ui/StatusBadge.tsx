import type { EscrowStatus } from '../../types';

interface StatusBadgeProps {
  status: EscrowStatus;
  size?: 'sm' | 'md';
}

interface StatusConfig {
  label: string;
  dotColor: string;
  badgeClass: string;
}

const STATUS_CONFIG: Record<EscrowStatus, StatusConfig> = {
  FUNDED: {
    label: 'In escrow',
    dotColor: 'bg-accent',
    badgeClass: 'border-accent/25 bg-accent/10 text-accent-ink',
  },
  RELEASED: {
    label: 'Released',
    dotColor: 'bg-success',
    badgeClass: 'border-success/25 bg-success/10 text-success-ink',
  },
  REFUNDED: {
    label: 'Refunded',
    dotColor: 'bg-warning',
    badgeClass: 'border-warning/25 bg-warning/10 text-warning-ink',
  },
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.FUNDED;
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
