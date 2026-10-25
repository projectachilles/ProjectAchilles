// Lightweight SentinelOne Management API (v2.1) client using fetch — no SDK.
// Auth: `Authorization: ApiToken <token>`. Handles cursor pagination, 429
// back-off and the read-only / response permission boundary.
//
// SECURITY: the permission boundary is enforced HERE, server-side. A client
// built in `read_only` mode refuses every non-GET request before it reaches
// the network, so even a bug in a route or a crafted request cannot trigger a
// response action against the console. Write requests are additionally
// restricted to a closed allowlist of action paths.

import type {
  SentinelOneCredentials,
  SentinelOnePermissionMode,
  SentinelOneAutoMitigationAction,
  S1ListResponse,
  S1Threat,
  S1CloudDetectionAlert,
} from '../../types/sentinelone.js';

export const S1_API_PREFIX = '/web/api/v2.1';

/** Max page size accepted by the list endpoints. */
export const S1_MAX_PAGE_LIMIT = 1000;

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;

/** The only mitigation actions the client will send (automatic mitigation). */
export const S1_MITIGATION_ACTIONS: ReadonlyArray<SentinelOneAutoMitigationAction> = ['kill', 'quarantine'] as const;

/** Incident-lifecycle write endpoints used by auto-resolve (never mitigation). */
export const S1_INCIDENT_PATHS = {
  threatIncident: `${S1_API_PREFIX}/threats/incident`,
  threatNotes: `${S1_API_PREFIX}/threats/notes`,
  alertIncident: `${S1_API_PREFIX}/cloud-detection/alerts/incident`,
} as const;

/** Closed allowlist of write endpoints (response mode only). */
const WRITE_PATH_ALLOWLIST: ReadonlySet<string> = new Set([
  ...S1_MITIGATION_ACTIONS.map((a) => `${S1_API_PREFIX}/threats/mitigate/${a}`),
  ...Object.values(S1_INCIDENT_PATHS),
]);

/** S1 object ids are numeric strings; anything else is refused before it reaches a URL path. */
const S1_ID_RE = /^\d{1,24}$/;

/**
 * Allowed console hostnames. SentinelOne consoles live under
 * `<tenant>.sentinelone.net` (commercial) or `<tenant>.s1gov.net` (GovCloud).
 * Restricting the host keeps the user-supplied base URL from being usable as
 * a request-forgery primitive (the routes also run the shared SSRF check).
 */
const S1_HOST_PATTERN = /^(?=.{1,253}$)((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+)(sentinelone\.net|s1gov\.net)$/;

/** The only console domains a request may go to (constants, never user input). */
const S1_CONSOLE_DOMAINS: Readonly<Record<string, string>> = { 'sentinelone.net': 'sentinelone.net', 's1gov.net': 's1gov.net' };

/** Distinguishable error for SentinelOne API failures (branch on statusCode). */
export class SentinelOneApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly bodySnippet: string) {
    super(message);
    this.name = 'SentinelOneApiError';
  }
}

/** Raised when a write is attempted by a read-only integration. */
export class SentinelOnePermissionError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'SentinelOnePermissionError';
  }
}

/**
 * Validate and normalize a console base URL to `https://<host>` (no path,
 * query, credentials or non-default port). Throws on anything else.
 */
export function normalizeSentinelOneBaseUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error('Invalid SentinelOne console URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('SentinelOne console URL must use https://');
  }
  if (parsed.username || parsed.password) {
    throw new Error('SentinelOne console URL must not contain credentials');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('SentinelOne console URL must not specify a custom port');
  }
  if (parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
    throw new Error('SentinelOne console URL must be the bare console host, e.g. https://<tenant>.sentinelone.net');
  }
  const match = S1_HOST_PATTERN.exec(parsed.hostname.toLowerCase());
  const domain = match ? S1_CONSOLE_DOMAINS[match[2]] : undefined;
  if (!match || !domain) {
    throw new Error('SentinelOne console URL must be a *.sentinelone.net or *.s1gov.net host');
  }
  // Rebuild the URL from the validated parts: the domain from the constant
  // allowlist and the tenant labels URI-encoded, so nothing that could change
  // the authority ('/', '@', ':') can reach the request host. A no-op for any
  // host the pattern accepts ([a-z0-9.-] only).
  return `https://${encodeURIComponent(match[1])}${domain}`;
}

type QueryValue = string | number | boolean | string[] | undefined | null;

export class SentinelOneClient {
  readonly baseUrl: string;
  private readonly apiToken: string;
  readonly permissionMode: SentinelOnePermissionMode;

  constructor(creds: SentinelOneCredentials) {
    this.baseUrl = normalizeSentinelOneBaseUrl(creds.base_url);
    if (!creds.api_token) throw new Error('SentinelOne API token is required');
    this.apiToken = creds.api_token;
    this.permissionMode = creds.permission_mode === 'response' ? 'response' : 'read_only';
  }

  // ---------------------------------------------------------------------------
  // Core request
  // ---------------------------------------------------------------------------

  private buildUrl(path: string, params?: Record<string, QueryValue>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      // S1 list params take comma-separated values (accountIds=a,b).
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        url.searchParams.set(key, value.join(','));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options?: { params?: Record<string, QueryValue>; body?: unknown },
  ): Promise<T> {
    if (!path.startsWith(`${S1_API_PREFIX}/`)) {
      throw new Error(`Refusing SentinelOne request outside ${S1_API_PREFIX}`);
    }
    if (method !== 'GET') {
      if (this.permissionMode !== 'response') {
        throw new SentinelOnePermissionError(
          `SentinelOne integration is in read-only mode: ${method} ${path} is not allowed. Switch the integration to Response mode to enable response actions.`,
        );
      }
      if (!WRITE_PATH_ALLOWLIST.has(path)) {
        throw new SentinelOnePermissionError(`SentinelOne write endpoint not allowed: ${path}`);
      }
    }

    const url = this.buildUrl(path, options?.params);
    let attempt = 0;

    while (true) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `ApiToken ${this.apiToken}`,
          Accept: 'application/json',
          ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // 429 / 5xx — back off (Retry-After or exponential) up to MAX_RETRIES.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '', 10);
        const delayMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2 ** attempt * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
        continue;
      }

      if (!res.ok) {
        // Never echo the token: the body comes from S1, the token never does.
        const bodySnippet = (await res.text().catch(() => '')).slice(0, 300);
        let hint = '';
        if (res.status === 401) hint = ' Check the API token (it may be expired or revoked).';
        if (res.status === 403) {
          hint = method === 'GET'
            ? ' The API token user lacks read access for this scope (Viewer role or higher is required).'
            : ' The API token user lacks permission for this action (requires an IR Team / SOC / Admin role).';
        }
        throw new SentinelOneApiError(
          `SentinelOne ${method} ${path} failed: HTTP ${res.status}.${hint} ${bodySnippet}`.trim(),
          res.status,
          bodySnippet,
        );
      }

      return (await res.json()) as T;
    }
  }

  // ---------------------------------------------------------------------------
  // Read API
  // ---------------------------------------------------------------------------

  /** GET /threats — one page. Pass the returned nextCursor to continue. */
  async listThreats(params: Record<string, QueryValue>): Promise<{ data: S1Threat[]; nextCursor?: string; total?: number }> {
    const res = await this.request<S1ListResponse<S1Threat>>('GET', `${S1_API_PREFIX}/threats`, { params });
    return { data: res.data ?? [], nextCursor: res.pagination?.nextCursor ?? undefined, total: res.pagination?.totalItems };
  }

  /** GET /cloud-detection/alerts (STAR / custom detection alerts) — one page. */
  async listCloudDetectionAlerts(params: Record<string, QueryValue>): Promise<{ data: S1CloudDetectionAlert[]; nextCursor?: string; total?: number }> {
    const res = await this.request<S1ListResponse<S1CloudDetectionAlert>>('GET', `${S1_API_PREFIX}/cloud-detection/alerts`, { params });
    return { data: res.data ?? [], nextCursor: res.pagination?.nextCursor ?? undefined, total: res.pagination?.totalItems };
  }

  /**
   * Iterate every page of a list endpoint following `pagination.nextCursor`.
   * Stops on an empty page or a repeated cursor (degenerate-cursor guard).
   */
  async *paginate<T>(
    fetchPage: (params: Record<string, QueryValue>) => Promise<{ data: T[]; nextCursor?: string }>,
    params: Record<string, QueryValue>,
    maxPages = 10_000,
  ): AsyncGenerator<T[]> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < maxPages; page++) {
      const res = await fetchPage({ ...params, limit: params.limit ?? S1_MAX_PAGE_LIMIT, cursor });
      if (res.data.length > 0) yield res.data;
      if (!res.nextCursor || res.data.length === 0 || seen.has(res.nextCursor)) return;
      seen.add(res.nextCursor);
      cursor = res.nextCursor;
    }
  }

  /** GET /exclusions — one page (path / hash / certificate / browser / file-type exclusions). */
  async listExclusions(params: Record<string, QueryValue>): Promise<{ data: Record<string, unknown>[]; nextCursor?: string; total?: number }> {
    const res = await this.request<S1ListResponse<Record<string, unknown>>>('GET', `${S1_API_PREFIX}/exclusions`, { params });
    return { data: res.data ?? [], nextCursor: res.pagination?.nextCursor ?? undefined, total: res.pagination?.totalItems };
  }

  /** GET /sites — one page. The list lives under data.sites. */
  async listSites(params: Record<string, QueryValue>): Promise<{ data: Record<string, unknown>[]; nextCursor?: string }> {
    const res = await this.request<{ data?: { sites?: Record<string, unknown>[] }; pagination?: { nextCursor?: string | null } }>(
      'GET', `${S1_API_PREFIX}/sites`, { params },
    );
    return { data: res.data?.sites ?? [], nextCursor: res.pagination?.nextCursor ?? undefined };
  }

  /** GET /groups — one page. */
  async listGroups(params: Record<string, QueryValue>): Promise<{ data: Record<string, unknown>[]; nextCursor?: string }> {
    const res = await this.request<S1ListResponse<Record<string, unknown>>>('GET', `${S1_API_PREFIX}/groups`, { params });
    return { data: res.data ?? [], nextCursor: res.pagination?.nextCursor ?? undefined };
  }

  /** GET /{accounts|sites|groups}/{id}/policy — the effective protection policy at that scope. */
  async getPolicy(level: 'account' | 'site' | 'group', id: string): Promise<Record<string, unknown>> {
    if (!S1_ID_RE.test(id)) throw new Error(`Invalid SentinelOne ${level} id`);
    const res = await this.request<{ data?: Record<string, unknown> }>('GET', `${S1_API_PREFIX}/${level}s/${id}/policy`);
    return res.data ?? {};
  }

  /** GET /agents — one page of the agent inventory. */
  async listAgents(params: Record<string, QueryValue>): Promise<{ data: Record<string, unknown>[]; nextCursor?: string }> {
    const res = await this.request<S1ListResponse<Record<string, unknown>>>('GET', `${S1_API_PREFIX}/agents`, { params });
    return { data: res.data ?? [], nextCursor: res.pagination?.nextCursor ?? undefined };
  }

  /** GET /agents/count — agent count for the given filters. */
  async countAgents(params: Record<string, QueryValue>): Promise<number> {
    const res = await this.request<{ data?: { total?: number } }>('GET', `${S1_API_PREFIX}/agents/count`, { params });
    return res.data?.total ?? 0;
  }

  /** Cheap authenticated read used by the "Test Connection" button. */
  async testConnection(scope?: { accountIds?: string[]; siteIds?: string[] }): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.listThreats({ limit: 1, countOnly: true, accountIds: scope?.accountIds, siteIds: scope?.siteIds });
      const total = res.total;
      return {
        success: true,
        message: `Connected to SentinelOne (${this.permissionMode === 'response' ? 'Response' : 'Read-only'} mode)${typeof total === 'number' ? ` — ${total} threat(s) visible in scope` : ''}`,
      };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---------------------------------------------------------------------------
  // Response API (response mode only — enforced in request())
  // ---------------------------------------------------------------------------

  /** POST /threats/mitigate/{action} with body { filter: { ids }, data: {} }. */
  async mitigateThreats(action: SentinelOneAutoMitigationAction, threatIds: string[]): Promise<{ affected: number }> {
    if (!S1_MITIGATION_ACTIONS.includes(action)) throw new SentinelOnePermissionError(`Unknown mitigation action: ${action}`);
    // An empty or malformed filter on /threats/mitigate could match far more than intended.
    SentinelOneClient.checkIds(threatIds, 'mitigateThreats');
    const res = await this.request<{ data?: { affected?: number } }>('POST', `${S1_API_PREFIX}/threats/mitigate/${action}`, {
      body: { filter: { ids: threatIds }, data: {} },
    });
    return { affected: res.data?.affected ?? 0 };
  }

  // ---------------------------------------------------------------------------
  // Incident lifecycle (auto-resolve). Never mitigation, never analyst verdict.
  // ---------------------------------------------------------------------------

  private static checkIds(ids: string[], what: string): void {
    if (ids.length === 0) throw new Error(`${what}: at least one id is required`);
    if (ids.length > 100) throw new Error(`${what}: at most 100 ids per call`);
    if (!ids.every((id) => S1_ID_RE.test(id))) throw new Error(`${what}: ids must be numeric SentinelOne ids`);
  }

  /** POST /threats/incident — set the incident status of threats (e.g. resolved). */
  async updateThreatIncidentStatus(threatIds: string[], incidentStatus: 'resolved'): Promise<{ affected: number }> {
    SentinelOneClient.checkIds(threatIds, 'updateThreatIncidentStatus');
    const res = await this.request<{ data?: { affected?: number } }>('POST', S1_INCIDENT_PATHS.threatIncident, {
      body: { filter: { ids: threatIds }, data: { incidentStatus } },
    });
    return { affected: res.data?.affected ?? 0 };
  }

  /** POST /threats/notes — add an audit note to threats. */
  async addThreatNote(threatIds: string[], text: string): Promise<{ affected: number }> {
    SentinelOneClient.checkIds(threatIds, 'addThreatNote');
    const res = await this.request<{ data?: { affected?: number } }>('POST', S1_INCIDENT_PATHS.threatNotes, {
      body: { filter: { ids: threatIds }, data: { text } },
    });
    return { affected: res.data?.affected ?? 0 };
  }

  /** POST /cloud-detection/alerts/incident — set the incident status of detection alerts. */
  async updateAlertIncidentStatus(alertIds: string[], incidentStatus: 'resolved'): Promise<{ affected: number }> {
    SentinelOneClient.checkIds(alertIds, 'updateAlertIncidentStatus');
    const res = await this.request<{ data?: { affected?: number } }>('POST', S1_INCIDENT_PATHS.alertIncident, {
      body: { filter: { ids: alertIds }, data: { incidentStatus } },
    });
    return { affected: res.data?.affected ?? 0 };
  }
}
