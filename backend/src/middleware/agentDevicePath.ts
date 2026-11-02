/**
 * True for agent device routes: `/api/agent/*` except `/api/agent/admin` and
 * `/api/agent/admin/*`.
 *
 * The one place this is decided, shared by every limiter skip that treats
 * agent traffic differently (`cliBearerLimiterSkip`, `uiLimiterSkip`). The
 * comparison is case-insensitive and ignores the query string, because Express
 * routing is case-insensitive: `/api/agent/ADMIN/agents` reaches the admin
 * routers, so it must not be mistaken for a device route and skip the per-user
 * UI budget.
 */
export function isAgentDevicePath(url: string | undefined): boolean {
  const p = (url ?? '').split('?')[0].toLowerCase();
  return p.startsWith('/api/agent/') && p !== '/api/agent/admin' && !p.startsWith('/api/agent/admin/');
}
