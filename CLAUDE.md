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
cd backend && npm test           # 912 tests across 40 files (~12s)
cd frontend && npm test          # 127 tests across 8 files (~2s)
cd backend-serverless && npm test  # 626 tests across 25 files (~11s)

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
- **Go 1.24** — lightweight binary with enrollment, heartbeat, task execution, self-update
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
- **Tables**: `agents`, `enrollment_tokens`, `tasks`, `agent_versions`, `schedules`
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
| `/api/agent/admin/*` | Clerk | Agent management (tokens, tasks, schedules) |
| `/api/agent/*` | Agent key | Device endpoints (enroll, heartbeat, tasks) |
| `/api/tests/*` | Clerk | Build system, certificates |
| `/api/integrations/alerts/*` | Clerk | Alert thresholds, Slack/email config |

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

### Authentication
**Three-tier model:**
1. **Clerk (global)**: All routes use `<RequireAuth>` wrapper; JWT injected via `useAuthenticatedApi` hook
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

### API Proxying
Vite proxies `/api` → `http://localhost:$VITE_BACKEND_PORT` (default 3000)

## Commit Convention
```
<type>(<scope>): <description>
```
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
Scopes: `frontend`, `backend`, `backend-serverless`, `agent`, `analytics`, `browser`, `docker`, `render`, `vercel`, `fly`, `settings`, `certs`, `deps`, `ci`, `release`, `wiki`

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to main:
- `test-backend`: npm ci → build → test
- `test-frontend`: npm ci → build → test
- Node 22

## Deployment

Five deployment targets are supported. The original `backend/` and `frontend/` are used for all targets except Vercel, which uses a purpose-built serverless fork.

| Target | Backend | DB | File Storage | Builds (Go) | Guide |
|--------|---------|-----|-------------|-------------|-------|
| **Docker Compose** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Below |
| **Railway** | `backend/` | SQLite (volume) | Filesystem (volume) | Partial | `docs/deployment/RAILWAY.md` |
| **Render** | `backend/` | SQLite (persistent disk) | Filesystem (disk) | Partial | `docs/deployment/RENDER.md` |
| **Fly.io** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | `docs/deployment/FLY.md` |
| **Vercel** | `backend-serverless/` | Turso (@libsql) | Vercel Blob | No | `docs/deployment/VERCEL.md` |

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
cd backend-serverless && npm test    # 552 tests across 23 files
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

### Alerting Service
Threshold-based alerting dispatched when test results cross configured score thresholds. Hooked into the result ingestion pipeline.

- **Channels**: Slack (Block Kit via webhook URL), Email (Nodemailer with SMTP)
- **Thresholds**: Score drop % (relative) and absolute score floor, configurable per metric
- **Settings**: Stored in `~/.projectachilles/integrations.json` (AES-256-GCM encrypted)
- **Backend service**: `services/alerting/` — `alerting.service.ts` (threshold evaluation), `slack.service.ts`, `email.service.ts`
- **Frontend**: `AlertsConfig` settings component, `NotificationBell` in TopBar
- **Dispatch trigger**: Called from `results.service.ts` after successful ES ingestion

### Visual Themes
Three selectable themes: Default (light/dark), Neobrutalism (hot pink accent, bold borders), Hacker Terminal (phosphor green/amber scanlines). Theme selector in settings. CSS variables drive all theme-specific styling via Tailwind CSS v4 `@theme` blocks.

<!-- gitnexus:start -->
# GitNexus MCP

This project is indexed by GitNexus as **ProjectAchilles** (13953 symbols, 32240 relationships, 300 execution flows).

## Always Start Here

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
