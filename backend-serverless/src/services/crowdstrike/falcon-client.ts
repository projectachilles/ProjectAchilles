// Lightweight CrowdStrike Falcon API client using fetch — no SDK dependency.
// Vercel serverless version — identical to backend/ (fetch-only, no settings I/O).
// Handles OAuth2 client_credentials (secret-only), token caching, pagination, and rate limiting.

import type { FalconAlert, FalconZtaAssessment, PatchAlertsResult, CrowdStrikeRegion } from '../../types/crowdstrike.js';
import type { CrowdStrikeCredentials } from '../../types/integrations.js';

/**
 * Distinguishable error class for Falcon API failures so callers can
 * branch on HTTP status without string-matching. Used by the auto-resolve
 * service to decide whether a candidate should be retried (transient)
 * vs. shelved (permission or not-found).
 */
export class FalconApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly bodySnippet: string,
  ) {
    super(message);
    this.name = 'FalconApiError';
  }
}

/**
 * Falcon cloud region → API base URL. This closed, known set is the ONLY
 * source of fetch targets — user-supplied strings never reach a fetch URL
 * (request-forgery guard; there is deliberately no custom base_url option).
 * Exported so schemas/frontend can mirror the region list conceptually.
 */
export const CROWDSTRIKE_REGION_BASE_URLS: Record<CrowdStrikeRegion, string> = {
  'us-1': 'https://api.crowdstrike.com',
  'us-2': 'https://api.us-2.crowdstrike.com',
  'eu-1': 'https://api.eu-1.crowdstrike.com',
  'us-gov-1': 'https://api.laggar.gcw.crowdstrike.com',
};

export const DEFAULT_CROWDSTRIKE_REGION: CrowdStrikeRegion = 'us-1';

const TOKEN_REFRESH_MARGIN_S = 300; // Refresh 5 min before expiry
const MAX_RETRIES = 3;
/** Max AIDs per /zero-trust-assessment/entities/assessments/v1 request. */
const ZTA_IDS_CHUNK_SIZE = 400;

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix seconds
}

interface CrowdStrikeEnvelope<R> {
  meta?: {
    pagination?: {
      after?: string;
      total?: number;
    };
    writes?: {
      resources_affected?: number;
    };
  };
  resources?: R[];
  errors?: Array<{ code: number | string; id?: string; message: string }>;
}

export class FalconClient {
  private tokenCache: TokenCache | null = null;
  private readonly baseUrl: string;

  constructor(private config: CrowdStrikeCredentials) {
    // The base URL is resolved ONLY from the constant region map — never from
    // a caller-supplied string. An unknown region (e.g. unvalidated data read
    // from disk) throws rather than silently fetching a default or garbage
    // host: fail closed, surface the misconfiguration immediately.
    const region = config.region ?? DEFAULT_CROWDSTRIKE_REGION;
    const baseUrl = (CROWDSTRIKE_REGION_BASE_URLS as Record<string, string>)[region];
    if (!baseUrl) {
      throw new Error(
        `Unknown CrowdStrike region: ${region}. Must be one of: ${Object.keys(CROWDSTRIKE_REGION_BASE_URLS).join(', ')}`,
      );
    }
    this.baseUrl = baseUrl;
  }

  // ---------------------------------------------------------------------------
  // Token acquisition (client_credentials — secret only)
  // ---------------------------------------------------------------------------

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.tokenCache && this.tokenCache.expiresAt > now + TOKEN_REFRESH_MARGIN_S) {
      return this.tokenCache.accessToken;
    }

    const tokenUrl = `${this.baseUrl}/oauth2/token`;

    const body = new URLSearchParams({
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, string>;
      throw new Error(`Token acquisition failed: ${errBody.error_description || errBody.message || `HTTP ${res.status}`}`);
    }

    // expires_in is ~1799s (≈30 min TTL)
    const data = await res.json() as { access_token: string; expires_in: number };
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in,
    };

    return this.tokenCache.accessToken;
  }

  /** Invalidate the cached token (e.g. on 401). */
  invalidateToken(): void {
    this.tokenCache = null;
  }

  // ---------------------------------------------------------------------------
  // Generic Falcon request with 429 retry and 401 refresh
  // ---------------------------------------------------------------------------

  private async falconRequest<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options?: { params?: Record<string, string | string[]>; body?: unknown; forbiddenScopeHint?: string },
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (options?.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        // Array values become repeated query params (CrowdStrike's convention
        // for list inputs, e.g. ?ids=a&ids=b).
        if (Array.isArray(value)) {
          for (const v of value) searchParams.append(key, v);
        } else {
          searchParams.append(key, value);
        }
      }
      url += (url.includes('?') ? '&' : '?') + searchParams.toString();
    }

    let retryCount = 0;

    while (true) {
      const token = await this.getAccessToken();
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });

      // 429 — rate limited, honor Retry-After up to MAX_RETRIES
      if (res.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        retryCount++;
        continue;
      }

      // 401 — token expired / invalid, refresh once
      if (res.status === 401 && retryCount < 1) {
        this.invalidateToken();
        retryCount++;
        continue;
      }

      if (!res.ok) {
        const bodySnippet = (await res.text().catch(() => '')).slice(0, 300);

        if (res.status === 403) {
          const scopeHint = options?.forbiddenScopeHint
            ?? "Ensure the Falcon API client has the required scope granted (e.g. 'Alerts: read', 'Zero Trust Assessment: read').";
          throw new FalconApiError(
            `Falcon ${method} ${path} forbidden (HTTP 403). ${scopeHint} Body: ${bodySnippet}`,
            403,
            bodySnippet,
          );
        }

        throw new FalconApiError(
          `Falcon ${method} ${path} failed: HTTP ${res.status} — ${bodySnippet}`,
          res.status,
          bodySnippet,
        );
      }

      return (await res.json()) as T;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Query alerts via POST /alerts/combined/alerts/v1 (FQL filter + sort +
   * after-token pagination). Returns full alert resources in one call.
   * Pagination: pass the returned `after` token into the next call.
   * Scope: `Alerts: read`.
   */
  async getAlertsCombined(options?: {
    filter?: string;
    sort?: string;
    limit?: number;
    after?: string;
  }): Promise<{ resources: FalconAlert[]; after?: string; total?: number }> {
    const body: Record<string, unknown> = {};
    if (options?.filter) body.filter = options.filter;
    if (options?.sort) body.sort = options.sort;
    if (options?.limit !== undefined) body.limit = options.limit;
    if (options?.after) body.after = options.after;

    const data = await this.falconRequest<CrowdStrikeEnvelope<FalconAlert>>(
      'POST',
      '/alerts/combined/alerts/v1',
      { body },
    );

    return {
      resources: data.resources ?? [],
      after: data.meta?.pagination?.after,
      total: data.meta?.pagination?.total,
    };
  }

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * PATCH alerts via /alerts/entities/alerts/v3. Used by the auto-resolve
   * pillar to flip correlated Achilles alerts to status=closed with an
   * audit-trail comment appended in the same call.
   *
   * Requires the Falcon API client to have the `Alerts: write` scope
   * (strictly more than the read-only scope used by the ingest methods).
   * A 403 here almost always means the scope hasn't been granted — the
   * error message surfaces the exact scope needed so the operator can fix
   * it without digging through Falcon's generic error payloads.
   *
   * IMPORTANT: CrowdStrike returns HTTP 200 with per-item failures in the
   * response envelope (`errors[]`) and the success count in
   * `meta.writes.resources_affected`. This method parses and returns both —
   * callers must inspect them rather than relying on HTTP status.
   *
   * Throws `FalconApiError` on non-2xx responses so callers can branch on
   * `.statusCode` (e.g., 403 → permission missing, halt pass; everything
   * else → record and retry on next pass).
   */
  async updateAlerts(
    compositeIds: string[],
    update: { status?: string; comment?: string },
  ): Promise<PatchAlertsResult> {
    if (!compositeIds || compositeIds.length === 0) {
      throw new Error('updateAlerts: compositeIds is required');
    }

    // v3 takes each change as a { name, value } action parameter (Swagger
    // PatchEntitiesAlertsV3; FalconPy update_alerts_v3). Top-level
    // update_status / append_comment are rejected with HTTP 400 "failed to
    // read and parse request".
    const actionParameters: Array<{ name: string; value: string }> = [];
    if (update.status) actionParameters.push({ name: 'update_status', value: update.status });
    if (update.comment) actionParameters.push({ name: 'append_comment', value: update.comment });
    const body = { composite_ids: compositeIds, action_parameters: actionParameters };

    const data = await this.falconRequest<CrowdStrikeEnvelope<unknown>>(
      'PATCH',
      '/alerts/entities/alerts/v3',
      {
        body,
        forbiddenScopeHint: "Ensure the Falcon API client has the 'Alerts: write' scope granted in the CrowdStrike console (API Clients and Keys).",
      },
    );

    return {
      resourcesAffected: data.meta?.writes?.resources_affected ?? 0,
      errors: data.errors ?? [],
    };
  }

  // ---------------------------------------------------------------------------
  // Zero Trust Assessment
  // ---------------------------------------------------------------------------

  /**
   * Page through assessed device AIDs via
   * GET /zero-trust-assessment/queries/assessments/v1 (getAssessmentsByScoreV1,
   * the only ZTA query route). `filter` is required, so `score:>=0` matches
   * every assessed host; `limit` max is 1000. Resources are {aid, score}
   * objects — mapped down to AIDs here.
   * Scope: `Zero Trust Assessment: read` (requires Falcon Insight licensing —
   * a 403 means "not licensed", not a broken credential).
   */
  async getZtaDeviceIds(options?: {
    limit?: number;
    after?: string;
  }): Promise<{ resources: string[]; after?: string; total?: number }> {
    const params: Record<string, string> = { filter: 'score:>=0' };
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.after) params.after = options.after;

    const data = await this.falconRequest<CrowdStrikeEnvelope<{ aid: string; score?: number }>>(
      'GET',
      '/zero-trust-assessment/queries/assessments/v1',
      { params },
    );

    return {
      resources: (data.resources ?? []).map((r) => r.aid).filter(Boolean),
      after: data.meta?.pagination?.after,
      total: data.meta?.pagination?.total,
    };
  }

  /**
   * Fetch per-device ZTA assessments via
   * GET /zero-trust-assessment/entities/assessments/v1?ids=...
   * Batches AIDs at ZTA_IDS_CHUNK_SIZE (400) per request.
   */
  async getZtaAssessments(aids: string[]): Promise<FalconZtaAssessment[]> {
    const all: FalconZtaAssessment[] = [];

    for (let i = 0; i < aids.length; i += ZTA_IDS_CHUNK_SIZE) {
      const chunk = aids.slice(i, i + ZTA_IDS_CHUNK_SIZE);
      if (chunk.length === 0) continue;

      const data = await this.falconRequest<CrowdStrikeEnvelope<FalconZtaAssessment>>(
        'GET',
        '/zero-trust-assessment/entities/assessments/v1',
        { params: { ids: chunk } },
      );

      if (data.resources) {
        all.push(...data.resources);
      }
    }

    return all;
  }

  // ---------------------------------------------------------------------------
  // Connection test
  // ---------------------------------------------------------------------------

  /**
   * Real token acquisition against CrowdStrike plus one minimal combined
   * alerts query — proves both the OAuth2 credentials and the
   * `Alerts: read` scope in a single check.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.getAccessToken();
      await this.getAlertsCombined({ limit: 1 });
      return { success: true, message: 'Successfully connected to CrowdStrike Falcon' };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
