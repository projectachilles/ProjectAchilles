// Shared helpers for the Tests Module pages.

const CATEGORY_COLORS: Record<string, string> = {
  'cyber-hygiene': '#00e68a',
  'intel-driven': '#a78bfa',
  'mitre-top10': '#22d3ee',
  baseline: '#4f8eff',
  'identity-endpoint': '#ffaa2e',
};

export function categoryColor(cat: string | undefined | null): string {
  if (!cat) return 'var(--text-muted)';
  return CATEGORY_COLORS[cat.toLowerCase()] ?? 'var(--accent)';
}

export function severityRank(sev: string | undefined | null): number {
  switch ((sev ?? '').toLowerCase()) {
    case 'critical': return 5;
    case 'high': return 4;
    case 'medium': return 3;
    case 'low': return 2;
    case 'informational': return 1;
    default: return 0;
  }
}

export function scoreClass(score: number | undefined | null): string {
  if (score == null) return 'tm-score-na';
  if (score >= 80 || (score >= 8 && score <= 10)) return 'tm-score-hi';
  if (score >= 50 || (score >= 5 && score < 8)) return 'tm-score-md';
  return 'tm-score-lo';
}

export function relTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const delta = Date.now() - ts;
  if (delta < 0) return 'just now';
  const m = Math.floor(delta / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  const y = Math.floor(d / 365);
  return `${y}y`;
}

/** Sort field options exposed by the Browse All filter strip. */
export type SortField = 'modified' | 'score' | 'severity' | 'name';

export const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'modified', label: 'Recently modified' },
  { value: 'score', label: 'Score (desc)' },
  { value: 'severity', label: 'Severity (high → low)' },
  { value: 'name', label: 'Name (A–Z)' },
];

export function shortUuid(uuid: string | undefined | null): string {
  if (!uuid) return '';
  return uuid.length > 8 ? uuid.slice(0, 8) : uuid;
}
