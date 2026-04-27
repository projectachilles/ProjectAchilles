/**
 * Common formatters for the Endpoints module.
 */

export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const normalized =
    dateString.endsWith('Z') || dateString.includes('+') ? dateString : `${dateString}Z`;
  const then = new Date(normalized).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function isOnline(lastHeartbeat: string | null | undefined, thresholdSec = 180): boolean {
  if (!lastHeartbeat) return false;
  const normalized =
    lastHeartbeat.endsWith('Z') || lastHeartbeat.includes('+')
      ? lastHeartbeat
      : `${lastHeartbeat}Z`;
  return (Date.now() - new Date(normalized).getTime()) / 1000 < thresholdSec;
}

export function formatBytes(bytes: number | null | undefined, unit: 'mb' | 'gb' = 'mb'): string {
  if (bytes == null) return '—';
  if (unit === 'gb') return `${(bytes / 1024).toFixed(1)} GB`;
  if (bytes < 1024) return `${bytes} MB`;
  return `${(bytes / 1024).toFixed(1)} GB`;
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value == null) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  return `${d}d ${h}h`;
}
