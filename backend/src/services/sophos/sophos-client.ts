// Lightweight Sophos Central API client using fetch — no SDK.
// Auth: OAuth2 client credentials (id.sophos.com) → Bearer token; the tenant id
// and regional API host come from /whoami/v1, never from configuration.
//
// SECURITY: every request goes through assertSophosRequestAllowed(), a closed
// (method, path) allowlist that also fixes which host each path may go to.
//  - Hosts: only id.sophos.com, api.central.sophos.com, api.taegis.sophos.com
//    and api-<xx><nn>.central.sophos.com; URLs are rebuilt from validated parts,
//    so a hostile whoami dataRegion can never become a request host.
//  - Writes: refused locally in read_only mode. In response mode only
//    POST /common/v1/alerts/{uuid}/actions {action:'acknowledge'} and the fixed
//    detectionUpdateResolutionInfo mutation with TRUE_POSITIVE_BENIGN.
//  - GET /endpoint/v1/endpoints/{id}/tamper-protection (returns the tamper
//    password) is not on the allowlist and has no method.

import type { SophosCredentials, SophosPermissionMode } from '../../types/sophos.js';

const TOKEN_HOST = 'id.sophos.com';
const GLOBAL_HOST = 'api.central.sophos.com';
const TAEGIS_HOST = 'api.taegis.sophos.com';
const FIXED_HOSTS: ReadonlyMap<string, string> = new Map([TOKEN_HOST, GLOBAL_HOST, TAEGIS_HOST].map((h) => [h, h]));
const REGIONAL_HOST_RE = /^api-([a-z]{2}\d{2})\.central\.sophos\.com$/;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const TOKEN_REFRESH_MARGIN_S = 300;
/** Half of Sophos' 100 req/min tenant budget, which the customer's own SIEM shares. */
export const SOPHOS_DEFAULT_REQUESTS_PER_MINUTE = 50;
const DETECTIONS_POLL_INTERVAL_MS = 2_000;
const DETECTIONS_POLL_TIMEOUT_MS = 60_000;
const OFFSET_PAGE_SIZE = 100;
const MAX_OFFSET_PAGES = 1_000;
const MAX_IDS_PER_CALL = 100;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
/** XDR detection ids look like `alert://priv:<engine>:<tenant>:<id>`. */
const DETECTION_ID_RE = /^[A-Za-z0-9:/._@-]{1,256}$/;

const DETECTIONS_RUN_PATH = '/detections/v1/queries/detections';
const POLICY_TYPES = ['threat-protection', 'server-threat-protection'] as const;

/** The one GraphQL mutation the client will send (auto-resolve, response mode). */
export const SOPHOS_RESOLVE_MUTATION =
  'mutation AchillesResolveDetections($in: UpdateResolutionRequestInput) { detectionUpdateResolutionInfo(in: $in) { reason resolution_status } }';
const RESOLVE_STATUS = 'TRUE_POSITIVE_BENIGN';

type HostKind = 'global' | 'regional' | 'taegis';
type Method = 'GET' | 'POST';

/**
 * Closed allowlist of every (method, path) the client may call and its host.
 * POSTs say what they are: a read-only query run, the alert action, or GraphQL
 * (a read unless the document is a mutation/subscription).
 */
const ROUTES: ReadonlyArray<{ method: Method; re: RegExp; host: HostKind; post?: 'query' | 'alert_action' | 'graphql' }> = [
  { method: 'GET', re: /^\/whoami\/v1$/, host: 'global' },
  { method: 'GET', re: /^\/common\/v1\/alerts$/, host: 'regional' },
  { method: 'GET', re: new RegExp(`^/common/v1/alerts/${UUID}$`), host: 'regional' },
  { method: 'POST', re: new RegExp(`^/common/v1/alerts/${UUID}/actions$`), host: 'regional', post: 'alert_action' },
  { method: 'GET', re: /^\/siem\/v1\/events$/, host: 'regional' },
  { method: 'POST', re: /^\/detections\/v1\/queries\/detections$/, host: 'regional', post: 'query' },
  { method: 'GET', re: new RegExp(`^/detections/v1/queries/detections/${UUID}(/results)?$`), host: 'regional' },
  { method: 'GET', re: /^\/account-health-check\/v1\/(health-check|scores\/historical)$/, host: 'regional' },
  { method: 'GET', re: /^\/endpoint\/v1\/(endpoints|policies|settings\/exclusions\/scanning|settings\/allowed-items)$/, host: 'regional' },
  { method: 'GET', re: new RegExp(`^/endpoint/v1/policies/${UUID}/settings$`), host: 'regional' },
  { method: 'POST', re: /^\/graphql$/, host: 'taegis', post: 'graphql' },
];

/** Distinguishable error for Sophos API failures (branch on statusCode). */
export class SophosApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly bodySnippet: string) {
    super(message);
    this.name = 'SophosApiError';
  }
}

/** Raised when a request is outside the allowlist or a write is attempted in read_only mode. */
export class SophosPermissionError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'SophosPermissionError';
  }
}

/** GraphQL reports failures as HTTP 200 with `errors[]`. */
export class SophosGraphQLError extends Error {
  constructor(message: string, readonly errors: unknown[]) {
    super(message);
    this.name = 'SophosGraphQLError';
  }
}

/** Return the host rebuilt from allowlisted parts, or throw. Takes a bare host (no scheme, port or path). */
export function assertSophosHost(host: string): string {
  const fixed = FIXED_HOSTS.get(host);
  if (fixed) return fixed;
  const m = REGIONAL_HOST_RE.exec(host);
  if (m) return `api-${m[1]}.central.sophos.com`;
  throw new Error(`${String(host).slice(0, 100)} is not an allowed Sophos host`);
}

function findRoute(method: string, path: string) {
  const route = ROUTES.find((r) => r.method === method && r.re.test(path));
  if (!route) throw new SophosPermissionError(`Sophos request not allowed: ${method} ${path.slice(0, 200)}`);
  return route;
}

/** Throws unless some allowlisted route has this path (e.g. never the tamper-protection route). */
export function assertPathAllowed(path: string): string {
  if (!ROUTES.some((r) => r.re.test(path))) throw new SophosPermissionError(`Sophos path not allowed: ${path.slice(0, 200)}`);
  return path;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasExactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));

function isResolveMutation(body: Record<string, unknown>): boolean {
  if (body.query !== SOPHOS_RESOLVE_MUTATION || !isRecord(body.variables) || !hasExactKeys(body.variables, ['in'])) return false;
  const input = body.variables.in;
  return isRecord(input) && hasExactKeys(input, ['alert_ids', 'resolution_status', 'reason'])
    && input.resolution_status === RESOLVE_STATUS && typeof input.reason === 'string'
    && Array.isArray(input.alert_ids) && input.alert_ids.length > 0 && input.alert_ids.length <= MAX_IDS_PER_CALL
    && input.alert_ids.every((id) => typeof id === 'string' && DETECTION_ID_RE.test(id));
}

/**
 * The single choke point every request passes through before it touches the
 * network: (method, path) must be allowlisted, and any write must be one of the
 * two permitted operations in response mode. Returns which host the path uses.
 */
export function assertSophosRequestAllowed(
  mode: SophosPermissionMode,
  req: { method: string; path: string; body?: unknown },
): { host: HostKind } {
  const route = findRoute(req.method, req.path);
  if (route.method === 'GET' || route.post === 'query') return { host: route.host };

  const body = isRecord(req.body) ? req.body : {};
  let allowed: boolean;
  if (route.post === 'graphql') {
    if (typeof body.query !== 'string') throw new SophosPermissionError('Sophos GraphQL request needs a query document');
    // Fail closed: any document that mentions mutation/subscription counts as a write.
    if (!/\b(mutation|subscription)\b/.test(body.query)) return { host: route.host };
    allowed = isResolveMutation(body);
  } else {
    allowed = route.post === 'alert_action' && hasExactKeys(body, ['action', 'message'])
      && body.action === 'acknowledge' && typeof body.message === 'string';
  }
  if (mode !== 'response') {
    throw new SophosPermissionError(
      `Sophos integration is in read-only mode: ${req.method} ${req.path.slice(0, 200)} is not allowed. Switch the integration to Response mode to enable auto-resolve.`,
    );
  }
  if (!allowed) throw new SophosPermissionError(`Sophos write not allowed: only alert acknowledge and ${RESOLVE_STATUS} detection resolution are permitted`);
  return { host: route.host };
}

/** Parse whoami's apiHosts.dataRegion (a full URL) into an allowlisted host. */
function parseDataRegion(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const u = new URL(String(raw));
    const bare = u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash;
    if (!bare) throw new Error('not a bare https host');
    return assertSophosHost(u.hostname);
  } catch {
    throw new SophosApiError('Sophos returned a data region host outside the allowlist; refusing to use it', 502, '');
  }
}

function checkIds(ids: string[], re: RegExp, what: string): void {
  if (ids.length === 0) throw new Error(`${what}: at least one id is required`);
  if (ids.length > MAX_IDS_PER_CALL) throw new Error(`${what}: at most ${MAX_IDS_PER_CALL} ids per call`);
  if (!ids.every((id) => typeof id === 'string' && re.test(id))) throw new Error(`${what}: Invalid id`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Sliding-window limiter: at most `requestsPerMinute` requests in any 60 s.
 * Shared per client_id at module scope, so every SophosClient built for the
 * same credential (sync, auto-resolve, test connection) draws on one budget.
 */
class SlidingWindowLimiter {
  private sentAt: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly requestsPerMinute: number) {}

  acquire(now: () => number): Promise<void> {
    const slot = this.chain.then(async () => {
      for (;;) {
        const t = now();
        this.sentAt = this.sentAt.filter((s) => t - s < 60_000);
        if (this.sentAt.length < this.requestsPerMinute) {
          this.sentAt.push(t);
          return;
        }
        await sleep(this.sentAt[0] + 60_000 - t);
      }
    });
    this.chain = slot.catch(() => undefined);
    return slot;
  }
}

const rateLimiters = new Map<string, SlidingWindowLimiter>();

function limiterFor(clientId: string, requestsPerMinute: number): SlidingWindowLimiter {
  let limiter = rateLimiters.get(clientId);
  if (!limiter) {
    limiter = new SlidingWindowLimiter(requestsPerMinute);
    rateLimiters.set(clientId, limiter);
  }
  return limiter;
}

/** Test-only: forget every shared rate-limit window. */
export function __resetSophosRateLimitersForTests(): void {
  rateLimiters.clear();
}

/** Every form the secret could be echoed in: raw, URI/form-encoded, JSON-escaped. */
function secretVariants(secret: string): string[] {
  const variants = [secret, encodeURIComponent(secret), new URLSearchParams({ s: secret }).toString().slice(2), JSON.stringify(secret).slice(1, -1)];
  return [...new Set(variants)].filter((v) => v.length > 0).sort((a, b) => b.length - a.length);
}

type QueryValue = string | number | boolean | undefined;

export interface SophosWhoAmI {
  id: string;
  idType: 'tenant' | 'partner' | 'organization';
  dataRegionHost: string | null;
}

interface KeyPage { items?: unknown[]; pages?: { nextKey?: string; total?: number } }

export class SophosClient {
  readonly permissionMode: SophosPermissionMode;
  private readonly creds: SophosCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly limiter: SlidingWindowLimiter;
  private token: { value: string; refreshAt: number } | null = null;
  private tenant: { id: string; host: string } | null = null;

  constructor(creds: SophosCredentials, opts: { fetchImpl?: typeof fetch; now?: () => number; requestsPerMinute?: number } = {}) {
    if (!creds.client_id || !creds.client_secret) throw new Error('Sophos client ID and secret are required');
    this.creds = creds;
    this.permissionMode = creds.permission_mode === 'response' ? 'response' : 'read_only';
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? (() => Date.now());
    // requestsPerMinute applies when the first client for this client_id creates the shared window.
    this.limiter = limiterFor(creds.client_id, Math.max(1, Math.floor(opts.requestsPerMinute ?? SOPHOS_DEFAULT_REQUESTS_PER_MINUTE)));
  }

  // ---------------------------------------------------------------------------
  // Transport: rate limit, timeout, 429/5xx backoff, token, 401 re-auth
  // ---------------------------------------------------------------------------

  private async send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire(this.now);
      // Never follow redirects: a 3xx would replay the body (client_secret, write
      // payloads) and X-Tenant-ID to a host the allowlist never saw.
      const res = await this.fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        await res.text().catch(() => undefined);
        throw new SophosApiError(`Sophos answered with a redirect (HTTP ${res.status}); refusing to follow it`, res.status, '');
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await res.text().catch(() => undefined);
        // Full jitter; Sophos sends no Retry-After.
        await sleep(Math.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt));
        continue;
      }
      return res;
    }
  }

  private async apiError(what: string, res: Response, method: Method): Promise<SophosApiError> {
    // Redact the whole body first, then truncate, so a secret straddling the cut can't leak a prefix.
    let text = await res.text().catch(() => '');
    for (const secret of [this.creds.client_secret, this.token?.value]) {
      if (!secret) continue;
      for (const variant of secretVariants(secret)) text = text.split(variant).join('[REDACTED]');
    }
    const snippet = text.slice(0, 300);
    let hint = '';
    if (res.status === 401) hint = ' Check the Sophos client ID and secret (they may be expired or revoked).';
    if (res.status === 403) {
      hint = method === 'GET'
        ? ' The Sophos API credential role cannot read this (Service Principal Read-Only or higher is required).'
        : ' The Sophos API credential role cannot do this (Service Principal Management or Super Admin is required).';
    }
    return new SophosApiError(`Sophos ${what} failed: HTTP ${res.status}.${hint} ${snippet}`.trim(), res.status, snippet);
  }

  private async accessToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && this.token && this.now() < this.token.refreshAt) return this.token.value;
    this.token = null;
    const res = await this.send(`https://${assertSophosHost(TOKEN_HOST)}/api/v2/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.creds.client_id,
        client_secret: this.creds.client_secret,
        scope: 'token',
      }).toString(),
    });
    if (!res.ok) throw await this.apiError('token request', res, 'POST');
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string' || !json.access_token) throw new SophosApiError('Sophos token response had no access_token', 502, '');
    const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600;
    this.token = { value: json.access_token, refreshAt: this.now() + Math.max(0, ttl - TOKEN_REFRESH_MARGIN_S) * 1000 };
    return this.token.value;
  }

  private async tenantContext(): Promise<{ id: string; host: string }> {
    if (!this.tenant) await this.whoami();
    if (!this.tenant) throw new SophosApiError('Sophos did not return a data region for this tenant', 502, '');
    return this.tenant;
  }

  private async request<T>(
    method: Method,
    path: string,
    opts: { params?: Record<string, QueryValue>; body?: unknown; notFoundAsNull?: boolean } = {},
  ): Promise<T> {
    // Allowlist + permission check first: a refused request never reaches the network.
    const { host } = assertSophosRequestAllowed(this.permissionMode, { method, path, body: opts.body });
    const tenant = host === 'global' ? null : await this.tenantContext();
    const hostname = assertSophosHost(host === 'global' ? GLOBAL_HOST : host === 'taegis' ? TAEGIS_HOST : tenant!.host);
    const url = new URL(`https://${hostname}${path}`);
    if (url.hostname !== hostname || url.pathname !== path) throw new SophosPermissionError('Sophos request URL did not round-trip');
    for (const [key, value] of Object.entries(opts.params ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    for (let reauth = 0; ; reauth++) {
      const token = await this.accessToken(reauth > 0);
      const res = await this.send(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(tenant ? { 'X-Tenant-ID': tenant.id } : {}),
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
      if (res.status === 401 && reauth === 0) {
        await res.text().catch(() => undefined);
        continue;
      }
      if (res.status === 404 && opts.notFoundAsNull) return null as T;
      if (!res.ok) throw await this.apiError(`${method} ${path}`, res, method);
      return (await res.json()) as T;
    }
  }

  private async offsetPaged(path: string, params: Record<string, QueryValue>): Promise<unknown[]> {
    const all: unknown[] = [];
    for (let page = 1; page <= MAX_OFFSET_PAGES; page++) {
      const res = await this.request<KeyPage>('GET', path, { params: { ...params, page, pageSize: OFFSET_PAGE_SIZE } });
      const items = res.items ?? [];
      all.push(...items);
      const total = res.pages?.total;
      if (items.length === 0 || (typeof total === 'number' ? page >= total : items.length < OFFSET_PAGE_SIZE)) break;
    }
    return all;
  }

  // ---------------------------------------------------------------------------
  // Read API
  // ---------------------------------------------------------------------------

  /** Tenant id + regional host. Rejects partner/organization credentials and unlisted hosts. */
  async whoami(): Promise<SophosWhoAmI> {
    const res = await this.request<{ id?: unknown; idType?: unknown; apiHosts?: { dataRegion?: unknown } }>('GET', '/whoami/v1');
    if (res.idType !== 'tenant') {
      const kind = String(res.idType ?? 'unknown').replace(/[^a-z]/gi, '').slice(0, 20);
      throw new SophosApiError(`Use a Sophos tenant API credential (this one is a ${kind} credential)`, 400, '');
    }
    if (typeof res.id !== 'string' || !UUID_RE.test(res.id)) throw new SophosApiError('Sophos whoami returned an invalid tenant id', 502, '');
    const dataRegionHost = parseDataRegion(res.apiHosts?.dataRegion);
    this.tenant = dataRegionHost ? { id: res.id, host: dataRegionHost } : null;
    return { id: res.id, idType: 'tenant', dataRegionHost };
  }

  async listAlerts(p: { from?: string; pageFromKey?: string; pageSize?: number; ids?: string[] }): Promise<{ items: unknown[]; nextKey?: string }> {
    if (p.ids?.length) checkIds(p.ids, UUID_RE, 'listAlerts');
    const res = await this.request<KeyPage>('GET', '/common/v1/alerts', {
      params: { from: p.from, pageFromKey: p.pageFromKey, pageSize: Math.min(100, Math.max(1, p.pageSize ?? 100)), ids: p.ids?.join(',') },
    });
    return { items: res.items ?? [], nextKey: res.pages?.nextKey || undefined };
  }

  /** One alert, or null when Sophos no longer has it. */
  async getAlert(id: string): Promise<unknown | null> {
    checkIds([id], UUID_RE, 'getAlert');
    return this.request<unknown>('GET', `/common/v1/alerts/${id}`, { notFoundAsNull: true });
  }

  /** SIEM events (last 24 h only). Pass `cursor` to continue, else `fromDate` (unix seconds). */
  async siemEvents(p: { cursor?: string; fromDate?: number; limit?: number }): Promise<{ items: unknown[]; next_cursor: string; has_more: boolean }> {
    const res = await this.request<{ items?: unknown[]; next_cursor?: string; has_more?: boolean }>('GET', '/siem/v1/events', {
      params: {
        limit: Math.min(1000, Math.max(200, p.limit ?? 1000)),
        ...(p.cursor ? { cursor: p.cursor } : { from_date: p.fromDate !== undefined ? Math.floor(p.fromDate) : undefined }),
      },
    });
    return { items: res.items ?? [], next_cursor: res.next_cursor ?? '', has_more: res.has_more === true };
  }

  /** XDR GraphQL. Read documents in any mode; the only write is resolveDetections(). */
  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.request<{ data?: T; errors?: unknown[] }>('POST', '/graphql', { body: { query, variables } });
    if (Array.isArray(res.errors) && res.errors.length > 0) {
      const msg = res.errors.map((e) => (isRecord(e) && typeof e.message === 'string' ? e.message : 'unknown error')).join('; ');
      throw new SophosGraphQLError(`Sophos GraphQL error: ${msg.slice(0, 300)}`, res.errors);
    }
    return res.data as T;
  }

  /** Deprecated REST v1 detections (read-only history): run → poll until finished (≤ 60 s) → every results page. */
  async detectionsV1(p: { from: string; to: string }): Promise<unknown[]> {
    type Run = { id?: unknown; status?: unknown; result?: unknown };
    const run = await this.request<Run>('POST', DETECTIONS_RUN_PATH, { body: { from: p.from, to: p.to } });
    if (typeof run.id !== 'string' || !UUID_RE.test(run.id)) throw new SophosApiError('Sophos detections query returned no run id', 502, '');
    const runPath = `${DETECTIONS_RUN_PATH}/${run.id}`;
    const deadline = this.now() + DETECTIONS_POLL_TIMEOUT_MS;
    let status = run;
    while (status.status !== 'finished') {
      if (this.now() >= deadline) throw new SophosApiError('Sophos detections query did not finish within 60 s', 504, '');
      await sleep(DETECTIONS_POLL_INTERVAL_MS);
      status = await this.request<Run>('GET', runPath);
    }
    if (status.result !== 'succeeded') {
      throw new SophosApiError(`Sophos detections query ended with result ${String(status.result).replace(/[^a-zA-Z]/g, '').slice(0, 20)}`, 502, '');
    }
    return this.offsetPaged(`${runPath}/results`, {});
  }

  async healthCheck(): Promise<unknown> {
    return this.request<unknown>('GET', '/account-health-check/v1/health-check');
  }

  async healthHistory(p: { startDate: string; endDate: string }): Promise<unknown> {
    return this.request<unknown>('GET', '/account-health-check/v1/scores/historical', { params: { startDate: p.startDate, endDate: p.endDate } });
  }

  async listEndpoints(p: { pageFromKey?: string }): Promise<{ items: unknown[]; nextKey?: string }> {
    const res = await this.request<KeyPage>('GET', '/endpoint/v1/endpoints', {
      params: { view: 'full', pageSize: OFFSET_PAGE_SIZE, pageFromKey: p.pageFromKey },
    });
    return { items: res.items ?? [], nextKey: res.pages?.nextKey || undefined };
  }

  async listPolicies(policyType: (typeof POLICY_TYPES)[number]): Promise<unknown[]> {
    if (!POLICY_TYPES.includes(policyType)) throw new Error('Invalid Sophos policy type');
    return this.offsetPaged('/endpoint/v1/policies', { policyType, pageTotal: true });
  }

  async getPolicySettings(id: string): Promise<unknown> {
    checkIds([id], UUID_RE, 'getPolicySettings');
    return this.request<unknown>('GET', `/endpoint/v1/policies/${id}/settings`);
  }

  async listScanningExclusions(): Promise<unknown[]> {
    return this.offsetPaged('/endpoint/v1/settings/exclusions/scanning', { pageTotal: true });
  }

  async listAllowedItems(): Promise<unknown[]> {
    return this.offsetPaged('/endpoint/v1/settings/allowed-items', { pageTotal: true });
  }

  /** Iterate key-paged results; stops on no key, an empty page or a repeated key. */
  async *paginateKey<T>(fetchPage: (key?: string) => Promise<{ items: T[]; nextKey?: string }>, maxPages = 10_000): AsyncGenerator<T[]> {
    let key: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < maxPages; page++) {
      const res = await fetchPage(key);
      if (res.items.length > 0) yield res.items;
      if (!res.nextKey || res.items.length === 0 || seen.has(res.nextKey)) return;
      seen.add(res.nextKey);
      key = res.nextKey;
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-resolve writes (response mode only — enforced in request())
  // ---------------------------------------------------------------------------

  /** POST /common/v1/alerts/{id}/actions with action 'acknowledge' (asynchronous on Sophos' side). */
  async acknowledgeAlert(id: string, message: string): Promise<{ status: string }> {
    checkIds([id], UUID_RE, 'acknowledgeAlert');
    const res = await this.request<{ status?: unknown }>('POST', `/common/v1/alerts/${id}/actions`, { body: { action: 'acknowledge', message } });
    return { status: typeof res.status === 'string' ? res.status : 'requested' };
  }

  /** Resolve XDR detections as TRUE_POSITIVE_BENIGN (expected security-testing activity). */
  async resolveDetections(ids: string[], reason: string): Promise<{ updated: number }> {
    checkIds(ids, DETECTION_ID_RE, 'resolveDetections');
    const data = await this.graphql<{ detectionUpdateResolutionInfo?: { resolution_status?: string } | null }>(SOPHOS_RESOLVE_MUTATION, {
      in: { alert_ids: ids, resolution_status: RESOLVE_STATUS, reason },
    });
    if (data?.detectionUpdateResolutionInfo?.resolution_status !== 'SUCCESS') {
      throw new SophosApiError('Sophos did not accept the detection resolution', 502, '');
    }
    return { updated: ids.length };
  }
}
