// Type definitions for the Sophos Central integration.
//
// Sophos Central is the second supported EDR vendor alongside Microsoft
// Defender. Unlike Defender — where the tenant ID is something the operator
// types in — Sophos's tenant and data-region URL are *discovered* via the
// `whoami` endpoint after the OAuth token is obtained. That's why `tenant_id`
// and `data_region` are optional on the settings type but required at
// runtime: they're filled in by `SophosCentralClient.ensureBootstrapped()`
// during the first connection and cached for subsequent calls.

/**
 * Sophos Central licensing tier — drives which APIs the integration can use
 * and therefore the correlation strategy:
 *   - `basic` (Intercept X Advanced and below): Common Alerts only,
 *     correlation by `hostname × time window`.
 *   - `edr` (Sophos EDR): also Detections API, correlation can additionally
 *     match against `detectionDescription` for per-stage discrimination.
 *   - `xdr` (Sophos XDR): EDR plus the XDR Query API for ad-hoc artifact
 *     lookups in the Data Lake.
 *
 * Discovered at credential-save time from `whoami`'s product list; persisted
 * in the settings file so the sync loop knows which path to take without an
 * extra whoami call on every cycle.
 */
export type SophosTier = 'basic' | 'edr' | 'xdr';

/**
 * Response shape from `GET https://api.central.sophos.com/whoami/v1`.
 * Only the fields we actually consume are listed. Sophos's docs surface
 * more (region, partner-specific fields) but we don't depend on them.
 */
export interface SophosWhoamiResponse {
  /** The tenant UUID. Used in the `X-Tenant-ID` header on every tenant-scoped call. */
  id: string;
  /** 'tenant' | 'partner' | 'organization'. We require 'tenant' — partner and organization
   *  credentials need an extra tenant-selection step we don't yet support. */
  idType: string;
  apiHosts: {
    /** Per-tenant API base URL, e.g. `https://api-eu01.central.sophos.com`. May or may
     *  not have a trailing slash depending on region — normalize before caching. */
    dataRegion: string;
    /** Global host. We don't currently use it post-bootstrap. */
    global?: string;
  };
}

/**
 * Result of `SophosCentralClient.testConnection()` — the shape returned by
 * `POST /api/integrations/sophos/test`. The UI surfaces these values so the
 * operator can verify they've connected to the right tenant before saving.
 */
export interface SophosTestResult {
  tenantId: string;
  dataRegion: string;
  tier: SophosTier;
  /** Raw `idType` from whoami. Surfaced so the UI can warn on partner/org credentials. */
  idType: string;
}

/**
 * Thrown by `SophosCentralClient` when an HTTP call to Sophos fails in a way
 * the caller needs to branch on (e.g., auth failure should be reported to the
 * operator differently from a transient 503). Mirrors the role of
 * `GraphPatchError` in the Defender integration.
 */
export class SophosApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly bodySnippet: string,
  ) {
    super(message);
    this.name = 'SophosApiError';
  }
}
