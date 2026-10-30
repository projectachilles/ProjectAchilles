import { WORDMARK } from '@/lib/brand';
import { IDENTITY_CHIP_TEXT } from '@/lib/identityColors';

const PAGE_NAMES: Record<string, string> = {
  dashboard: 'Dashboard',
  tests: 'Tests',
  analytics: 'Analytics',
  agents: 'Agents',
  tasks: 'Tasks',
  campaigns: 'Campaigns',
  settings: 'Settings',
  'cli-auth': 'Authorize CLI',
};

/** Tab title for the current route, or null when the page sets its own (the report). */
export function documentTitle(pathname: string, code: string): string | null {
  if (pathname === '/analytics/report') return null;
  const page = PAGE_NAMES[pathname.split('/')[1] ?? ''];
  return page ? `[${code}] ${page} · ${WORDMARK}` : `[${code}] ${WORDMARK}`;
}

/** Rounded-square SVG favicon carrying the organization code. */
export function faviconDataUrl(code: string, hex: string | null): string {
  const fill = hex ?? '#101713';
  const text = hex ? IDENTITY_CHIP_TEXT : '#dce8de';
  const size = code.length <= 2 ? 30 : code.length === 3 ? 24 : 17;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${fill}"/>` +
    `<text x="32" y="32" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="ui-monospace,Menlo,Consolas,monospace" font-weight="700" font-size="${size}" fill="${text}">${code}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
