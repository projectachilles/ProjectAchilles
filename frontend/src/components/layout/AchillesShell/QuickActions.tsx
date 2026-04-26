import type { ReactNode } from 'react';
import { Icon } from './icons';

export interface QuickAction {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  /** `primary` = solid green, `ghost` = outlined */
  tone?: 'primary' | 'ghost';
  disabled?: boolean;
}

interface QuickActionsProps {
  actions: QuickAction[];
}

/**
 * Right-aligned tactical action row sitting under the BranchPill.
 * Pages compose their own action set — there is no global default
 * because actions vary per surface (Dashboard, Browse, etc.).
 */
export function QuickActions({ actions }: QuickActionsProps) {
  return (
    <div className="dash-quick-row">
      {actions.map((a) => {
        const className = `dash-quick-btn ${a.tone ?? 'ghost'}`;
        const content = (
          <>
            <Icon size={12}>{a.icon}</Icon>
            <span>{a.label}</span>
          </>
        );
        if (a.href) {
          return (
            <a key={a.label} className={className} href={a.href}>
              {content}
            </a>
          );
        }
        return (
          <button
            key={a.label}
            type="button"
            className={className}
            onClick={a.onClick}
            disabled={a.disabled}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
