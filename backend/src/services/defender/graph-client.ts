// Lightweight Microsoft Graph API client using fetch — no SDK dependency.
// Handles OAuth2 client_credentials, token caching, pagination, and rate limiting.

import type { GraphSecureScore, GraphControlProfile, GraphAlert } from '../../types/defender.js';

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

export class MicrosoftGraphClient {
  private tokenCache: TokenCache | null = null;

  constructor(
    private tenantId: string,
    private clientId: string,
    private clientSecret: string,
  ) {}

  // ---------------------------------------------------------------------------
  // Token acquisition (client_credentials grant)
  // ---------------------------------------------------------------------------

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.tokenCache && this.tokenCache.expiresAt > now + TOKEN_REFRESH_MARGIN_S) {
      return this.tokenCache.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

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
}
