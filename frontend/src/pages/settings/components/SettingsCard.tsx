import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { IntegrationStatus } from './IntegrationCard';

interface SettingsCardProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional status pill on the right side of the card head. */
  status?: IntegrationStatus;
  statusMessage?: string;
  /** Optional extra meta slot (between status and corner). */
  meta?: ReactNode;
  children: ReactNode;
}

function StatusPill({ status, message }: { status: IntegrationStatus; message?: string }) {
  if (status === 'connected') {
    return (
      <span className="settings-status-pill is-connected">
        <span className="dot" />
        {message ?? 'Connected'}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="settings-status-pill is-error">
        <span className="dot" />
        {message ?? 'Error'}
      </span>
    );
  }
  return (
    <span className="settings-status-pill">
      <span className="dot" style={{ background: 'var(--text-muted)' }} />
      {message ?? 'Not configured'}
    </span>
  );
}

/**
 * Tactical Green card chrome for a settings section.
 * Always visible (no collapse) — keeps the visual rhythm consistent with
 * Dashboard V1 cards instead of the old expand/collapse `IntegrationCard`.
 */
export function SettingsCard({
  icon: Icon,
  title,
  description,
  status,
  statusMessage,
  meta,
  children,
}: SettingsCardProps) {
  return (
    <section className="dash-card">
      <header className="dash-card-head">
        <div className="dash-card-title">
          {Icon ? <Icon size={14} strokeWidth={2} /> : <span className="accent-dot" />}
          {title}
        </div>
        <div className="dash-card-meta">
          {meta}
          {status && <StatusPill status={status} message={statusMessage} />}
        </div>
      </header>
      {description && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            margin: '-6px 0 14px',
          }}
        >
          {description}
        </p>
      )}
      {children}
    </section>
  );
}
