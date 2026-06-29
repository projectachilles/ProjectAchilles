// Lightweight Microsoft Graph API client using fetch — no SDK dependency.
// Handles OAuth2 client_credentials (secret or certificate), token caching, pagination, and rate limiting.

import { createSign, randomUUID } from 'crypto';
import type { GraphSecureScore, GraphControlProfile, GraphAlert, GraphAlertPatch } from '../../types/defender.js';
import type { DefenderCredentials } from '../../types/integrations.js';

/**
 * Distinguishable error class for Graph PATCH failures so callers can
 * branch on HTTP status without string-matching. Used by the auto-resolve
 * service to decide whether a candidate should be retried (transient)
 * vs. shelved (permission or not-found).
 */
export class GraphPatchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly bodySnippet: string,
  ) {
    super(message);
    this.name = 'GraphPatchError';
  }
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_REFRESH_MARGIN_S = 300; // Refresh 5 min before expiry
const MAX_RETRIES = 3;

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix seconds
}

interface ODataResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

/**
 * Build a signed JWT client assertion for certificate-based auth.
 * The JWT header carries x5t (base64url of SHA-1 cert thumbprint) so Azure
 * can locate the matching public cert on the app registration.
 * Signed with RS256 using the certificate's private key via Node.js crypto.
 * Exported so the test endpoint can call it directly without instantiating a client.
 */
export function buildClientAssertionForTest(
  tenantId: string,
  clientId: string,
  certThumbprint: string,
  privateKeyPem: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  // Azure shows thumbprints as uppercase hex, possibly with colons — normalise
  const x5t = Buffer.from(certThumbprint.replace(/:/g, ''), 'hex').toString('base64url');
  const header = { alg: 'RS256', typ: 'JWT', x5t };
  const payload = {
    aud: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    iss: clientId,
    sub: clientId,
    exp: now + 600,
    nbf: now,
    jti: randomUUID(),
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const toSign = `${headerB64}.${payloadB64}`;
  const sig = createSign('RSA-SHA256').update(toSign).sign(privateKeyPem, 'base64url');
  return `${toSign}.${sig}`;
}

export class MicrosoftGraphClient {
  private tokenCache: TokenCache | null = null;

  constructor(private config: DefenderCredentials) {}

  // ---------------------------------------------------------------------------
  // Token acquisition (client_credentials — secret or certificate assertion)
  // ---------------------------------------------------------------------------

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.tokenCache && this.tokenCache.expiresAt > now + TOKEN_REFRESH_MARGIN_S) {
      return this.tokenCache.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenant_id}/oauth2/v2.0/token`;

    let body: URLSearchParams;
    if (this.config.authMethod === 'certificate') {
      const assertion = buildClientAssertionForTest(
        this.config.tenant_id,
        this.config.client_id,
        this.config.cert_thumbprint,
        this.config.private_key_pem,
      );
      body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.client_id,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        scope: 'https://graph.microsoft.com/.default',
      });
    } else {
      body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.client_id,
        client_secret: this.config.client_secret,
        scope: 'https://graph.microsoft.com/.default',
      });
    }

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, string>;
      throw new Error(`Token acquisition failed: ${errBody.error_description || `HTTP ${res.status}`}`);
    }

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
  // Generic Graph request with pagination, 429 retry, and 401 refresh
  // ---------------------------------------------------------------------------

  private async graphRequest<T>(path: string, params?: Record<string, string>): Promise<T[]> {
    let url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;

    if (params) {
      const searchParams = new URLSearchParams(params);
      url += (url.includes('?') ? '&' : '?') + searchParams.toString();
    }

    const allResults: T[] = [];
    let nextLink: string | undefined = url;
    let retryCount = 0;

    while (nextLink) {
      const token = await this.getAccessToken();
      const res = await fetch(nextLink, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // 429 — rate limited
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
        const errBody = await res.text().catch(() => '');
        throw new Error(`Graph API request failed: HTTP ${res.status} — ${errBody.slice(0, 200)}`);
      }

      const data = (await res.json()) as ODataResponse<T>;
      if (data.value) {
        allResults.push(...data.value);
      }

      nextLink = data['@odata.nextLink'];
      retryCount = 0; // Reset per-page retry counter
    }

    return allResults;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Fetch recent Secure Scores (default: latest 90 days). */
  async getSecureScores(top = 90): Promise<GraphSecureScore[]> {
    return this.graphRequest<GraphSecureScore>('/security/secureScores', {
      $top: String(top),
      $orderby: 'createdDateTime desc',
    });
  }

  /** Fetch all Secure Score Control Profiles. */
  async getControlProfiles(): Promise<GraphControlProfile[]> {
    return this.graphRequest<GraphControlProfile>('/security/secureScoreControlProfiles');
  }

  /** Fetch alerts (v2 unified alerts). Supports OData $filter. */
  async getAlerts(filter?: string, top = 500): Promise<GraphAlert[]> {
    const params: Record<string, string> = {
      $top: String(top),
      $orderby: 'createdDateTime desc',
    };
    if (filter) {
      params.$filter = filter;
    }
    return this.graphRequest<GraphAlert>('/security/alerts_v2', params);
  }

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * PATCH a Microsoft Defender alert. Used by the auto-resolve pillar
   * to flip correlated Achilles alerts to status=resolved with a
   * securityTesting determination and an audit-trail comment.
   *
   * Requires the Azure AD app registration to have
   * `SecurityAlert.ReadWrite.All` granted (strictly more than the
   * read-only scope used by the existing ingest methods). A 403 here
   * almost always means that consent hasn't been granted — the error
   * message surfaces the exact scope needed so the operator can fix
   * it without digging through Graph's generic error payloads.
   *
   * Throws `GraphPatchError` on non-2xx responses so callers can
   * branch on `.statusCode` (e.g., 404 → alert deleted upstream,
   * shelve; 403 → permission missing, halt pass; everything else →
   * record and retry on next pass).
   */
  async updateAlert(alertId: string, patch: GraphAlertPatch): Promise<void> {
    if (!alertId) {
      throw new Error('updateAlert: alertId is required');
    }
    const url = `${GRAPH_BASE}/security/alerts_v2/${encodeURIComponent(alertId)}`;
    await this.writeRequest('PATCH', url, patch, alertId, 'PATCH');
  }

  /**
   * POST a comment to a Microsoft Defender alert via the dedicated
   * `/security/alerts_v2/{id}/comments` endpoint. Used by the auto-resolve
   * pillar to add an audit-trail comment after the resolve PATCH.
   *
   * Why a separate method: the `alerts_v2` PATCH endpoint silently drops
   * `comments` from the request body — comments are managed via this
   * separate sub-resource (Microsoft Graph design, not ours). The legacy
   * `/security/alerts/{id}` endpoint accepted comments inline in PATCH;
   * `alerts_v2` does not.
   *
   * Permission: `SecurityAlert.ReadWrite.All` (same as `updateAlert`).
   * Throws `GraphPatchError` on non-2xx so callers can branch on status
   * code. Auto-resolve treats failures here as non-fatal — the alert is
   * already resolved at that point and the audit comment is "nice to have"
   * relative to the resolution itself.
   */
  async addAlertComment(alertId: string, comment: string): Promise<void> {
    if (!alertId) {
      throw new Error('addAlertComment: alertId is required');
    }
    if (!comment) return; // nothing to post

    const url = `${GRAPH_BASE}/security/alerts_v2/${encodeURIComponent(alertId)}/comments`;
    const body = {
      '@odata.type': 'microsoft.graph.security.alertComment',
      comment,
    };
    await this.writeRequest('POST', url, body, alertId, 'POST comment');
  }

  /**
   * Shared request loop for write operations against the Graph alerts_v2
   * endpoint (PATCH alert, POST comment). Handles 429 backoff, 401 token
   * refresh, and maps 403/404/other to GraphPatchError so callers can
   * branch on status code.
   */
  private async writeRequest(
    method: 'PATCH' | 'POST',
    url: string,
    body: unknown,
    alertId: string,
    label: string,
  ): Promise<void> {
    let retryCount = 0;

    while (true) {
      const token = await this.getAccessToken();
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      // 429 — rate limited, honor Retry-After up to MAX_RETRIES
      if (res.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        retryCount++;
        continue;
      }

      // 401 — token expired, refresh once
      if (res.status === 401 && retryCount < 1) {
        this.invalidateToken();
        retryCount++;
        continue;
      }

      if (res.ok) return; // 2xx

      const bodySnippet = (await res.text().catch(() => '')).slice(0, 300);

      if (res.status === 403) {
        throw new GraphPatchError(
          `Graph ${label} forbidden (HTTP 403). Ensure the Azure AD app has 'SecurityAlert.ReadWrite.All' application permission with admin consent granted. Body: ${bodySnippet}`,
          403,
          bodySnippet,
        );
      }

      if (res.status === 404) {
        throw new GraphPatchError(
          `Graph alert not found (HTTP 404): ${alertId}. The alert may have been deleted upstream.`,
          404,
          bodySnippet,
        );
      }

      throw new GraphPatchError(
        `Graph ${label} failed: HTTP ${res.status} — ${bodySnippet}`,
        res.status,
        bodySnippet,
      );
    }
  }
}
