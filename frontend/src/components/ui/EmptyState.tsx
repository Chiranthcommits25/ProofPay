import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-10 items-center justify-center rounded-control border border-line bg-elevated text-ink-secondary">
        {icon}
      </div>
      <h3 className="text-h3 text-ink">{title}</h3>
      <p className="mt-1 max-w-xs text-body-sm leading-5 text-ink-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
