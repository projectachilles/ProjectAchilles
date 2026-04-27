import type { ReactNode } from 'react';

interface SettingsPageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  /** Right-aligned slot — quick-action buttons, status pills, etc. */
  actions?: ReactNode;
}

/**
 * Shared header row for every /settings/* page.
 * Renders an Orbitron title with a mono eyebrow and optional right-aligned actions.
 */
export function SettingsPageHeader({
  eyebrow = 'Settings',
  title,
  description,
  actions,
}: SettingsPageHeaderProps) {
  return (
    <header className="settings-page-head">
      <div>
        <p className="settings-page-eyebrow">{eyebrow}</p>
        <h1 className="settings-page-title">{title}</h1>
        {description && <p className="settings-page-sub">{description}</p>}
      </div>
      {actions && <div className="dash-quick-row">{actions}</div>}
    </header>
  );
}
