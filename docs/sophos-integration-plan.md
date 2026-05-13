# Sophos Central Integration — Implementation Plan

**Status**: Phase 1 in progress on branch `feat/sophos-integration-phase-1`
**Owner**: ProjectAchilles engineering
**Mirrors**: existing Microsoft Defender integration (`backend/src/services/defender/`)

---

## 1. Goal

Add Sophos Central AV/EDR as a second supported endpoint security vendor, with feature parity to the Microsoft Defender integration:

1. **Sync** alerts, detections (if EDR/XDR licensed), endpoint health, and a synthesized posture score from Sophos Central into Elasticsearch.
2. **Correlate** Achilles test executions to Sophos alerts/detections, writing `f0rtika.sophos_detected` / `f0rtika.sophos_stage_detected` boolean flags on test docs.
3. **Auto-resolve** Achilles-correlated alerts in Sophos Central via the alert actions API so continuous-validation runs don't flood SOC queues.
4. **Render** a Sophos tab in the Analytics dashboard with the same cross-correlation widgets as Defender.

Customers running Defender, Sophos, both, or neither must all work — the integrations are independent and additively configured.

## 2. Non-goals (out of scope for any phase)

- Replacing the existing Defender integration. Defender code stays untouched.
- Generalizing `f0rtika.defender_detected` into a vendor-agnostic field. We add a parallel `f0rtika.sophos_detected` rather than migrating, to keep all changes additive and avoid re-enriching historical test docs.
- Sophos Firewall, Email, Mobile, or Cloud Optix products. This integration is endpoint-only.
- Building a shared `VendorEdrClient` abstraction. The Defender code is already well-isolated; sharing only the binary-naming helper (`extractBundleUuid` etc.) avoids a heavy refactor.

## 3. Sophos API surface used

| Concern | Sophos endpoint | License tier | Notes |
|---|---|---|---|
| OAuth2 token | `POST https://id.sophos.com/api/v2/oauth2/token` | All | client_credentials grant; no scopes — role-based |
| Tenant + region discovery | `GET https://api.central.sophos.com/whoami/v1` | All | Returns `id`, `idType`, `apiHosts.dataRegion` |
| List alerts | `POST {dataRegion}/common/v1/alerts/search` | All | `pageFromKey` pagination, `from`/`to` filter |
| Resolve alert | `POST {dataRegion}/common/v1/alerts/{id}/actions` | All | action enum `acknowledge` preferred (non-destructive) |
| List endpoints | `GET {dataRegion}/endpoint/v1/endpoints?view=summary` | All | Maps `managedAgentId → hostname` for correlation |
| EDR detections | `POST {dataRegion}/detections/v1/queries/detections` | EDR / XDR | Richer evidence (process path, command line, MITRE) |
| XDR ad-hoc query | `POST {dataRegion}/xdr-query/v1/queries` | XDR | osquery-like SQL — used only if a basic correlation fails |

**Auth header pair** required on every tenant-scoped call: `Authorization: Bearer <token>` AND `X-Tenant-ID: <tenantId>`. The dataRegion host is per-tenant (e.g., `https://api-eu01.central.sophos.com`).

## 4. Three known semantic gaps vs. Defender

### Gap 1 — No native Secure Score equivalent

Defender publishes `GET /security/secureScores` with a tenant-wide numeric posture rating. Sophos has none. Mitigation: synthesize a **Sophos Health Score** = `100 × (devices with health.overall == 'good') / total devices`, snapshotted every 6h, stored as `doc_type=health_score` in `achilles-sophos`. UI labels it accurately ("Endpoint Health"), not as a Secure Score knockoff.

### Gap 2 — Common Alerts lack filename evidence

Defender's `evidence_filenames` / `evidence_hostnames` are the load-bearing fields for the `<uuid>*` wildcard correlator. Sophos Common alerts give `managedAgentId`, `description` (free text), and `severity` — no structured filename evidence. Mitigation: **two-mode correlator** chosen at credential-save time based on `whoami`'s product list:

- **Basic mode** (all tiers): correlate by `hostname × time window`. Look up the host's `managedAgentId` from the endpoints index, then `raisedAt ∈ [event_time − 5min, event_time + 30min]`.
- **EDR mode** (when XDR/EDR licensed): additionally match against `detectionDescription` containing the test UUID for per-stage discrimination matching Defender's precision.

### Gap 3 — Coarser alert mutation vocabulary

Defender's PATCH carries `classification=informationalExpectedActivity`, `determination=securityTesting` — semantically "this was us." Sophos's `POST /alerts/{id}/actions` takes an action enum from `{acknowledge, clearThreat, cleanPua, cleanVirus, authPua, clearHmpa, sendMsgPua, sendMsgThreat}` plus a `message` string, and `allowedActions` varies per alert. Mitigation: prefer `acknowledge` when present, fall back to `clearThreat`, else write a skip-forever receipt. Never invoke `cleanVirus`/`cleanPua` (implies real malware remediation) or any `sendMsg*` (would notify the user).

## 5. Phased delivery

| Phase | Scope | PR shape | Status |
|---|---|---|---|
| **1. Plumbing** | OAuth + whoami + region routing client; settings block; env-var override; `GET/POST/DELETE /api/integrations/sophos`; `POST /api/integrations/sophos/test`. No background sync. | ~500 LOC, isolated | **In progress** |
| 2. Sync + index | `achilles-sophos` ES mapping; `sync.service.ts` for alerts + endpoints + health-score snapshot; `setInterval` wiring (Docker) + Vercel Cron route (serverless); manual `/sync` route. | Mid-sized | Planned |
| 3. Correlation (basic) | `enrichment.service.ts` writing `f0rtika.sophos_detected` / `sophos_stage_detected` via hostname×time correlator. Shared `services/edr/binary-naming.ts` extracted from Defender. | Tightest review surface | Planned |
| 4. EDR mode + auto-resolve + dashboard | Optional `/detections/v1` consumption when `tier === 'edr'`; `auto-resolve.service.ts` with `allowedActions`-aware action selection; `/api/analytics/sophos/*` analytics endpoints; frontend `SophosConfig` settings card + `useSophosConfig` hook + `SophosTab` mirroring `DefenderTab`. | Large, high-visibility | Planned |

Each phase ships independently. Phase 1 alone delivers user value (UI can ask "is Sophos configured?" and run a connection test) even if 2–4 slip.

---

## 6. Phase 1 — detailed scope (this branch)

### 6.1 Files added

```
backend/src/services/sophos/
├── sophos-client.ts                      ← OAuth + whoami + dataRegion routing
├── __tests__/
│   └── sophos-client.test.ts             ← Token cache, whoami, retry, error mapping
backend/src/types/sophos.ts               ← SophosTier, SophosWhoamiResponse, etc.
backend/src/api/integrations.routes.ts    ← +5 routes (modified, not added)
backend/src/services/integrations/settings.ts  ← +SophosIntegrationSettings block (modified)
backend/src/types/integrations.ts         ← +SophosIntegrationSettings type (modified)
backend/src/schemas/integrations.schemas.ts    ← +Sophos zod schemas (modified)
backend/src/services/integrations/__tests__/sophos-settings.test.ts  ← settings CRUD + encryption
backend/src/api/__tests__/integrations-sophos.routes.test.ts         ← route happy/sad paths
docs/sophos-integration-plan.md           ← this file
```

Mirrored in `backend-serverless/` with async storage (blob-backed) and the same public surface.

### 6.2 Settings block shape

```typescript
interface SophosIntegrationSettings {
  client_id: string;          // encrypted at rest with prefix "enc:"
  client_secret: string;      // encrypted at rest with prefix "enc:"
  tenant_id?: string;         // discovered via whoami, cached
  data_region?: string;       // discovered, cached (e.g., "https://api-eu01.central.sophos.com")
  tier?: SophosTier;          // 'basic' | 'edr' | 'xdr', discovered via whoami products
  configured: boolean;
  label?: string;
  // Phase 2+ fields below — declared now so the type is stable across phases.
  last_alert_sync?: string;
  last_score_sync?: string;
  auto_resolve_mode?: 'disabled' | 'dry_run' | 'enabled';
}
```

Encryption uses the existing `shared/encryption.ts` AES-256-GCM helper (same as Defender). `enc:` prefix marks encrypted values on disk.

### 6.3 Env-var override

Mirrors the Defender pattern. When `SOPHOS_CLIENT_ID` and `SOPHOS_CLIENT_SECRET` are both set, file-based settings are bypassed entirely. `SOPHOS_TENANT_LABEL` optional for the UI label.

Note: `tenant_id`, `data_region`, and `tier` are **never** taken from env vars — they're always discovered via `whoami` on first connection. This is necessary because Sophos doesn't surface those values in any other way, and it lets a customer move regions without redeploying.

### 6.4 SophosCentralClient public surface (Phase 1)

```typescript
class SophosCentralClient {
  constructor(clientId: string, clientSecret: string)

  // Acquires token + calls whoami. Caches both. Idempotent.
  async ensureBootstrapped(): Promise<{ tenantId: string; dataRegion: string; products: string[] }>

  // Convenience for the /test route. Throws on auth/network failure with a clear message.
  async testConnection(): Promise<{ tenantId: string; dataRegion: string; tier: SophosTier }>

  // Phase 2+ will add: listAlerts, listEndpoints, listDetections, updateAlertAction
}
```

Phase 1 ships **only** the bootstrap + test path. Sync verbs are stubs throwing `not implemented` for now; their tests will be added with Phase 2.

### 6.5 Routes added

| Route | Auth | Body | Returns |
|---|---|---|---|
| `GET /api/integrations/sophos` | Clerk + `integrations:read` | — | masked settings + `configured`/`env_configured` |
| `POST /api/integrations/sophos` | Clerk + `integrations:write` | `{client_id, client_secret, label?}` | `{success: true}` |
| `DELETE /api/integrations/sophos` | Clerk + `integrations:write` | — | `{success: true}` |
| `POST /api/integrations/sophos/test` | Clerk + `integrations:write` | `{client_id?, client_secret?}` | `{success, tenant_id?, data_region?, tier?, error?}` |

The `/test` route is the only Phase 1 route that calls Sophos directly. On success, it returns the discovered tenant/region/tier so the UI can show "Connected to EU01, EDR tier" without a second roundtrip — and so Phase 2's `POST /sophos` can persist that discovery alongside the credentials.

### 6.6 Test-driven discipline

Per the project's TDD norm, every new function gets a failing test first. Order of implementation:

1. RED — write `sophos-client.test.ts` cases for: token cache hit, token cache miss, whoami parsing, dataRegion routing, 429 retry, 401 token refresh, missing-permission error mapping.
2. GREEN — implement `SophosCentralClient` to make each test pass minimally.
3. RED — write `sophos-settings.test.ts` cases for: env override, encryption round-trip, partial update preserving secret, delete-while-env-set rejection.
4. GREEN — extend `IntegrationsSettingsService` with the Sophos methods.
5. RED — write `integrations-sophos.routes.test.ts` cases for: GET (masked), POST (initial vs. edit), DELETE (env-blocked), POST /test (success + auth failure).
6. GREEN — wire the routes in `integrations.routes.ts`.

Each red step must produce a failure for the **expected** reason (feature missing), not a typo. The implementation must not anticipate Phase 2 — sync stubs throw, no premature abstraction.

### 6.7 Verification gates before merge

- `cd backend && npm run build` clean.
- `cd backend && npm test` — full suite green, including the new ~25 Sophos tests.
- `cd backend-serverless && npm run build && npm test` — full suite green with the mirror.
- `cd frontend && npm run build` clean (no Sophos UI yet, but make sure nothing breaks).
- Smoke: `./scripts/start.sh -k --daemon` + `curl -X POST /api/integrations/sophos/test -d '{}'` returns a deterministic "Missing credentials" message.

### 6.8 Risks acknowledged in Phase 1

| Risk | Mitigation |
|---|---|
| `whoami` shape varies across Sophos tiers | Defensive parsing — fields that don't appear → tier defaults to `'basic'`. |
| Customer credential issued for the wrong Central tier (Partner instead of Customer) | `idType` field from whoami exposed in the test response; UI can show "Wrong credential type" before the customer wonders why nothing syncs in Phase 2. |
| Sophos returns redirect URLs in whoami host with trailing slash inconsistency | Normalize: strip trailing slash from `dataRegion` before caching. |
| Future Phase 2 alert ingestion accidentally overwrites Phase 1 settings | All write methods in `IntegrationsSettingsService` are partial-update by design — the existing Defender pattern handles this. |

## 7. Open questions to resolve later (not blocking Phase 1)

- Whether `managedAgentId` is stable across endpoint reboots / reinstalls (decides whether hostname or `managedAgentId` is the primary correlation key).
- Whether `Common /alerts` ever embeds a hostname directly (would let basic mode skip the endpoints-index round-trip).
- Real Sophos rate-limit budget — only knowable from observed `Retry-After` headers. Defender's 3-retry / 30-PATCHes-per-pass caps are the starting point.
- Whether `detectionDescription` for custom unsigned binary execution contains the binary path / UUID. Determines EDR-mode precision.

## 8. References

- [Authenticating to Sophos Central APIs](https://community.sophos.com/sophos-central-api/f/recommended-reads/120745/authenticating-to-sophos-central-apis)
- [Getting Started as a Tenant](https://developer.sophos.com/getting-started-tenant)
- [Common API — alerts search](https://developer.sophos.com/docs/common-v1/1/routes/alerts/search/post)
- [Detections API Guide](https://developer.sophos.com/detections)
- [XDR Query API overview](https://developer.sophos.com/docs/xdr-query-v1/1/overview)
- [Cortex XSOAR Sophos Central integration](https://xsoar.pan.dev/docs/reference/integrations/sophos-central) — useful for action enum semantics
