import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export default function Panel({
  title,
  description,
  meta,
  action,
  children,
  className = '',
  bodyClassName = '',
}: PanelProps) {
  return (
    <section className={`panel ${className}`}>
      {(title || meta || action) && (
        <header className="panel-header">
          <div className="min-w-0">
            {title && <h2 className="section-title">{title}</h2>}
            {description && (
              <p className="mt-1 text-body-xs leading-5 text-ink-muted">{description}</p>
            )}
          </div>
          {(meta || action) && (
            <div className="flex shrink-0 items-center gap-3">
              {meta}
              {action}
            </div>
          )}
        </header>
      )}
      {/* Defaults to the same horizontal padding as the header, so titles
          and content share one left edge. */}
      <div className={bodyClassName || 'panel-body'}>{children}</div>
    </section>
  );
}
