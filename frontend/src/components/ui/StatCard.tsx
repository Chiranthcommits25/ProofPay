import type { ReactNode } from 'react';

type StatTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  icon?: ReactNode;
  tone?: StatTone;
}

const TONE_CLASSES: Record<StatTone, string> = {
  neutral: 'border-line bg-elevated text-ink-secondary',
  accent: 'border-accent/25 bg-accent/10 text-accent-ink',
  success: 'border-success/25 bg-success/10 text-success-ink',
  warning: 'border-warning/25 bg-warning/10 text-warning-ink',
  danger: 'border-danger/25 bg-danger/10 text-danger-ink',
};

export default function StatCard({
  title,
  value,
  unit,
  subtitle,
  icon,
  tone = 'neutral',
}: StatCardProps) {
  return (
    <div className="card flex h-full flex-col justify-between p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-body-sm font-medium text-ink-secondary">{title}</p>
        {icon && (
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-control border ${TONE_CLASSES[tone]}`}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="mt-4">
        <p className="flex items-baseline gap-1.5">
          <span className="amount">{value}</span>
          {unit && (
            <span className="text-caption font-semibold tracking-[0.06em] text-ink-muted">
              {unit}
            </span>
          )}
        </p>
        {subtitle && (
          <p className="mt-2 truncate text-body-xs text-ink-muted">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
