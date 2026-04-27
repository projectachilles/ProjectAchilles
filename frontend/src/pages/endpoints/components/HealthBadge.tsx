interface HealthBadgeProps {
  value: number | null | undefined;
}

/**
 * 0–100 health score badge with severity coloring per the handoff:
 *  - ≥80 → accent
 *  - 50–79 → warn-bright
 *  - <50 → danger
 */
export function HealthBadge({ value }: HealthBadgeProps) {
  if (value == null) {
    return (
      <span
        className="ep-health"
        style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,.04)', borderColor: 'var(--line)' }}
      >
        —
      </span>
    );
  }
  const v = Math.round(value);
  const c =
    v >= 80 ? '#00e68a' :
    v >= 50 ? '#ffc857' : '#ff5a72';
  const bg =
    v >= 80 ? 'rgba(0,230,138,.14)' :
    v >= 50 ? 'rgba(255,200,87,.14)' : 'rgba(255,59,92,.14)';
  return (
    <span
      className="ep-health"
      style={{ color: c, background: bg, borderColor: c + '40' }}
    >
      {v}
    </span>
  );
}
