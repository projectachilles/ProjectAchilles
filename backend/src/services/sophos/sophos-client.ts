// Lightweight Sophos Central API client using fetch — no SDK dependency.
//
// Mirrors the role of `MicrosoftGraphClient` in the Defender integration:
// owns OAuth2 client_credentials, token caching, the whoami bootstrap
// (which is Sophos-specific — Defender doesn't have an equivalent), and
// retry semantics for 429 / 401.
//
// Phase 1 ships only the bootstrap + connection-test surface. Phase 2 will
// extend this class with `listAlerts`, `listEndpoints`, `listDetections`,
// and `updateAlertAction`. Adding those methods doesn't require changing
// anything below — the `signedRequest()` helper is the seam.

import type { SophosTier, SophosWhoamiResponse, SophosTestResult } from '../../types/sophos.js';
import { SophosApiError } from '../../types/sophos.js';

export { SophosApiError };

const TOKEN_URL = 'https://id.sophos.com/api/v2/oauth2/token';
const WHOAMI_URL = 'https://api.central.sophos.com/whoami/v1';

const TOKEN_REFRESH_MARGIN_S = 300; // refresh 5 min before expiry (same as Defender)
const MAX_RETRIES = 3;

interface TokenCache {
  accessToken: string;
  expiresAt: number; // unix seconds
}

interface BootstrapCache {
  tenantId: string;
  dataRegion: string;
  idType: string;
  tier: SophosTier;
}

export class SophosCentralClient {
  private tokenCache: TokenCache | null = null;
  private bootstrapCache: BootstrapCache | null = null;

  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  // ---------------------------------------------------------------------------
  // OAuth2 client_credentials grant
  // ---------------------------------------------------------------------------

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.tokenCache && this.tokenCache.expiresAt > now + TOKEN_REFRESH_MARGIN_S) {
      return this.tokenCache.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'token',
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      // Sophos returns JSON `{"error":"...","error_description":"..."}` on auth failure.
      // Surface error_description if present — it's the most actionable thing the
      // operator can see ("Invalid client secret", "Client not found", etc.).
      let description = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(bodyText) as { error_description?: string; error?: string };
        description = parsed.error_description || parsed.error || description;
      } catch {
        // Body was not JSON — leave description as the status code.
      }
      throw new SophosApiError(
        `Sophos token acquisition failed: ${description}`,
        res.status,
        bodyText.slice(0, 300),
      );
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in,
    };

    return this.tokenCache.accessToken;
  }

  /** Invalidate the cached token (used by the 401 refresh path). */
  invalidateToken(): void {
    this.tokenCache = null;
  }

  // ---------------------------------------------------------------------------
  // Bootstrap (token + whoami) — discovers tenant and dataRegion
  // ---------------------------------------------------------------------------

  /**
   * Discovers the tenant ID and per-tenant data-region API host by calling
   * Sophos's `whoami` endpoint. Result is cached on the instance — repeat
   * calls are free.
   *
   * The whoami call needs a valid Bearer token, so it goes through
   * `signedRequest()` and inherits the 429 + 401 retry logic.
   */
  async ensureBootstrapped(): Promise<BootstrapCache> {
    if (this.bootstrapCache) {
      return this.bootstrapCache;
    }

    const whoami = await this.signedRequest<SophosWhoamiResponse>(WHOAMI_URL);

    if (whoami.idType !== 'tenant') {
      // Partner and organization credentials require an extra tenant-selection
      // step we don't yet support. Surface a clear error so the operator can
      // re-issue the credential under the right Central tier.
      throw new SophosApiError(
        `Sophos credential is for idType='${whoami.idType}' — this integration requires a 'tenant' credential. Re-issue from Sophos Central Customer (not Partner or Enterprise).`,
        200,
        JSON.stringify(whoami).slice(0, 300),
      );
    }

    const dataRegion = whoami.apiHosts.dataRegion.replace(/\/$/, ''); // strip trailing slash

    this.bootstrapCache = {
      tenantId: whoami.id,
      dataRegion,
      idType: whoami.idType,
      // Phase 1 has no signal to distinguish basic / edr / xdr — Phase 4 will
      // probe `/detections/v1` and downgrade gracefully on 403. Default to
      // 'basic' so the conservative correlator runs in Phase 3.
      tier: 'basic',
    };

    return this.bootstrapCache;
  }

  /**
   * Public connection-test helper used by `POST /api/integrations/sophos/test`.
   * Returns the discovered tenant, region, and tier so the UI can show
   * "Connected to <region>, <tier> tier" without a second roundtrip.
   */
  async testConnection(): Promise<SophosTestResult> {
    const bootstrap = await this.ensureBootstrapped();
    return {
      tenantId: bootstrap.tenantId,
      dataRegion: bootstrap.dataRegion,
      tier: bootstrap.tier,
      idType: bootstrap.idType,
    };
  }

  // ---------------------------------------------------------------------------
  // Authenticated request helper with retry (429) + token refresh (401)
  // ---------------------------------------------------------------------------

  /**
   * Issue a GET to a Sophos endpoint with the OAuth bearer token. Used by
   * the bootstrap (whoami) and — once Phase 2 lands — by every other read
   * call. Pass `tenantId` to add the `X-Tenant-ID` header (required on
   * every tenant-scoped call). Bootstrap calls omit it because whoami runs
   * before we know the tenant.
   */
  private async signedRequest<T>(url: string, tenantId?: string): Promise<T> {
    let retryCount = 0;

    while (true) {
      const token = await this.getAccessToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (tenantId) headers['X-Tenant-ID'] = tenantId;

      const res = await fetch(url, { headers });

      // 429 — rate limited, honor Retry-After up to MAX_RETRIES
      if (res.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        retryCount++;
        continue;
      }

      // 401 — token expired or revoked, refresh once
      if (res.status === 401 && retryCount < 1) {
        this.invalidateToken();
        retryCount++;
        continue;
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new SophosApiError(
          `Sophos API request failed: HTTP ${res.status} — ${bodyText.slice(0, 200)}`,
          res.status,
          bodyText.slice(0, 300),
        );
      }

      return (await res.json()) as T;
    }
  }
}
