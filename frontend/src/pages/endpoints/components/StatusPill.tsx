interface StatusPillProps {
  status: string;
}

interface PillStyle {
  c: string;
  bg: string;
  label: string;
}

const MAP: Record<string, PillStyle> = {
  completed:    { c: '#00e68a', bg: 'rgba(0,230,138,.12)', label: 'completed' },
  failed:       { c: '#ff5a72', bg: 'rgba(255,59,92,.12)', label: 'failed' },
  expired:      { c: '#ff5a72', bg: 'rgba(255,59,92,.12)', label: 'expired' },
  pending:      { c: '#ffc857', bg: 'rgba(255,200,87,.10)', label: 'pending' },
  assigned:     { c: '#7eaaff', bg: 'rgba(79,142,255,.12)', label: 'assigned' },
  downloading:  { c: '#7eaaff', bg: 'rgba(79,142,255,.12)', label: 'downloading' },
  executing:    { c: '#7eaaff', bg: 'rgba(79,142,255,.12)', label: 'in-progress' },
  'in-progress':{ c: '#7eaaff', bg: 'rgba(79,142,255,.12)', label: 'in-progress' },
  active:       { c: '#00e68a', bg: 'rgba(0,230,138,.12)', label: 'active' },
  paused:       { c: '#ffc857', bg: 'rgba(255,200,87,.10)', label: 'paused' },
  disabled:     { c: '#6b7388', bg: 'rgba(255,255,255,.04)', label: 'disabled' },
  decommissioned: { c: '#ff5a72', bg: 'rgba(255,59,92,.10)', label: 'decommissioned' },
  uninstalled:  { c: '#6b7388', bg: 'rgba(255,255,255,.04)', label: 'uninstalled' },
  online:       { c: '#00e68a', bg: 'rgba(0,230,138,.12)', label: 'online' },
  offline:      { c: '#ff5a72', bg: 'rgba(255,59,92,.12)', label: 'offline' },
};

/**
 * Status pill — Tactical Green color mapping per design tokens.
 *
 * Status pill colors (per handoff):
 *  - completed   → accent
 *  - failed      → danger
 *  - pending     → warn-bright
 *  - in-progress → signal
 *  - assigned    → text-muted (rendered as signal in our table coloring)
 */
export function StatusPill({ status }: StatusPillProps) {
  const m = MAP[status] || { c: 'var(--text-muted)', bg: 'rgba(255,255,255,.04)', label: status };
  return (
    <span
      className="ep-pill"
      style={{ color: m.c, background: m.bg, borderColor: m.c + '33' }}
    >
      {m.label}
    </span>
  );
}
