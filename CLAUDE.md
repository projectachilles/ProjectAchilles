# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ProjectAchilles is a purple team platform for continuous security validation. It deploys a custom Go agent to endpoints, executes security tests, and measures detection coverage via Elasticsearch analytics.

**Modules:**
- **Browser**: Git-synced test library with MITRE ATT&CK mapping, build/sign/download (Clerk auth)
- **Analytics**: 30+ Elasticsearch query endpoints — defense scores, heatmaps, treemaps, trends (Clerk auth)
- **Agent**: Custom Go agent enrollment, heartbeat monitoring, task execution, scheduling (Clerk auth + SQLite)

## Development Commands

```bash
# Full stack (auto port detection, installs deps)
./scripts/start.sh -k --daemon   # Kill existing processes and start fresh
./scripts/start.sh --stop        # Stop daemon processes

# Individual services
cd frontend && npm run dev       # Vite dev server (port 5173)
cd backend && npm run dev        # tsx watch with hot reload (port 3000)

# TypeScript validation
cd frontend && npm run build     # tsc -b + vite build
cd backend && npm run build      # tsc → dist/
```

### Testing (Vitest)

```bash
# All tests
cd backend && npm test           # 2740 tests across 133 files
cd frontend && npm test          # 1223 tests across 121 files
cd backend-serverless && npm test  # 1719 tests across 69 files

# Single file
cd backend && npx vitest src/services/agent/__tests__/enrollment.service.test.ts
cd frontend && npx vitest src/hooks/__tests__/useAnalyticsFilters.test.ts

# Filter by test name
cd backend && npx vitest -t "creates a token"

# Watch mode / coverage
cd backend && npm run test:watch
cd backend && npm run test:coverage
```

Test file pattern: `src/**/__tests__/**/*.test.{ts,tsx}`

### Go Agent

```bash
cd agent && make build-all       # Cross-compile Windows/Linux/macOS (amd64 + arm64)
cd agent && make sign-windows    # Build + Authenticode sign (osslsigncode)
cd agent && make sign-darwin     # Build + ad-hoc sign (rcodesign)
cd agent && go test ./...        # Run Go tests
cd agent && go build ./...       # Validate compilation
```

### Release Management (Claude Code Commands)

```bash
/release    # Interactive release flow (platform or agent)
/changelog  # Generate changelog entries from commits
/pr         # Create PR with filled template and pre-checks
```

## Architecture

### Frontend (`frontend/src/`)
- **React 19** + **TypeScript** + **Vite 7** + **Tailwind CSS v4**
- **Clerk** for authentication, **Redux Toolkit** for state, **React Router v7** for routing
- Path alias: `@/` → `src/`

Key directories:
- `pages/` - Module pages (browser/, analytics/, endpoints/, auth/)
- `components/shared/ui/` - Base UI primitives (Button, Card, Input)
- `services/api/` - API client modules
- `hooks/` - Custom hooks (`useAuthenticatedApi` injects JWT automatically)
- `store/` - Redux slices; use typed hooks `useAppDispatch`/`useAppSelector` (not raw `useDispatch`/`useSelector`)

### Backend (`backend/src/`)
- **Express** + **TypeScript** (ES modules)
- **Clerk** for auth (`@clerk/express`)

Key directories:
- `api/` - Route handlers (`*.routes.ts`)
- `services/` - Business logic organized by module:
  - `agent/` - Enrollment, heartbeat, tasks, schedules, update, database
  - `analytics/` - Elasticsearch queries, client factory, encrypted settings
  - `browser/` - Git sync, test indexing, metadata extraction
  - `tests/` - Go cross-compilation (build service), multi-cert management
- `middleware/` - Auth, error handling, rate limiting

### Agent (`agent/`)
- **Go 1.25** — lightweight binary with enrollment, heartbeat, task execution, self-update
- **Platforms**: Windows (amd64), Linux (amd64), macOS (amd64 + arm64)
- Internal packages: `config`, `enrollment`, `executor`, `httpclient`, `poller`, `reporter`, `service`, `store`, `sysinfo`, `updater`
- Platform-specific files use build tags (`//go:build darwin`, etc.) for service management, sysinfo, and binary updates
- CGO disabled for static cross-platform binaries
- Version set via LDFLAGS: `-X main.version=$(VERSION)`
- **Service integration**: Windows (SCM via `sc.exe`), Linux (systemd), macOS (launchd plist at `/Library/LaunchDaemons/`)
- **Code signing**: Windows (Authenticode via `osslsigncode`), macOS (ad-hoc via `rcodesign`), Linux (none)

### Database (SQLite)
- **Location**: `~/.projectachilles/agents.db` (better-sqlite3, WAL mode)
- **Schema**: Created via `CREATE TABLE IF NOT EXISTS` in `backend/src/services/agent/database.ts` with incremental migrations (column additions, CHECK constraint updates)
- **Tables**: `agents`, `enrollment_tokens`, `tasks`, `agent_versions`, `schedules`, `run_notices` (pre-execution notices; `tasks.notice_id`), `campaigns`, `campaign_runs` (`tasks.campaign_run_id`). Any new `tasks` column must also be listed in `migrateExecuteCommandType`'s `optionalCols`, or the next table-recreate migration silently drops it
- **Settings storage**: `~/.projectachilles/` — `analytics.json` (AES-256-GCM encrypted), `tests.json`, `certs/`

#### Table Recreation Migrations (CHECK constraint changes)
SQLite has no `ALTER COLUMN`, so changing CHECK constraints requires recreating the table. Follow this pattern to avoid pitfalls:
1. **Drop leftover temp tables first** — `DROP TABLE IF EXISTS <temp>` prevents `SQLITE_ERROR` if a previous migration crashed partway through
2. **Disable FK checks** — `database.pragma('foreign_keys = OFF')` before the swap. Tables like `tasks` reference `agents` via FK; SQLite refuses `DROP TABLE` with FKs on (`SQLITE_CONSTRAINT_FOREIGNKEY`)
3. **Use `pragma()` not string SQL** — `PRAGMA foreign_keys` only works outside transactions; use `database.pragma(...)` not `database.exec('PRAGMA ...')`
4. **Full pattern**: FK OFF, DROP IF EXISTS temp, CREATE temp, INSERT SELECT, DROP old, RENAME, recreate indexes, FK ON

### API Routes
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/browser/*` | Clerk | Security test browser |
| `/api/analytics/*` | Clerk | Elasticsearch analytics |
| `/api/analytics/defender/*` | Clerk | Defender Secure Score, alerts, controls, cross-correlation |
| `/api/integrations/defender/*` | Clerk | Defender credentials, sync trigger |
| `/api/analytics/sentinelone/*` | Clerk | SentinelOne alerts, correlation, posture (policies, agent health, exclusion gaps); backend-only |
| `/api/integrations/sentinelone/*` | Clerk | SentinelOne settings, background sync, auto-resolve / automatic mitigation; backend-only |
| `/api/agent/admin/*` | Clerk | Agent management (tokens, tasks, schedules) |
| `/api/agent/*` | Agent key | Device endpoints (enroll, heartbeat, tasks) |
| `/api/campaigns/*` | Clerk | Saved test campaigns (tests x agents), one-click runs, evidence matrix, CSV export; backend-only |
| `/api/tests/*` | Clerk | Build system, certificates |
| `/api/integrations/alerts/*` | Clerk | Alert thresholds, Slack/email config |
| `/api/notices/*` | Clerk | Pre-execution notice settings, status, release |
| `/api/reports/*` | Clerk | Report payloads: SB-PC-2026-001 JSON export, print-ready execution report (`/executions`) |

### API Key Scopes

| Scope | Permissions | Notable capability |
|-------|-------------|--------------------|
| `read` | every `Permission` ending in `:read` | analytics, results, catalog |
| `read-write` | `ROLE_PERMISSIONS.operator` | dispatch tests, build, schedule |
| `admin` | `ROLE_PERMISSIONS.admin` **minus `settings:users:manage`** | **`endpoints:tasks:command`** — arbitrary shell command as root/SYSTEM on any agent |

The admin scope's carve-out is deliberate: an API key is a bearer credential
with no MFA/session step-up, so granting it `settings:users:manage` would let
a leaked key mint further API keys and create/promote human Clerk admins —
meaning revoking the leaked key would no longer contain the incident. User and
key management (`/api/api-keys/*`, `/api/users/*`) stay Clerk-session-only,
even for `admin`-scope keys.

Scope → permission mapping lives in one place: `permissionsForScope()` in
`backend/src/middleware/apiKeyAuth.middleware.ts`. The `read` scope is
*derivational* — it is computed as "every permission whose name ends in `:read`",
so the naming convention is the security boundary.

API keys do not exist in `backend-serverless/`; a Vercel-hosted instance has no
API-key auth path.

## Code Patterns

### Backend ES Module Imports
Backend requires `.js` extensions in imports (TypeScript compiles to `.js`):
```typescript
// Correct
import browserRoutes from './api/browser.routes.js';

// Incorrect - fails at runtime
import browserRoutes from './api/browser.routes';
```

### TypeScript Style
- Strict mode enabled; avoid `any`
- Use `import type` for type-only imports
- Satisfy `noUnusedLocals`/`noUnusedParameters`

### Backend Error Handling
Wrap async route handlers with `asyncHandler`; throw `AppError` for HTTP errors:
```typescript
import { asyncHandler, AppError } from '../middleware/error.middleware.js';

router.get('/resource/:id', asyncHandler(async (req, res) => {
  const item = await findItem(req.params.id);
  if (!item) throw new AppError('Resource not found', 404);
  res.json({ success: true, data: item });
}));
```

Error response format: `{ success: false, error: "message" }`

### Bundle Results Ingestion

Both cyber-hygiene bundle tests and multi-stage intel-driven tests produce per-control/per-stage results that are fanned out into individual Elasticsearch documents for granular tracking. The same `bundle_results.json` protocol and backend ingestion pipeline handles both.

**Data flow:**
1. **Agent reads** `c:\F0\bundle_results.json` after test execution, validates `bundle_id` matches task UUID, and includes it in the result payload (`agent/internal/executor/executor.go`)
2. **Backend detects** `bundle_results.controls` in the task result and routes to `ingestBundleControls()` instead of the standard single-document path (`backend/src/services/agent/results.service.ts`)
3. **Bulk fan-out** — each control becomes an independent ES document with its own `exit_code`, `severity`, `techniques`, and `tactics` via `client.bulk()` operations

**Additional ES fields for bundle controls:**

| Field | Type | Description |
|-------|------|-------------|
| `f0rtika.bundle_id` | keyword | Bundle test UUID |
| `f0rtika.bundle_name` | keyword | Bundle human-readable name |
| `f0rtika.control_id` | keyword | Individual control ID (e.g., `CH-DEF-001`) |
| `f0rtika.control_validator` | keyword | Parent validator name |
| `f0rtika.control_description` | text | Plain-language "what this stage does" from the control's `description` in `bundle_results.json`; optional, omitted when empty (API: `control_description`) |
| `f0rtika.is_bundle_control` | boolean | `true` for fan-out bundle control documents |

Each control uses its own `exit_code`/`severity`/`techniques`, so the Defense Score counts each control independently.

**Composite test_uuid**: Bundle control documents use `<bundle-uuid>::<control-id>` as the `test_uuid` (e.g., `7659eeba-f315-440e-9882-4aa015d68b27::CH-IEP-003`). The `::` separator is unambiguous — UUIDs and control IDs contain only hyphens. Use `split('::')` to decompose.

**Executions table grouping**: The frontend Executions table groups bundle controls under collapsible parent rows. The parent row shows the bundle name, a `X/Y Protected` summary badge, and an item count badge. The badge shows "X controls" for cyber-hygiene bundles and "X stages" for other categories (e.g., intel-driven). Expanding reveals individual sub-rows with per-control/per-stage results. Skipped stages (non-cyber-hygiene bundles with exit code 0) render with a "Skipped" label and are excluded from the Protected/Unprotected count. Standalone (non-bundle) tests render as flat rows unchanged.

**Key files:**
- `agent/internal/executor/executor.go` — bundle file read and validation
- `agent/internal/executor/types.go` — `BundleResults` and `BundleControlResult` Go structs
- `backend/src/types/agent.ts` — `BundleResults` and `BundleControlResult` TS interfaces
- `backend/src/services/agent/results.service.ts` — `ingestBundleControls()` fan-out logic
- `backend/src/services/analytics/index-management.service.ts` — ES mapping with bundle fields

The bundle results protocol is defined in the f0_library (`CLAUDE.md` → "Bundle Results Protocol" section).

**Multi-binary bundle support:**
Some bundles (baseline, identity-endpoint) use a multi-binary architecture where each validator is a separate embedded binary. The orchestrator runs `build_all.sh` which needs the active signing certificate to sign validator binaries before embedding. The build service passes the cert via environment variables:
- `F0_SIGN_CERT_PATH` — absolute path to the active PFX certificate
- `F0_SIGN_CERT_PASS_FILE` — path to a temporary file containing the cert password (cleaned up after build)

These env vars are set automatically in `buildService.ts` when a `build_all.sh` is detected and the target platform is Windows. The inner cert password file uses mode `0o600` and is deleted in a `finally` block.

### Defense Score basis
Analytics endpoints take `basis=latest|executions` (default `executions`; invalid -> 400 `Invalid basis`). `latest` scores test x endpoint **pairs**: key = org + test UUID + hostname, most recent conclusive result in the window (window capped 365d). In `any-stage` mode a non-cyber-hygiene bundle on a host is one pair (protected if any stage of its latest run is). The exception is `technique-distribution`, which always uses per-stage pairs (`scoringMode: 'all-stages'`), so a technique is never marked protected because a sibling stage was. Pure rules live in `services/analytics/posture.ts`, kept byte-identical in `backend/` and `backend-serverless/`. Trend under `latest` ignores `windowDays`; its last point equals the tile; empty windows are `null`, not 0. Trend-point `realScore`/`realTotal`/`realProtected` stay the pre-risk-acceptance series (only when exclusions exist), unlike `/defense-score`'s strict blocked-only `realScore`. `threat-actor-coverage` also accepts `basis=latest` (adds `pairCount`, `lastTestedAt`). `technique-outcomes` is latest-basis and per-stage like `technique-distribution` (ignores `basis`). `chain-depth` is latest-basis (each chain's latest run per host; a blocked chain counts at its lowest-numbered blocked `Stage N`, so chains that keep running after a block, like LockBit, bucket correctly). Stay on executions: by-test/technique/severity/category/org, the PDF report, score-drop alerts, and timeline cards. Docs: `wiki/docs/api-reference/analytics.md`.

### Authentication
**Three-tier model:**
1. **Clerk (global)**: All routes use `<RequireAuth>` wrapper; JWT injected via `useAuthenticatedApi` hook. Roles live in Clerk `publicMetadata.role`; the backend reads `sessionClaims.metadata`, and when the token has no `metadata` claim (no session-token customisation, which Clerk can't set by API) `hydrateClaimsFromClerk()` fills it from the Clerk API (60s cache, both backends)
2. **Analytics**: `AnalyticsAuthProvider` context → redirects to `/analytics/setup` if unconfigured
3. **Agent admin**: Clerk JWT required; device endpoints use agent API key (hashed in DB)

### Backend Test Pattern
Tests use in-memory SQLite via `createTestDatabase()` from `backend/src/__tests__/helpers/db.ts`. The `vi.mock` + dynamic import ordering is critical:
```typescript
let testDb: Database.Database;
vi.mock('../database.js', () => ({ getDatabase: () => testDb }));
// Import the module AFTER mock setup
const { functionToTest } = await import('../service.js');
```

Frontend tests mock all Clerk hooks globally via `frontend/src/__tests__/setup.ts`.

### Frontend Imports
- Use `@/` alias for `frontend/src` paths
- Group imports: external → internal

### Dependency Overrides & Lockfiles
- **Overrides are floors, never exact pins**: `"pkg@<1.2.3": "1.2.3"`, not `"pkg": "1.2.3"`. An exact pin freezes the package at that version, so every later security fix is blocked. That's how the wiki ended up stuck on vulnerable `brace-expansion`/`js-yaml`/`undici`, and serverless on `tar` 7.5.19. Exception: npm 10 doesn't apply the `pkg@<range` form to nested copies whose parent range is already satisfied; there, use `"pkg": "^x.y.z"` (still a floor within the major).
- **Regenerate lockfiles with Node 22's npm (10.x)** in `node:22-slim`, because that's what CI and the Dockerfiles run `npm ci` with. npm 10.9.9 crashes in `npm audit fix` / `npm update` on some trees (`edgesOut` null in `#loadPeerSet`). Compute the fix with `npx npm@11 audit fix`, then re-sync with npm 10 (`npm install --package-lock-only`) and prove it with npm 10 `npm ci`.
- `npm audit fix --force` "fixes" here are often **downgrades** (e.g. `@vercel/node@3`, older Docusaurus). Don't use `--force`; add a targeted override instead.

### API Proxying
Vite proxies `/api` → `http://localhost:$VITE_BACKEND_PORT` (default 3000)

## Documentation Hygiene

**Never commit live secrets to docs.** Real API keys, tokens, passwords, private keys, OAuth client secrets, webhook URLs, signed URLs, or any other production credential must never appear in any tracked file under `docs/`, `README.md`, `AGENTS.md`, `CLAUDE.md`, or any other markdown / `.txt` / config sample. Once a value is committed to git history it must be considered compromised — redacting it after the fact does not retroactively protect it; the credential must be rotated.

Applies equally to: Elasticsearch API keys + Cloud IDs, Clerk `sk_*` / `pk_live_*` keys, Defender `client_secret`, Slack webhook URLs, GitHub PATs, AWS access keys, signing certificate passwords, Turso tokens, Vercel Blob tokens, Render/Fly secrets.

Use placeholders instead — `<elasticsearch-api-key>`, `pk_live_XXX`, `${ENV_VAR_NAME}`, or `[REDACTED]`. For runbooks that need to record a credential's value during a transient operation (e.g. rollback values during a migration soak window), store the actual value in a password manager or `~/.projectachilles/` settings file and reference it from the doc by name only — never inline. If a credential leaks despite this, treat it as an incident: rotate immediately, then sanitize the doc.

## Commit Convention
```
<type>(<scope>): <description>
```
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
Scopes: `frontend`, `backend`, `backend-serverless`, `agent`, `analytics`, `browser`, `docker`, `render`, `vercel`, `fly`, `settings`, `certs`, `deps`, `ci`, `release`, `wiki`, `installer`

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to main:
- `Test backend`, `Test frontend`, `Test backend-serverless`: npm ci → build → test
- Node 22

`.github/workflows/dependency-audit.yml` runs `npm audit --omit=dev` for all five npm roots (backend, backend-serverless, frontend, blog, wiki) on lockfile changes, on pushes to main, and weekly. It fails on high/critical advisories unless they're accepted in `.github/audit-allowlist.json`. Every entry needs a `reason` and an `expires` date (about 3 months out); an expired entry fails the job, so "no fix available" gets re-checked. Only allow-list advisories with no fixed release; otherwise upgrade.

**Code scanning and reviews.**
- **CodeQL** runs from `.github/workflows/codeql.yml` (advanced setup), because default setup skips fork PRs. It mirrors the former default setup: actions/go/js-ts/python, `default` suite, `remote` threat model, weekly. Keep default setup **disabled**: GitHub rejects advanced uploads while it is on.
- **Semgrep** (`security-review.yml`) fails when the scan didn't really run: a config error, or 0 files scanned. A removed registry pack (`p/express` → `p/expressjs`) once made it scan nothing while reporting "no findings". Findings stay non-blocking. On fork PRs the report is in the job summary, because the comment needs a write token.
- **Claude reviews on fork PRs.** Fork `pull_request` runs get no secrets, and claude-code-action needs a write-access actor. So `claude-review` and `claude-security-review` skip fork PRs on `pull_request`, and run when a maintainer adds the **`claude-review` label** after reading the diff (`pull_request_target`).
  - Those runs check out the base branch, put the PR head in `./pr-head` as data only, and never run PR code.
  - The label is removed after the run, so re-label after each new push.
  - Never check out the PR head at the workspace root in these jobs, and never add steps that run PR code.
- **Vercel previews of fork PRs** need a team member to click "Authorization required to deploy" in the PR checks. Keep Git Fork Protection on: it guards the projects' environment variables.

## Deployment

Seven deployment targets are supported. The original `backend/` and `frontend/` are used for all targets except Vercel, which uses a purpose-built serverless fork.

| Target | Backend | DB | File Storage | Builds (Go) | Guide |
|--------|---------|-----|-------------|-------------|-------|
| **Docker Compose** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Below |
| **Public server (VPS/droplet)** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | `docs/deployment/SELF_HOSTED_SERVER.md` |
| **On-prem server** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | `docs/deployment/ON_PREM_SERVER.md` |
| **Railway** | `backend/` | SQLite (volume) | Filesystem (volume) | Partial | `docs/deployment/RAILWAY.md` |
| **Render** | `backend/` | SQLite (persistent disk) | Filesystem (disk) | Partial | `docs/deployment/RENDER.md` |
| **Fly.io** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | `docs/deployment/FLY.md` |
| **Vercel** | `backend-serverless/` | Turso (@libsql) | Vercel Blob | No | `docs/deployment/VERCEL.md` |

### Public / On-Prem Server (Caddy + single origin)

A self-contained single-server install behind a [Caddy](https://caddyserver.com) reverse proxy that terminates TLS, exposing one public origin (UI at `/`, API at `/api`, agents on the same host). Defined by `docker-compose.server.yml` + `deploy/caddy/`, driven by the hybrid (config-file or interactive) scripts in `scripts/`:

```bash
cp deploy.config.env.example deploy.config.env   # fill in domain, Clerk keys, TLS_MODE, ES_MODE
./scripts/deploy-server.sh        # install on THIS machine
./scripts/deploy-remote.sh u@host # install on a remote SSH host (on-prem entry point)
./scripts/deploy-do.sh            # create a DigitalOcean droplet, then install
```

On-prem LAN and cloud installs can instead use the Go TUI installer, `achilles-installer` (`installer/`): a wizard around `scripts/deploy-server.sh` with `TLS_MODE=achilles-ca` (a name-constrained ProjectAchilles root + intermediate CA); on a public interface IP (cloud servers) it recommends `acme-http` instead. After the install it makes `ADMIN_EMAIL` an admin through the Clerk Backend API (`installer/internal/clerkadmin`: invitation with `public_metadata.role=admin`, or a metadata merge for an existing account). Day-2: `status`, `upgrade`, `backup`, `restore`. `scripts/install-onprem.sh` is the one-command bootstrap: it clones the repo into `/opt/projectachilles` (or `--dir`), installs the SHA256SUMS-verified release binary for `--ref` (building from source when there is no release asset) and launches the wizard. Rendered Caddy snippets live in `deploy/caddy/rendered/` (gitignored), so after a `git pull` re-run `deploy-server.sh` (or `achilles-installer upgrade`). Guide: `docs/deployment/SERVER_INSTALLER.md`.

`TLS_MODE` selects certificate issuance: `acme-http` (public, Let's Encrypt HTTP-01), `acme-dns` (Let's Encrypt DNS-01, no inbound needed — builds a custom Caddy image with the DNS-provider plugin), `internal` (Caddy local CA; root CA exported for browsers + the agent's `ca_cert`), `byo` (mount cert/key PEM), or `achilles-ca` (name-constrained ProjectAchilles CA for LAN installs; see `docs/deployment/SERVER_INSTALLER.md`). `ES_MODE` is `self` (bundled ES container, ≥4 GB RAM) or `cloud` (Elastic Cloud). The installer writes `backend/.env` + root `.env` (mode 600, gitignored) and is idempotent. See the two guides above; the public guide holds the shared reference (architecture, backups, day-2).

### Docker Compose

```bash
docker compose up -d                            # Backend + frontend
docker compose --profile elasticsearch up -d    # Include ES + synthetic seed data
```

The `elasticsearch` profile starts ES 8.17 (single-node, security disabled) and seeds 1000 synthetic test results.

### Render

Uses the existing Dockerfiles with Render's persistent disk for SQLite and settings. Deploy via Blueprint (`render.yaml`) or manual setup. See `docs/deployment/RENDER.md` for full walkthrough.

```bash
# Blueprint deploy: push render.yaml then connect repo at render.com/deploy
# Key env vars: CLERK_*, ENCRYPTION_SECRET, CORS_ORIGIN, AGENT_SERVER_URL, ELASTICSEARCH_*
# Persistent disk: /root/.projectachilles (1 GB)
# Port: 10000 (Render default for Docker services)
```

### Fly.io

Uses the existing Dockerfiles with Fly.io Machines and a persistent volume for SQLite and settings. Deploy via `flyctl` CLI. See `docs/deployment/FLY.md` for full walkthrough.

```bash
# Create apps + volume, set secrets, deploy
# Key env vars: CLERK_*, ENCRYPTION_SECRET, CORS_ORIGIN, AGENT_SERVER_URL, ELASTICSEARCH_*
# Persistent volume: /root/.projectachilles (1 GB)
# Backend: shared-2x 512 MB, Frontend: shared-1x 256 MB
# Cost: ~$8/mo (cheapest always-on option)
```

### Vercel (Serverless)

Uses `backend-serverless/` — a fork of the backend adapted for serverless. Replaces SQLite with Turso, filesystem with Vercel Blob, and signing keys with env vars. Features not available on serverless (Go builds, cert generation, git sync) return 503. See `docs/deployment/VERCEL.md` for full walkthrough.

```bash
# Two Vercel projects: backend (backend-serverless/), frontend (frontend/)
# Key env vars: CLERK_*, TURSO_*, BLOB_READ_WRITE_TOKEN, ENCRYPTION_SECRET
# Cron routes: /api/cron/schedules, /api/cron/auto-rotation
# Capabilities endpoint: GET /api/capabilities (feature flags for frontend)
cd backend-serverless && npm test    # 1719 tests across 69 files
```

### Backend Serverless (`backend-serverless/`)

A separate directory — **not** a build target of `backend/`. Key differences from the original backend:

| Component | `backend/` | `backend-serverless/` |
|-----------|-----------|----------------------|
| Database | `better-sqlite3` (sync) | `@libsql/client` (async, Turso) |
| DB helper | `getDatabase()` returns sync `Database` | `getDb()` returns async `DbHelper` |
| Storage | `fs` (filesystem) | `@vercel/blob` (via `storage.ts`) |
| Signing | Filesystem keypair | `SIGNING_PRIVATE_KEY_B64` / `SIGNING_PUBLIC_KEY_B64` env vars |
| Entry point | `server.ts` (Express listen) | `app.ts` (Express export) + `api/index.ts` |
| Scheduling | `setInterval` in process | Vercel Crons → `cron.routes.ts` |
| Test library | Runtime git sync | Build-time clone (`vercel-build` script) |
| Build system | Go cross-compilation | Stubbed (returns 503) |
| Cert generation | OpenSSL CLI | `node-forge` (pure JS, no native deps) |

When modifying `backend/`, changes do **not** propagate to `backend-serverless/` — they are independent codebases. If a change affects shared logic (types, API contracts, ES mappings), update both.

## Browser Testing

Two browser tools are available for visual verification. **Prefer the Claude Code Chrome Extension** (uses real browser with auth sessions); fall back to **Playwright** (`mcp__plugin_playwright_playwright__*`) for headless screenshots, drag-and-drop, file uploads, `browser_wait_for`, or programmatic JS execution.

### Workflow
1. Start dev server: `./scripts/start.sh -k --daemon`
2. Navigate to `http://localhost:5173`
3. When encountering Clerk login, ask the user for credentials — never guess
4. For Analytics setup, read Elasticsearch credentials from `backend/.env`

## Gotchas

### SVG Text Stroke Inheritance in Recharts
When writing custom `content` renderers for Recharts components (Treemap, etc.), always set `stroke="none"` on `<text>` elements. Recharts sets `stroke="var(--background)"` on the parent SVG container for cell borders, and SVG `stroke` is an inherited property — it cascades to all children including text. In dark mode `--background` is near-black, so text renders with a visible dark outline around every glyph. In light mode the stroke is white-on-white (invisible), making the bug theme-specific and easy to miss.

### Campaigns
Saved test plans (tests x agents) with one-click runs and an evidence matrix (`services/campaigns/`, `api/campaigns.routes.ts`, `frontend/src/pages/campaigns/`). User docs: `wiki/docs/user-guide/agent-management/campaigns.md`, `wiki/docs/api-reference/campaigns.md`.
- **Snapshot immutability**: `campaign_runs` has no FK to `campaigns`; a run stores a JSON snapshot (name, label, tests, agents, skipped pairs, `started_by_name`). Editing or deleting a campaign never changes a past run, and `GET /api/campaigns/runs` still lists runs of deleted campaigns.
- **`tasks.campaign_run_id`**: any new `tasks` column must also go in `migrateExecuteCommandType`'s `optionalCols` (and its index in the index recreation), or the next table-recreate migration silently drops it. `campaign_run_id` is there.
- **Shared `resolveTestArtifact`** (`services/agent/testArtifacts.js`): preflight and `createTasks` must both resolve binaries through it so a dry run can never disagree with the real dispatch. Preflight calls it with `hash: false`.
- **Launch is one transaction** (run row + all tasks + notice) whether or not pre-execution notices are on. Partial runs (skipped pairs) throw `PartialRunError` (409 with `skipped`) until `confirm_partial: true`. Limits: 100 tests, 5,000 tasks per run.
- **Org**: the run always uses the campaign's org; a mismatched `org_id` is 403; agents are re-checked against the caller's org at launch (400). `REQUIRE_ORG_ISOLATION` makes no-org callers 403 on every route.
- **Backend-only**: `backend-serverless/` reports `campaigns: false` in `/api/capabilities` and mounts nothing; the frontend hides the nav entry and routes on that flag.
- **Cell verdicts match Analytics** (`services/outcomes/verdict.ts`, shared with the notice Finished email): Protected > Prevented > Detected > Unprotected > Error, per-stage via `reports/stageOutcome.ts` `classifyStage`. EDR flags come from ES by exact `_id` (`<task_id>` or `<task_id>::<control_id>`, `outcomes/edr.ts`); ES down → exit codes only, `edr.status: 'unavailable'`. `percent_protected` counts prevented + detected as protected (Defense Score basis). If you change the Analytics label rule, change this too. The matrix is async (one ES query per run, chunked by 1,000 ids).
- **Print**: no named `@page` (it adds a blank portrait page after the app shell); `CampaignRunPage` injects `@page { size: landscape }` while mounted, like the Analytics report.

### Certificate System & Code Signing
- Multi-cert storage: `~/.projectachilles/certs/cert-<timestamp>/` (max 5)
- Active cert tracked in `active-cert.txt`
- Legacy flat files auto-migrate to subdirectory on first `listCertificates()` call
- Build service reads active cert dynamically via `settingsService.getActiveCertPfxPath()`
- **Windows signing**: `osslsigncode` with PFX certificate (password via temp file, not CLI arg)
- **macOS signing**: `rcodesign sign --code-signature-flags adhoc` (in-place, no certificate needed)
- **Linux**: No code signing
- Both agent builds (`agentBuild.service.ts`) and test builds (`buildService.ts`) follow the same signing logic
- Signing failures are non-fatal — builds continue unsigned

### Agent Self-Update Safety
An agent update that goes wrong can knock the whole fleet offline, so several layers of protection exist. Don't remove any of them (user doc: `wiki/docs/user-guide/agent-management/self-updates.md`):
- **Registered version must equal the embedded `-X main.version`**, or agents install → restart reporting the old version → reinstall in a loop. `binaryVersion.ts` (both backend forks) reads the Go build info. `registerVersion()`, which every registration path goes through (register-by-path, upload, build), rejects a mismatch or an unstamped binary (unstamped binaries report `main.go`'s default, which can't be verified). The admin routes turn that into a 422. Only direct SQLite inserts bypass it.
- **Agent launch check** (`updater/verify_install.go`): after swapping the binary in, run `<final path> --version`. If it fails or reports the wrong version, restore `<path>.old` and fail the update. Run it at the *final* path so path-scoped allowlists apply. Agent-side fixes protect only updates *from* the release that contains them.
- **Repeat-install guard**: `state.json` `last_applied_update` (version + SHA256 + from-version) stops the agent reinstalling the same artifact.
- **Windows restart**: SCM recovery doesn't cover *start* failures (event 7000). The fallback `AchillesAgentRestart` task is registered via PowerShell `Register-ScheduledTask` with a `[DateTime]` trigger (`service/restart_task.go`). Never use `schtasks /SD`: it's locale-dependent and broke on `en-GB`.
- **`update_agent` task results** must include `os`/`arch`/`hostname`/timestamps, or `TaskResultSchema` returns 400 and the task stays in `executing` forever.
- **Build from source** refreshes the `AGENT_REPO_URL` clone before every build (`AgentBuildService` + `GitSyncService.sync()`), because `ensureRepo()` never pulls and Render's `buildFilter` doesn't redeploy on agent-only merges. The commit goes into the release notes.
- **Defender ASR** rule `01443614` (prevalence/age) blocks every fresh build. Customers need a **per-rule** exclusion for exactly `C:\F0\achilles-agent.exe`: never the `C:\F0` folder (tests must stay subject to ASR), and never a cert Allow indicator. The agent and all test binaries share the active signing cert, so trusting it whitelists every test.

### Source-Built vs External Embed Dependencies
`EmbedDependency` has a `sourceBuilt: boolean` flag distinguishing binaries compiled from Go source by `build_all.sh` from external pre-compiled binaries. Detection uses four heuristics in `isSourceBuiltBinary()` (`buildService.ts`):
1. **Direct match** — `foo.exe` → `foo.go` exists
2. **Hyphen-to-underscore** — `validator-defender.exe` → `validator_defender.go` exists
3. **UUID-prefix stage** — `<uuid>-T1486.exe` → strip UUID, check `stage-T1486.go` or prefix match (`stage1-defense-evasion.go`)
4. **Fallback** — parse `build_all.sh` for literal `go build -o <filename>`

Only external (non-source-built) missing deps block the Build button and show Upload. Source-built deps show a wrench icon + "Auto-built" label. `saveUploadedFile()` rejects uploads for source-built deps.

### Microsoft Defender Integration
Pulls Secure Score, alerts (v2), and control profiles from Microsoft Graph API. Conditionally shown in Analytics dashboard when configured.

- **Configuration**: Settings → Integrations → Microsoft Defender card. Requires Azure AD App Registration with `SecurityEvents.Read.All` (Application type, admin consent)
- **Credentials**: `DEFENDER_TENANT_ID`, `DEFENDER_CLIENT_ID`, `DEFENDER_CLIENT_SECRET` env vars or UI (AES-256-GCM encrypted in `~/.projectachilles/integrations.json`)
- **Graph client**: Custom `fetch`-based (`services/defender/graph-client.ts`) — OAuth2 client_credentials, token caching, OData pagination, 429 retry
- **ES storage**: Single index `achilles-defender` with `doc_type` discriminator (`secure_score`, `control_profile`, `alert`). Sparse fields across doc types
- **Background sync**: Scores/controls every 6h, alerts every 5min (Docker: `setInterval`, Vercel: Cron at `/api/cron/defender-sync`)
- **Analytics routes**: 9 endpoints under `/api/analytics/defender/` (secure-score, alerts, controls, cross-correlation)
- **Cross-correlation**: Defense Score vs Secure Score over time, MITRE technique overlap between test results and Defender alerts
- **Conditional UI**: All Defender dashboard elements hidden when not configured (`useDefenderConfig` hook)
- **Serverless parity**: Full implementation in `backend-serverless/` with async blob storage and Vercel Cron

#### Auto-Resolve Pillar (third Defender pillar, Apr 2026)

Programmatically resolves Achilles-correlated alerts in Microsoft Defender so continuous-validation activity doesn't flood the SOC queue. Architecturally integral to the Defender integration, operationally opt-in.

- **Extra permission required**: `SecurityAlert.ReadWrite.All` on the Azure AD app (in addition to the existing read-only scopes). 403 failures surface the exact scope name in the error message.
- **Modes** (persisted in `auto_resolve_mode` field of Defender settings): `disabled` (default) | `dry_run` (compute + log + receipt, no PATCH) | `enabled` (PATCH via `MicrosoftGraphClient.updateAlert`)
- **Correlation flags on alert docs** (written by the enrichment pass when an alert matches an Achilles test): `f0rtika.achilles_correlated`, `f0rtika.achilles_test_uuid`, `f0rtika.achilles_matched_at`
- **Receipt flags on alert docs** (written by the auto-resolve pass): `f0rtika.auto_resolved`, `f0rtika.auto_resolved_at`, `f0rtika.auto_resolve_mode`, `f0rtika.auto_resolve_error`
- **Resolver semantics**: PATCH sets `status=resolved`, `classification=informationalExpectedActivity`, `determination=securityTesting`, with an audit-trail comment naming the bundle UUID. 403 halts the pass cleanly; 404 writes a skip-forever receipt; transient errors skip the receipt so the next pass retries.
- **Cadence**: runs after every enrichment pass (5 min on Docker/Render/Fly, Vercel Cron tick on Vercel). Capped at 30 PATCHes per pass to protect the tenant from rate-limiting.
- **Defense Score invariant**: auto-resolve NEVER writes to test docs. Test docs and Defense Score stay byte-identical whether auto-resolve is disabled or enabled.
- **Routes**: `GET /api/integrations/defender/auto-resolve/status`, `PUT /.../mode`, `GET /.../receipts?limit=&offset=`
- **UI**: Collapsed `DefenderAutoResolveSection` inside the existing Defender settings card, shown only once Defender is configured
- **Key files**: `services/defender/auto-resolve.service.ts`, `graph-client.ts` (`updateAlert` + `GraphPatchError`), `enrichment.service.ts` (alert-side writes), `sync.service.ts` (wiring)
- **Customer setup guide**: `docs/defender-auto-resolve.md` (permission grant, dry-run audit, enable flow, troubleshooting)

### SentinelOne Integration
Pulls threats (`/threats`) and detection alerts (`/cloud-detection/alerts`) from the SentinelOne Management API v2.1 into `achilles-sentinelone`, in the same normalized alert shape as CrowdStrike, plus a 6-hourly posture pass (exclusions, policies, agents) into a separate posture index. Contributed in PR #566. User docs: `wiki/docs/user-guide/integrations/sentinelone.md`, `sentinelone-auto-resolve.md`, `wiki/docs/api-reference/sentinelone.md`.

- **Backend-only.** `backend-serverless/` has no SentinelOne code; `GET /api/capabilities` reports `sentinelone: false` there and the Settings card is hidden.
- **Settings live in `IntegrationsSettingsService`** (`getSentinelOneSettings`, `saveSentinelOneSettings`, `getSentinelOneSyncTimestamps`, ...), like Defender and CrowdStrike, with env fallback `SENTINELONE_BASE_URL` / `SENTINELONE_API_TOKEN` and the standalone `sentinelone_sync` key for env-var installs. An org caller only writes its own section (never copies or patches the legacy one). Don't give S1 its own file I/O again: writers go through `getRawFileSettingsForWrite()`, which refuses to overwrite an unparseable `integrations.json`.
- **Client** (`services/sentinelone/s1-client.ts`): `Authorization: ApiToken`, cursor pagination, 429 back-off, console host allowlist (`*.sentinelone.net`, `*.s1gov.net`) plus the SSRF check. A `read_only` client refuses every non-GET; writes are limited to a closed allowlist: incident status/notes (auto-resolve) and `threats/mitigate/{kill,quarantine}` (automatic mitigation). There are **no manual response-action routes**; they need their own permission, Clerk-session-only access, scope filtering and confirmation before they come back.
- **Sync**: threats incremental on `updatedAt__gte`; detection alerts only support `createdAt__gte`, so their local status can be stale. `sync_version` is recorded only after every enabled source re-synced cleanly; permanent per-doc bulk 4xx errors don't pin the checkpoint (429/5xx do); missing dates are `null`, never `''`; items that stop passing the severity/status filters are deleted. `POST /sync` returns 202 and runs in the background.
- **Auto-resolve** re-reads each candidate's live incident status from the console (`?ids=`) and only resolves what is still `unresolved`, failing closed. Never writes a verdict or mitigation, never test docs.
- **Automatic mitigation** (off by default, Response mode only, kill/quarantine of `not_mitigated` test-matched threats, live re-check first) is audited as `doc_type: response_action`. Its result must never count as SentinelOne prevention. The `f0rtika.auto_mitigated` receipt is written **before** the kill (no receipt, no kill), and every reader of `prevention_action` honours it via `services/shared/achillesMitigation.ts`: the enrichment pass (`ignoreAchillesMitigated: true`), the analytics facet and rows (`SentinelOneAnalyticsService`), and the execution report.
- **S1 prevention = its own immediate response**: `threatPreventionAction` (`sentinelone/normalize.ts`) ignores mitigation entries that started more than 15 minutes after detection (later analyst / STAR / Achilles actions).
- **Verdicts**: `f0rtika.sentinelone_*` flags count in Analytics (`reports/stageOutcome.ts`), the frontend `stageVerdict.ts`, and campaigns / notice emails via `services/outcomes/vendors.ts` `EDR_VENDORS` (the single list `edr.ts` and `verdict.ts` read). Adding an EDR means adding it to all of these.
- **Frontend** reuses the vendor-neutral `pages/analytics/components/integrations/` pieces (`vendorConfig.ts`, `IntegrationTabHeader`, `EndpointAlertDetailsDrawer`, feed, coverage). Put vendor differences in `vendorConfig`, not `vendor.id ===` branches.

### Pre-execution notices
Emails the security engineers before every `execute_test` run and holds the tests until the mail server accepts the notice for every recipient, plus a 0-5 minute lead. Off by default. User doc: `wiki/docs/user-guide/integrations/pre-execution-notices.md`.
- **The hold lives in `getNextTask`** (`tasks.service.ts`): a pending task with a `notice_id` is only handed out when its `run_notices` row is `sent`/`overridden` and `release_at <= now < pickup_deadline`. Held tasks stay `status='pending'`; agents are unchanged. Compare JS-computed ISO strings, never `datetime('now')`.
- **Backend-only.** `backend-serverless/` has no email stack and `GET /api/capabilities` reports `preExecutionNotices: false` there, which hides the Settings card, badges and banner.
- **Per org, with legacy fallback (like alerts).** Settings live at `orgs[orgId].pre_execution_notices`, falling back to the legacy top-level `pre_execution_notices` when the org has no section (so `'default'` and unknown org ids use legacy). SMTP/Slack come from the same org's `alerts` (org section, else legacy). A notice's **owning org** is the `org_id` of the tasks it gates (`run_notices.org_id`; NULL on pre-R20 rows = legacy): Run Now/batch use the request's validated `org_id`, retry the original task's, the scheduler `schedule.org_id` (one shared run notice **per org** per tick). Every send, Finished email, bounded wait, Slack alert and release reads `new IntegrationsSettingsService(notice.org_id ?? undefined)`, never a global service. Routes are org-scoped: settings via the caller's org; `GET /`, `/status`, `/:id/release` see only the caller org's notices (another org's id is a 404), no-org callers see all (legacy mode) unless `REQUIRE_ORG_ISOLATION=true` (403). The daily SMTP check runs for the legacy section and each org with its own enabled section.
- **Notice code ignores the alerts `configured` flag.** SMTP counts as usable when `smtp_host` + `from_address` are set and Slack when `webhook_url` + `enabled` are set (`services/notices/channels.ts`), because the Alerts UI never sends `configured` and `saveAlertSettings` keeps it false. The gate itself depends on `enabled` only, so a broken SMTP holds tests rather than letting them run unannounced.
- **The gate fails closed.** `getPreExecutionNoticeSettings()` reads the notice section from the *raw* JSON (it holds no secrets), so an undecryptable credential elsewhere in `integrations.json` can't null the file and read as "off"; an unparseable file falls back to the last good read per org. Don't route it back through `getFileSettings()`.
- **The run tag never reaches the hosts.** Telemetry shows the test UUID (binary names, `C:\F0\tasks` / `/opt/f0/tasks`); the notice email's "Finding this activity" section says so. Don't tell the SOC to search for `PA-RUN-…`.
- **Trap: `migrateExecuteCommandType`** in `backend/src/services/agent/database.ts` recreates the `tasks` table and runs even on fresh DBs. Any new `tasks` column must be added to its `optionalCols`, and its index to the index recreation, or the column is silently dropped.
- Code: `backend/src/services/notices/`, `backend/src/api/notices.routes.ts`. `services/notices/` must not import `tasks.service.ts` (import cycle); `tasks.service.ts` imports from `notices.repo.ts`.

### Alerting Service
Threshold-based alerting dispatched when test results cross configured score thresholds. Hooked into the result ingestion pipeline.

- **Channels**: Slack (Block Kit via webhook URL), Email (Nodemailer with SMTP)
- **Thresholds**: Score drop % (relative) and absolute score floor, configurable per metric
- **Settings**: Stored in `~/.projectachilles/integrations.json` (AES-256-GCM encrypted)
- **Backend service**: `services/alerting/` — `alerting.service.ts` (threshold evaluation), `slack.service.ts`, `email.service.ts`
- **Frontend**: `AlertsConfig` settings component, `NotificationBell` in TopBar
- **Dispatch trigger**: Called from `results.service.ts` after successful ES ingestion

### Visual Theme
A single theme: the f0 dark theme (since the f0 restyle). `useTheme` (`frontend/src/hooks/useTheme.tsx`) keeps the old provider/hook API so consumers and test mocks still work, but `theme` is always `'dark'` and there is no theme selector. CSS variables in `frontend/src/styles/index.css` drive all styling via Tailwind CSS v4 `@theme` blocks; print layouts (execution report, campaign evidence) re-point those tokens to a fixed light palette.
