/**
 * Terminal colors and status indicators.
 * Uses ANSI escape codes directly — no dependencies.
 */

const esc = (code: string) => `\x1b[${code}m`;
const reset = esc('0');

export const colors = {
  // Core colors
  bold: (s: string) => `${esc('1')}${s}${reset}`,
  dim: (s: string) => `${esc('2')}${s}${reset}`,
  italic: (s: string) => `${esc('3')}${s}${reset}`,
  underline: (s: string) => `${esc('4')}${s}${reset}`,

  // Foreground
  red: (s: string) => `${esc('31')}${s}${reset}`,
  green: (s: string) => `${esc('32')}${s}${reset}`,
  yellow: (s: string) => `${esc('33')}${s}${reset}`,
  blue: (s: string) => `${esc('34')}${s}${reset}`,
  magenta: (s: string) => `${esc('35')}${s}${reset}`,
  cyan: (s: string) => `${esc('36')}${s}${reset}`,
  white: (s: string) => `${esc('37')}${s}${reset}`,
  gray: (s: string) => `${esc('90')}${s}${reset}`,

  // Bright
  brightRed: (s: string) => `${esc('91')}${s}${reset}`,
  brightGreen: (s: string) => `${esc('92')}${s}${reset}`,
  brightYellow: (s: string) => `${esc('93')}${s}${reset}`,
  brightCyan: (s: string) => `${esc('96')}${s}${reset}`,

  // Background
  bgRed: (s: string) => `${esc('41')}${s}${reset}`,
  bgGreen: (s: string) => `${esc('42')}${s}${reset}`,
  bgYellow: (s: string) => `${esc('43')}${s}${reset}`,
  bgBlue: (s: string) => `${esc('44')}${s}${reset}`,
};

/** Status indicators for agent/task/schedule states */
export const status = {
  // Agent status
  active: colors.brightGreen('●'),
  disabled: colors.yellow('○'),
  decommissioned: colors.gray('◌'),
  uninstalled: colors.gray('✕'),
  online: colors.brightGreen('●'),
  offline: colors.red('●'),
  stale: colors.yellow('●'),

  // Task status
  pending: colors.gray('◷'),
  assigned: colors.blue('◷'),
  downloading: colors.cyan('↓'),
  executing: colors.yellow('⏳'),
  completed: colors.brightGreen('✓'),
  failed: colors.brightRed('✗'),
  expired: colors.gray('✗'),

  // Schedule status
  schedule_active: colors.brightGreen('▶'),
  paused: colors.yellow('⏸'),
  schedule_completed: colors.gray('■'),
  deleted: colors.gray('✕'),

  // Outcome
  protected: colors.brightGreen('PROTECTED'),
  unprotected: colors.brightRed('UNPROTECTED'),
  error: colors.yellow('ERROR'),
};

/** Format a defense score with color based on threshold */
export function scoreColor(score: number): string {
  const pct = `${Math.round(score)}%`;
  if (score >= 80) return colors.brightGreen(pct);
  if (score >= 60) return colors.yellow(pct);
  if (score >= 40) return colors.brightYellow(pct);
  return colors.brightRed(pct);
}

/** Simple progress bar */
export function progressBar(value: number, max: number, width = 20): string {
  const ratio = Math.min(value / max, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  if (ratio >= 0.8) return colors.brightGreen(bar);
  if (ratio >= 0.6) return colors.yellow(bar);
  return colors.brightRed(bar);
}

/** Format relative time (e.g., "2min ago", "3h ago") */
export function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
