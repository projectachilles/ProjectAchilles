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
cd backend && npm run build      # tsc → dist/, then type-checks scripts/ (tsconfig.scripts.json, no emit)
```

### Testing (Vitest)

```bash
# All tests
cd backend && npm test
cd frontend && npm test
cd backend-serverless && npm test

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
- **React 19** + **TypeScript** + **Vite 8** + **Tailwind CSS v4**
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
- **Go 1.26** — lightweight binary with enrollment, heartbeat, task execution, self-update
- **Platforms**: Windows (amd64), Linux (amd64), macOS (amd64 + arm64)
- Internal packages: `config`, `enrollment`, `executor`, `httpclient`, `poller`, `reporter`, `service`, `store`, `sysinfo`, `updater`
- Platform-specific files use build tags (`//go:build darwin`, etc.) for service management, sysinfo, and binary updates
- **Test leftovers** (`executor/cleanstart.go`, called from `Execute` and the poller's `executeAndReport`): around every `execute_test` run the agent empties the top level of the artifact folder (`C:\F0`, `/tmp/F0`), folders included, and the decoy folder `fortika-test` (`C:\Users\`, `/home/`, `/Users/`; the folder itself stays, the undo rule does not apply, skipped when it is a real user's home or, on Linux/macOS, group/other-writable). The before pass (20 s) runs before the run folder is created and also removes every `task-*`/`cmd-*` folder in the work dir; the after pass (60 s) runs once the result is reported or the task is failed, before the next task. Kept in the artifact folder: the agent's files (`achilles-*`, `.config-*.tmp`, `.achilles-agent-install-*`, the top-level entry holding its executable/config/log/CA cert/work dir), undo files (name contains `cleanup`, `restore`, `backup` or `state`, any case), and after a run `test_execution_log.json`/`.txt` and `bundle_results.json`. Agent paths are matched by file identity as well as by name, so a symlink, junction or other spelling of a folder still protects it. A new file the agent writes into its own folder must start with `achilles-` or be added to `isAgentFile`. **Fail closed**: with the executable or config path unknown it does no wide delete, only the test's `<uuid>[-<control>]` binaries (`.exe` on Windows, no extension on Linux/macOS). Best effort (a locked file is logged and skipped, never fails a run); every delete goes through `openTrustedDir` + `os.Root`, so a symlink or junction is removed as a link, never followed. The start-up sweep (`SweepStale`: `task-*`/`cmd-*` and UUID-named binaries older than 1 h, `cleanup.go`) is unchanged. No unit test may touch a real folder: `executor/main_test.go` (`TestMain`) points the targets at temp folders
- CGO disabled for static cross-platform binaries
- Version set via LDFLAGS: `-X main.version=$(VERSION)`
- **Service integration**: Windows (SCM via `sc.exe`), Linux (systemd), macOS (launchd plist at `/Library/LaunchDaemons/`)
- **Code signing**: Windows (Authenticode via `osslsigncode`), macOS (ad-hoc via `rcodesign`), Linux (none)

### Database (SQLite)
- **Location**: `~/.projectachilles/agents.db` (better-sqlite3, WAL mode)
- **Schema**: Created via `CREATE TABLE IF NOT EXISTS` in `backend/src/services/agent/database.ts` with incremental migrations (column additions, CHECK constraint updates)
- **Tables**: `agents`, `enrollment_tokens`, `tasks`, `agent_versions`, `schedules`, `run_notices` (pre-execution notices; `tasks.notice_id`), `campaigns`, `campaign_runs` (`tasks.campaign_run_id`), `deleted_tasks` (DELETE /tasks/:id archives the full row as JSON with `deleted_at`/`deleted_by` instead of discarding it; finished tasks only, 409 otherwise; task lists never read it, the EDR agent-kill pass does), `agent_key_digests` (HMAC-SHA256 of a bcrypt-proven agent key, keyed by and bound to the `api_key_hash` it was proven against so restarts skip bcrypt; no FK, never trusted while a rotation is pending). Any new `tasks` column must also be listed in `recreateTasksTable`'s `optionalCols`, or that recreation fails on a database that has it (`table tasks_new has no column named …`). `tasks.test_uuid` (the payload's test id, for the run-recency queries) is kept by two triggers, not by the INSERT statements; `migrateTaskTestUuid` runs last in `initializeTables` and puts the triggers and the two covering indexes back after any table recreation. `tasks.schedule_run` (`<schedule id>:<local date of the slot>`, see `scheduleRun.ts`) is written by the scheduler through `createTasks`' `scheduleRunFor` and copied by all three retry paths; the grouped task list groups by it first, then notice + test, then batch (`RUN_KEY_SQL` in `tasks.service.ts`, organization in the key). `migrateTaskScheduleRun` adds it and, in the same `BEGIN IMMEDIATE` transaction, runs `scheduleRunBackfill.ts` once (it attributes past tasks to per-machine schedules by inference; no notice, no campaign run): keep the two together (a deferred transaction loses the pass to `SQLITE_BUSY_SNAPSHOT` when another process writes), and never call the backfill on a database that already has the column, or a recurring schedule's window swallows tasks started by hand
- **Settings storage**: `~/.projectachilles/` — `analytics.json` (AES-256-GCM encrypted), `tests.json`, `console-identity.json` (console identity), `test-versions-published.json` (last published-version check; no secrets), `certs/`

#### Table Recreation Migrations (CHECK constraint changes)
SQLite has no `ALTER COLUMN`, so changing a CHECK constraint means recreating the table. All five recreations (`agents`, `agent_versions`, `tasks`, `agent_events`, `api_keys`) go through `recreateIfOutdated(database, table, values, recreate)` in `database.ts`, and a new one must too. What it does, and why:
1. **Decides from the table's definition, never with a test insert** — `definitionLacks` reads `sqlite_master` and searches the text for the values today's CHECKs name. A probe row that fails for any other reason reads as "needs migration": a foreign key did it for `tasks` on every start, and `SQLITE_BUSY` under a held write lock did it for `agents`, `agent_versions` and `api_keys`. SQLite stores comments written inside a `CREATE TABLE`'s parentheses as part of the definition, so never name one of those values in such a comment: the search would find it and read the table as up to date
2. **One transaction, write lock first** — `database.transaction(() => { … }).immediate()`, deciding again inside it: another process may have finished the job while this one waited. As separate statements, two processes starting together interleaved and lost the `tasks` table, and a failure after the DROP lost every row
3. **FK checks off around it, back on in a `finally`** — `database.pragma('foreign_keys = OFF')`, never `database.exec('PRAGMA ...')`, and outside the transaction (SQLite ignores the pragma inside one). With FKs on, SQLite refuses to `DROP TABLE` a parent that other tables reference (`agents`: `SQLITE_CONSTRAINT_FOREIGNKEY`), and a child's rows whose parent is gone (`tasks` of a deleted agent) fail the copy
4. **The recreate function** (`recreateAgentsTable`, `recreateAgentVersionsTable`, `recreateTasksTable`, `recreateAgentEventsTable`, `recreateApiKeysTable`) runs inside that transaction: DROP IF EXISTS `<table>_new`, CREATE it with today's definition, INSERT SELECT by column name, DROP old, RENAME, recreate indexes. **It keeps only the columns it lists**: a column added later by `ALTER TABLE` must go in its `optionalCols` (`agents`, `agent_versions`, `tasks`) or its CREATE (`agent_events`, `api_keys`), or the recreation fails on a database that has the column (`table agents_new has no column named …`). The `agents` and `agent_versions` lists had fallen behind, so an install old enough to need those recreations could not start. `checkRecreations.test.ts` and `tasksRecreation.test.ts` rebuild each table with today's columns and an old CHECK, and fail when a column is missing
5. **A `<table>_new` beside an up-to-date table is never dropped**; start-up warns about it (it can be the only copy of the rows after an interrupted upgrade of an earlier release). Beside an out-of-date table it is still dropped at the start of the recreation, as every release has done
6. **`agents` is backed up first** (`backUpDatabase`), to `agents.db.bak` beside the database, with the database file's permissions (it holds the same key hashes). The copy is made inside the lock, after the second look, so only the process that recreates makes one and it is of the database as it was. `VACUUM INTO` cannot run inside a transaction, so a second read-only connection runs it. A copy that cannot be made is a warning, never a failed start

Two more start-up rules in the same file. Every `ALTER TABLE … ADD COLUMN` goes through `addColumn()`, which accepts `duplicate column name` (another process that started at the same time added it first); the one exception is `schedule_run` in `migrateTaskScheduleRun`, added inside its own locked transaction after a second look. A test in `checkRecreations.test.ts` adds every column from a second connection first and fails on a raw `ALTER`. `getDatabase()` keeps a handle only after `initializeTables` has returned: a failed set-up closes the connection, calls in the next 5 seconds get the same error without trying again (`SETUP_RETRY_MS`), and the first call after that sets the database up again, so a process never serves on a half-migrated database. In single-process mode and in the cluster primary the first call is `processSchedules()` at start with no try/catch, so a failed set-up ends the process; only cluster workers reach the retry.

### API Routes
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/browser/*` | Clerk | Security test browser |
| `/api/analytics/*` | Clerk | Elasticsearch analytics |
| `/api/analytics/defender/*` | Clerk | Defender Secure Score, alerts, controls, cross-correlation |
| `/api/integrations/defender/*` | Clerk | Defender credentials, sync trigger |
| `/api/analytics/sentinelone/*` | Clerk | SentinelOne alerts, correlation, posture (policies, agent health, exclusion gaps); backend-only |
| `/api/integrations/sentinelone/*` | Clerk | SentinelOne settings, background sync, auto-resolve / automatic mitigation; backend-only |
| `/api/analytics/sophos/*` | Clerk | Sophos alerts, SIEM events, XDR detections, correlation, Health Check posture (endpoint health, policies, exclusion gaps); backend-only |
| `/api/integrations/sophos/*` | Clerk | Sophos settings, background sync, auto-resolve (acknowledge / TRUE_POSITIVE_BENIGN); backend-only |
| `/api/agent/admin/*` | Clerk | Agent management (tokens, tasks, schedules) |
| `/api/agent/*` | Agent key | Device endpoints (enroll, heartbeat, tasks) |
| `/api/campaigns/*` | Clerk | Saved test campaigns (tests x agents), one-click runs, evidence matrix, CSV export; backend-only |
| `/api/tests/*` | Clerk | Build system, certificates |
| `/api/integrations/alerts/*` | Clerk | Alert thresholds, Slack/email config |
| `/api/notices/*` | Clerk | Pre-execution notice settings, status, release |
| `/api/reports/*` | Clerk | Report payloads: SB-PC-2026-001 JSON export, print-ready execution report (`/executions`) |
| `/api/settings/identity` | Clerk (writes: signed-in session only) | Console identity (code, name, colour): read by all users, edited by admins |

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

The same holds for CLI tokens, which are bearer credentials too.
`requireUserSession()` (`middleware/userSession.middleware.ts`) refuses every
principal that is not a Clerk browser session: all of `/api/api-keys/*`, every
non-GET on `/api/users/*`, and `POST /api/cli/auth/verify` (a CLI token can't
approve another device code). An admin's CLI session can still list users and
invitations; the CLI has no commands or chat tools for the writes.

A CLI token is bound to its deployment: `aud` is `AGENT_SERVER_URL`, set at
signing and checked at verification by the same `cliTokenAudience()`
(`middleware/cliAuth.middleware.ts`). Two deployments that share a
`CLI_AUTH_SECRET` don't accept each other's tokens. Changing
`AGENT_SERVER_URL` invalidates outstanding access tokens (1 h); the CLI gets a
new one on its next refresh.

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

**Executions table grouping**: The frontend Executions table groups bundle controls under collapsible parent rows. The parent row shows the bundle name, a `X/Y Protected` summary badge, and an item count badge. The badge shows "X controls" for cyber-hygiene bundles and "X stages" for other categories (e.g., intel-driven). Expanding reveals individual sub-rows with per-control/per-stage results. Bundle controls with explicit `skipped: true` and exit code 0 render as "Not assessed" for cyber-hygiene and "Skipped" otherwise; legacy non-cyber-hygiene stages with exit code 0 also render as "Skipped". They are excluded from the Protected/Unprotected count. An unmarked cyber-hygiene exit 0 remains inconclusive. Standalone (non-bundle) tests render as flat rows unchanged.

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

These env vars are set automatically in `buildService.ts` when a `build_all.sh` is detected and the target platform is Windows. Password files (this one and the one for `osslsigncode -readpass`) are written by `writePrivateTempFile()` (`services/tests/privateTempFile.ts`): mode `0o600`, in a `0700` directory of their own under the system temp directory, removed in a `finally` block. Never write one into `~/.projectachilles/builds/<uuid>/`: the agent download route serves from that folder.

**Build folder access:** an agent downloads from `builds/<uuid>/` only the names the build record lists (`servableBinaryNames()` in `services/agent/testArtifacts.ts`; `backend-serverless/` has its own copy in `binary.service.ts`). `getBuildDir()` returns null for an id that is not one folder name, and `test_uuid` / `binary_name` are validated in the task, schedule and campaign schemas (`TestUuidSchema`, `BinaryNameSchema`). A new file kept in a build folder needs no rule of its own; a new kind of downloadable artifact must be listed in the build record.

**Build environment:** build subprocesses (`go build`, `go mod`, `build_all.sh`) get an allowlisted environment from `buildSubprocessEnv()` (`services/tests/buildEnv.ts`), never `process.env`, so test-library code can't read the backend's secrets from it. Add a name to the allowlist (or to `BUILD_ENV_PASSTHROUGH` on one install) when a build needs it. It is not a sandbox: scripts still run as the backend user. A bubblewrap sandbox was tried and rejected (#799): bwrap can't create namespaces under Docker's default seccomp profile, and the library's scripts need the network (`go mod download`) and the signing cert.

### Defense Score basis
Analytics endpoints take `basis=latest|executions` (default `executions`; invalid -> 400 `Invalid basis`). A scored result is a conclusive code (101/105/126/127) or `EDR_PREVENTED_ERROR_STAGE` (`reports/stageOutcome.ts`: an error-coded stage whose own EDR alert carried a confirmed action; combined side, not strict); `buildConclusiveResultsFilter` applies it everywhere (score, posture, outcome breakdown, error rate, activity) and chain depth stops a chain there. `backend-serverless/` keeps the exit-code gate. `latest` scores test x endpoint **pairs**: key = org + test UUID + hostname, most recent conclusive result in the window (window capped 365d). In `any-stage` mode a non-cyber-hygiene bundle on a host is one pair (protected if any stage of its latest run is). The exception is `technique-distribution`, which always uses per-stage pairs (`scoringMode: 'all-stages'`), so a technique is never marked protected because a sibling stage was. Per-doc views judge a doc by its OWN evidence (`edrOwnDetectedClause` / `hasOwnEdrDetection` in `outcomes/vendors.ts`): on a bundle control the wide `<vendor>_detected` only means an alert named the bundle, so a stage needs `<vendor>_stage_detected`. Chain-level verdicts (any-stage bundle pairs, outcome breakdown, chain depth's end-to-end) keep `edrDetectedTerms()`. Pure rules live in `services/analytics/posture.ts`, kept byte-identical in `backend/` and `backend-serverless/`. Trend under `latest` ignores `windowDays`; its last point equals the tile; empty windows are `null`, not 0. Trend-point `realScore`/`realTotal`/`realProtected` stay the pre-risk-acceptance series (only when exclusions exist), unlike `/defense-score`'s strict blocked-only `realScore`. `threat-actor-coverage` also accepts `basis=latest` (adds `pairCount`, `lastTestedAt`). `technique-outcomes` is latest-basis and per-stage like `technique-distribution` (ignores `basis`). `outcome-breakdown` is latest-basis too (protected/prevented/detected/silent split of the latest pairs, attack tests only, ignores `basis` and the outcome filters; `/executions/paginated` takes a matching `verdict`). `chain-depth` is latest-basis (each chain's latest run per host; a blocked chain counts at its lowest-numbered blocked `Stage N`, so chains that keep running after a block, like LockBit, bucket correctly). `stage-coverage` (Stage coverage card, backend-only, `stageCoverage` capability) is latest-basis over the chain-depth chains (shared `settledChains`): per chain's latest run it counts own-evidence stages blocked / detected / through, and sorts chains into single stage, depth not tested (one caught + stages Skipped or errored after the block), layered, none caught; stageless runs are left out; it never changes the score and ignores `basis`/`scoringMode`. `score-movement` (the Dashboard's What moved the score card, backend-only, `scoreMovement` capability, `GET /api/analytics/score-movement`) is latest-basis and always any-stage: it sorts every failure in the range into fixed / still failing / not re-tested / left untested and the first run of every new attack test into stopped / got through, with the lists behind each count. Its unit is one test on one endpoint (the chain and plain pair keys are merged, as the coverage matrix does), so it can differ from the score, and the response says by how much (`scoreDifference`): `failing.end = stillFailing + notRetested + fixedButCounted + countedTwice`, the reconciliation equation the tests pin. It never changes the score, ignores `basis`/`scoringMode`/the outcome filters, and the card loads on its own request. `getScoreMovement` reads every result in the range (per-document pairs: each UTC day's first and last, through the `firstOfDay` fetch option, which this method alone uses and no snapshot shape sets) plus the latest result per pair of the 365 days before it, and caches the answer for 30 s (`scoreMovementCache`, keyed by `scope.keyBase`). `coverage-matrix` (the latest result per test and host for All Executions, backend-only, `coverageMatrix` capability) is latest-basis and always any-stage: `getCoverageMatrix` reads the `matrix` snapshot shape (every run of each pair, names, and the runs a risk acceptance hides) plus the pairs with no conclusive result (fetched with and, only when an acceptance exists, without the exclusion), and the pure `coverageMatrix.ts` pivots them. A pair is `risk_accepted` only when the exclusion leaves nothing of it; otherwise it is judged by what remains. Its cells are `latestPairsAsOf` + `classifyPairOutcome` (prevented is drawn as protected), never a rule of its own; a cyber-hygiene bundle is one row with a compliant/evaluated ratio per host, and a chain pair plus a stageless plain pair of the same test on one host are one cell (the latest conclusive). It ignores `basis`, `scoringMode` and the outcome filters; limits are in `coverageMatrix.ts` (150 hosts with cells, above which `rows=tests` sends neither cells nor hosts; 500 rows). Its host filter is `state`, not `verdict`: the page forwards the executions list's `verdict` chip with every request, and the matrix must ignore it. Every view is cut from the whole model, so `rows=hosts&test=` keeps the matrix's host order and counts. `/executions/paginated` takes an exact `testUuid` (test or bundle id) for a pair's runs. The view is `pages/analytics/components/ExecutionsView.tsx` (Matrix | List; list alone without the capability; a Rows switch turns the matrix to `HostRows`, one row per host from `rows=hosts`; `ExecutionsToolbar` with Export and Archive by date is drawn by the list in its header and by `ExecutionsView` above the matrix) with `components/matrix/` (`matrixGrid.tsx` holds what both orientations share: the Tab stop and arrow keys, the hint line, the column names, the legend): `matrixModel.ts` holds the drawing rules only (form by width per host, glyph and word per state) and never works out a state; `CoverageMatrix` makes one request per scope, `HostRows` and `PairRuns` one per page shown (a reload reads every shown page again), `SegmentHosts` one per opened segment page; each drops an answer that arrives after it was closed or replaced: the effect's cleanup bumps the request id **unconditionally**, so a "Show more" in flight is voided too, or a late answer opens a run of the wrong pair. A cell's `i` is an index into the tests (or hosts) of **its own response**: `HostRows` keys cells by test on receipt, because the server's test order can differ between two pages. Archive by date sends the date alone (no filters); the toolbar's dialog says so. The page loads the list's runs only while `ExecutionsView` reports the list (`onViewChange`). The matrix is one Tab stop (roving `tabIndex` set on the elements, not through state, so thousands of marks do not re-render), and `settleForm` holds the form across width changes a scrollbar could make. The run detail's state is shared with the list through `executions/useRunDetail.ts` and `executions/RunDetailDialogs.tsx`: change a detail behaviour there, never in one view. `forceList` (an `expanded=` link or the Outcome chip) shows the list; `setView('matrix')` deletes `expanded=` in the same address update, because two `setSearchParams` calls in one tick each start from the same address. **Activity strip** (above both views, backend-only, `activityStrip` capability): `GET /api/analytics/executions/activity` (`getExecutionsActivity`) counts runs per bucket over the filter bar's window, by the cadence card's rules: `activityCountedFilter`, `activityRules` and `activityRunVerdict` are shared with `getExecutionActivity`, whose own request (a `per_day` date_histogram, pinned by a snapshot) must not change. Bucket bounds come from `activityBuckets.ts` once, in the caller's `tz`, and are used for both searches (a `date_range` over standalone results, `bucketIndexOf` over bundle runs): never let Elasticsearch bucket one half. A bucket is the time the zone's clock shows one hour, day or week (48 h / 62 d thresholds, 365 d cap), found by where the clock changes, so a clock-change day is 23 or 25 hours. Buckets are **whole and never clipped to the window**: the filter bar sends presets as `from=now-30d`, the window moves with every request, and a bucket is identified by its two instants (`bucketFrom`, `bucketTo` in the address, `useActivityBucket`); each is counted whole so a bar equals what its click lists. `to` is inclusive (next start minus 1 ms) because `buildDateFilter` is `lte`. It ignores the outcome filters, like the matrix. The page (`AnalyticsDashboardPage`) gives the strip `stripParams` (the whole window) and gives the matrix, the list and the export the bucket's instants in place of the window's; the bucket is dropped on leaving the tab and when the date range changes, and that drop is `useAnalyticsFilters`' own (`rangeBoundParams`, in the address update that writes the range). The bucket is applied only with the capability (a link opened on a server without the strip would narrow the page with nothing to show or clear it). The list's page goes back to 1 while rendering, from the bucket itself (`pageBucketKey`), not in the click handler: a reset one render ahead of the address asked for the window's first page, and the list then wrote `expanded=` over the bucket. Selecting a bucket closes the open pair but keeps `expanded=` (dropping it would un-force the list). **Every write to the Analytics page's address goes through one writer** (`hooks/useAddressWriter.tsx`; `AddressWriterProvider` wraps the page; the tab, `expanded`, the filter sync, `useMatrixUrlState`, `useActivityBucket`): React Router's `setSearchParams(fn)` hands `fn` the address of the last render, so two writes before a redraw erased each other (a bar click lost to the list writing its selected run; a new date range lost to the bucket's drop). The writer starts each write from the last address it asked for that is not drawn yet (`stillPending`: same location key = still waiting; a drawn address it asked for = caught up to it; any other = someone else navigated, forget it all), skips a write that changes nothing, forgets a write the router refuses (one made at mount), and is stable. A page test checks that the page hands out one writer. The filter sync re-runs on every address change as well as on a filter change (`searchParams` in its deps), so an in-page link or the back button cannot leave the address describing filters the page is not showing: keep it. Never add a `setSearchParams` writer on that page; write from effects or handlers, not layout effects. Other pages (Dashboard's `useSharedTimeRange`, Tasks, Tests, Test detail) still use `setSearchParams`. The strip counts test runs only: the narrowed list can also show upload confirmations and all-Skipped runs. `components/shared/activity/` (`ActivityStrip`, `activityModel.ts`) knows no outcome and counts nothing: pages hand it toned segments. **The Tasks page has the same strip** (`components/endpoints/tasks/TaskActivity.tsx`, `GET /agent/admin/tasks/activity` in `services/agent/taskActivity.service.ts`): 30 days by `created_at`, per local day, counted by `taskBucket` (`services/outcomes/taskOutcome.ts`), the backend twin of the frontend's `taskBucket` (`utils/testOutcome.ts`, the run timeline's marks): both read `services/outcomes/__tests__/fixtures/taskBucketGolden.json`, change both. The grouped list takes `from`/`to` (`created_from`/`created_to`), and the list and the strip share `taskListConditions` (organization, search, creation time) so a bar and its day read the same tasks, except that `search` narrows the strip by task and the list by run (a host-name search lists the run's other hosts too: documented, the list's search is older than the strip); a run spanning two days lists only that day's tasks and is dated by them (`created_at` = in-day `latest_created`, the list draws day headings from it). With a creation range, the organization condition is `+t.org_id` so `idx_tasks_created` serves the query (a plain one let `idx_tasks_org` read every task the organization ever had). The strip reads results through `bucketResultSql` (exit code, edr flag, category, and control id/exit/skipped, no cyber-hygiene controls), held to the golden table; never back to the whole result. `created_at` is `datetime('now')` (UTC, whole seconds): bounds are compared in that form (`sqliteSecond`), parsed with `parseSqliteUtc`. Index `idx_tasks_created` (also in `recreateTasksTable`). Not cached (the page re-reads it after its own actions); read once a minute, never with the 10 s poll. The selected day is page state, not in the address. A bar's button is the whole slot, the coloured column only its lower part. Stay on executions: by-test/technique/severity/category/org, the PDF report and timeline cards. The Defense Score **alert** is latest-basis, any-stage, fixed `now-30d` (`getLatestScoreSummary`, the 'breakdown' snapshot; a null score skips the check). Docs: `wiki/docs/api-reference/analytics.md`.

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
  - Those runs check out only the base branch and read the PR through the API (`gh pr diff`). No PR file is on disk, and no PR code runs.
  - The label is removed after the run, so re-label after each new push.
  - Those runs set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, which runs Claude's Bash in a sandbox that needs **bubblewrap and socat** on the runner (without either, every Bash call fails with "Sandbox dependencies not available" and the review can't read the PR). It strips `CLAUDE_CODE_OAUTH_TOKEN` from Claude's subprocesses but deliberately keeps `GITHUB_TOKEN`, so `gh` still posts; the job's `permissions:` is what limits that token.
- **A green Claude job doesn't mean it reviewed.** The security review must leave a comment from *this run* for *this commit*: posted by `claude[bot]` or `github-actions[bot]` after the run started, starting with `<!-- claude-security-review sha=<head sha> -->`. "Verify the review posted" fails the job otherwise (`.github/scripts/claude-review-evidence.py receipt`); a comment from an earlier run or push doesn't count, so a clean re-review posts a one-line "Re-checked" comment. The step also reads the PR's live head last and fails when it is no longer `HEAD_SHA` (a push during the review: the new commits were not reviewed, re-label), or when that lookup fails. Its prompt asks for an HTML `<h2>` heading and plain `gh` commands, because Claude Code's Bash check refuses a quoted `--body` with a newline followed by `#` (a Markdown heading), `$VAR`s and redirection, and nobody can approve that in CI. The code review (plugin) posts nothing on PRs it judges trivial and reviews a PR only once, by design; a later push shows a "Review skipped" warning. An attempt that posts nothing with no denied tool call is `silent` (`claude-review-outcome.sh`) and shows a "Not reviewed" warning, never a clean pass. The plugin also stops when "Claude has already commented on this PR", and the security review posts as the same `claude[bot]`, usually first: the review's system prompt says that comment is not a code review. Without that, a retry (which always starts after the security comment) stopped silently and ended green (#873, #875).
  - Both jobs get the PR diff as a file, `claude-review-input/pr.diff`, written by a trusted step (`claude-review-evidence.py prepare`) for the Read and Grep tools: piped `gh pr diff | grep` commands are refused and cost turns. The file is text only; if it can't be written, the reviewer falls back to `gh pr diff`.
  - **A PR that edits a review workflow is not reviewed.** claude-code-action skips it (the workflow must match the default branch) and the job stays green with a "Not reviewed" warning. A change to these workflows is only proven on the next ordinary PR after it merges.
  - Never check out the PR head in these jobs (Semgrep's `pull-request-target-code-checkout` rule enforces it), and never add steps that run PR code. The `Review scripts` workflow runs the helper's unit tests and guards on both workflows (`.github/scripts/tests/`).
- **Vercel previews of fork PRs** need a team member to click "Authorization required to deploy" in the PR checks. Keep Git Fork Protection on: it guards the projects' environment variables.

## Deployment

Six deployment targets are supported. The original `backend/` and `frontend/` are used for all targets except Vercel, which uses a purpose-built serverless fork.

| Target | Backend | DB | File Storage | Builds (Go) | Guide |
|--------|---------|-----|-------------|-------------|-------|
| **Docker Compose** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Below |
| **Public server (VPS/droplet)** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | `docs/deployment/SELF_HOSTED_SERVER.md` |
| **On-prem server** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | `docs/deployment/ON_PREM_SERVER.md` |
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
cd backend-serverless && npm test
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
- **`tasks.campaign_run_id`**: any new `tasks` column must also go in `recreateTasksTable`'s `optionalCols` (and its index in the index recreation), or that recreation fails on a database that has it. `campaign_run_id` is there.
- **Shared `resolveTestArtifact`** (`services/agent/testArtifacts.js`): preflight and `createTasks` must both resolve binaries through it so a dry run can never disagree with the real dispatch. Preflight calls it with `hash: false`.
- **Launch is one transaction** (run row + all tasks + notice) whether or not pre-execution notices are on. Partial runs (skipped pairs) throw `PartialRunError` (409 with `skipped`) until `confirm_partial: true`. Limits: 100 tests, 5,000 tasks per run.
- **Org**: the run always uses the campaign's org; a mismatched `org_id` is 403; agents are re-checked against the caller's org at launch (400). `REQUIRE_ORG_ISOLATION` makes no-org callers 403 on every route.
- **Console identity** (`/api/settings/identity`, Settings → General) is backend-only too: `backend-serverless/` reports `consoleIdentity: false`; the frontend hides the General tab and `ConsoleIdentityProvider` skips the fetch.
- **Backend-only**: `backend-serverless/` reports `campaigns: false` in `/api/capabilities` and mounts nothing; the frontend hides the nav entry and routes on that flag.
- **Cell verdicts match Analytics** (`services/outcomes/verdict.ts`, shared with the notice Finished email): Protected > Prevented > Detected > Unprotected > Error, per-stage via `reports/stageOutcome.ts` `classifyStage`. EDR flags come from ES by exact `_id` (`<task_id>` or `<task_id>::<control_id>`, `outcomes/edr.ts`); ES down → exit codes only, `edr.status: 'unavailable'`. `percent_protected` counts prevented + detected as protected (Defense Score basis). If you change the Analytics label rule, change this too. The matrix is async (one ES query per run, chunked by 1,000 ids).
- **Print**: no named `@page` (it adds a blank portrait page after the app shell); `CampaignRunPage` injects `@page { size: landscape }` while mounted, like the Analytics report.

### Test versions
Which version of each test the console has, whether a newer one is published, and which version produced each result. Backend: `services/browser/versionIdentity.ts` (fingerprint), `testVersions.service.ts` (synced and published versions, the check), `testVersionStatus.ts` (`deriveStatus`, `resultVersionState`, `resultStateForTest`), `currentFingerprints.ts`; the build stamp in `services/tests/buildService.ts`; `taskTestVersion` (`services/agent/testArtifacts.ts`) and `validTestVersion` (`services/agent/testVersionPayload.ts`); `services/analytics/testVersionState.ts` (Executions labels and filter). Routes: `GET /api/browser/tests/versions`, `POST /api/browser/tests/updates/check` (`tests:sync:execute`). Frontend: `components/browser/VersionStatusChip.tsx`, `components/browser/detail/VersionCard.tsx`, `pages/tests/components/VersionBanner.tsx`, `hooks/useTestVersions.ts`, `pages/analytics/components/executions/versionLabels.ts` + `ResultVersion.tsx`, `pages/campaigns/testVersionSummary.ts`, `pages/analytics/report/lib/runs.ts` (`runVersionLine`). User doc: `wiki/docs/user-guide/test-browser/test-versions.md`.
- **Fingerprint inputs are fixed in `versionIdentity.ts`**: `BUILD_INPUT_EXCLUDED_EXT` (`.md .html .kql .yar .yara .ndjson`) and `BUILD_INPUT_EXCLUDED_NAME` (the library's detection and defense files by whole base name: a lowercase UUID, `_`, then `sigma_rules.yml`, `dr_rules.yaml`, `hardening.ps1` or `hardening_<word>.ps1` / `.sh`; anchored on the UUID because `apply_hardening.ps1` or `custom_sigma_rules.yml` is a real script or config, and by name because `.ps1`, `.sh` and `.yml` are real build inputs in other tests: embedded scripts, `build_all.sh`, a test's own config), both applied by `isBuildInput()`, `sharedInputPrefixes` (`preludeorg-libraries/`, the category's `shared/`, `utils/resolve_org.sh`, `utils/codesign/`), the disk exclusions and the hash line format. The hash line format changes every fingerprint; an excluded extension, name or disk exclusion changes those of the tests that have such a file; a shared prefix those of the git tests whose shared files it adds or removes; a build or result made at the commit synced now is unaffected when the change only leaves more files out (`sameSource`, below), and once a Sync moves the library each changed fingerprint makes that test's earlier builds read Rebuild needed and its earlier results `older` once, changed files or not (fingerprints of two rules can't be compared; to avoid that, record the rule on stamps and results in the same change). Bump `FINGERPRINT_RULE_VERSION` (next to the lists) with any change to them or to the hash format: `test-versions-published.json` records it, and a stored state without it or with another number is no published result (else every test would read "Update available" until the next check). Git tests hash the HEAD tree plus the shared prefixes; custom tests and git-off installs hash their folder only, no shared inputs (every embed dependency left out: uploaded ones are covered by `deps_hash`, build-made ones by `outputs_hash`, which is compared for folder tests only). A `test_tree` change with the same fingerprint is `documentation_changed`: an update, never a rebuild. A file with one of the excluded names that a test embeds is tracked through `deps_hash` (or, for a folder test whose `build_all.sh` makes it, `outputs_hash`) only when it, or a folder containing it, is named as the first token of its `//go:embed` line: `getEmbedDependencies` parses only that token, so one embedded through a glob (`//go:embed *.ps1`) or as a later token is covered by nothing. That is a known gap. `getEmbedDependencies` lists a `.ps1` only when the fingerprint leaves it out. A local edit to such a committed file does not count as `modified_source` either (`current()` keeps only changed paths that pass `isBuildInput`), the same as for an embedded `.md` or `.kql`.
- **The published check fetches, never pulls, resets or cleans** (`check()`). 2 min after start (plus up to 60 s jitter on cluster workers), then every 6 h (a tick is skipped when any process finished a check in the last 10 min), after `POST /tests/refresh` (`afterSync`) and on Check now. A Sync records the ref its own pull fetched (`recordPublishedFromLocal`, no network call). `TESTS_UPDATE_CHECK=off` stops the timer and the after-refresh check only. The result is shared between processes in `~/.projectachilles/test-versions-published.json` (no secrets). `checkError` is a fixed category (`checkErrorCategory`, or `The test library could not be read`), never git's text: the versions route is readable by every library reader. The timer runs in every process that serves HTTP (`startServer()`); the cluster primary never starts the server.
- **A build that embeds a file the fingerprint leaves out is not vouched for.** `embeddedFilesLeftOut()` (`services/tests/embeddedFiles.ts`) reads every pattern of every `//go:embed` line (all tokens, globs, folders, sub-packages) and returns the embedded files `isBuildInput()` rejects; the build stamps them as `embeds_left_out` (files in a folder `build_all.sh` fills count too: the source-built guess also matches committed folders, so an exemption would fail open). `embedsLeftOutFiles()` (`testVersionStatus.ts`) is the one check, used in three places: `deriveStatus` (Unknown build, reason `embeds_excluded_file`), `taskTestVersion` (no fingerprint on the task, so results read `unknown`) and the version list's `built` ref. Without it, a change to such a file changes the binary but not the fingerprint, and old results read `current`. Any new reader of a stamp's fingerprint must apply the same check. Not covered: a stamp written before this field existed, and uploaded embed dependencies (outside git, tracked only by `deps_hash` for the rebuild status).
- **Compiled output on disk is recognised by a full header, not two bytes** (`hasBinaryMagic`, custom tests only): ELF and Mach-O by magic, Windows by `MZ` plus `PE\0\0` at the offset stored at 0x3C. `MZ` alone are two letters a script can start with (`MZ=1`), and a file left out of the fingerprint can change unseen.
- **A published tree is repository content, so reading it is bounded.** `listTree()` stops git past `MAX_TREE_LISTING_BYTES` (64 MB of `ls-tree` output) and `identitiesFromTree()` stops past `MAX_IDENTITY_WORK`; both throw `TreeTooLargeError`, which a check records as `The test repository is too large to check for updates`. `identitiesFromTree()` groups files by test folder in one pass and hashes each category's shared inputs once: never go back to a scan of all files per test (5,000 tests took 19 s, on the thread that serves every request). The rewrite kept every fingerprint (a test pins values captured from the old code).
- **A stamp is written only when it can be trusted** (`stampVersion`): the identity is read before the compile and again after, and there is no stamp (status Unknown build) when the commit or fingerprint changed in between, an uploaded dependency present before the build is gone, an artifact can't be hashed, or the build no longer owns its marker. `modified` (build inputs differ from HEAD) is Unknown build too. Never Up to date or current on a guess: `deriveStatus` returns `up_to_date` only when every comparison was made. A library that can't be read at all (`currentFingerprintMap()` undefined) leaves recorded versions without a state; a test whose synced identity can't be read (git can't read HEAD, which drops the git tests from the map; a folder test whose files can't be read, left out of `synced()` with one warning) is `unknown`.
- **The first write over the artifact voids the old record** (`voidPreviousStamp`): `build-meta.json` loses `version` and gets `builtAt` now and `source: 'built'`, also over an uploaded or unstamped binary, so tasks created during the build carry no stale version. A failed `go build` puts the old meta back only while it owns the marker and the artifact's SHA-256 still equals the stamped one (unstamped: the hash taken just before the void).
- **`.building` marker** (`BUILDS_DIR/<uuid>/.building`, owned by a random token): held by builds, dependency uploads, binary uploads and build deletes (`withTestFolderLock`), so they exclude each other on every worker: `409 Build in progress for this test`. A stale marker is taken over, and the build that lost it stops with `409 Build was superseded by another build of this test`.
- **A task carries a fingerprint only when the binary being sent has the SHA-256 the stamp recorded** (and `modified` is false); otherwise only `built_at` and `build_source` (`taskTestVersion`). It lives in the task payload (`payload.test_version`), not a column; the campaign matrix reads it with `json_extract`.
- **Result documents** get `f0rtika.test_version` from `testVersionField()` (`results.service.ts`) on all three ingestion paths (standard, EDR-terminated, bundle fan-out), validated by `validTestVersion` with dates rewritten in UTC (Elasticsearch rejects a whole document whose date doesn't parse). Existing indices get the field through `addMissingResultsMappings` (the missing properties) / `ensureResultsFieldMappings` (the named fields), never a putMapping of the full mapping.
- **One rule for a result's state**: `resultStateForTest` with `currentFingerprintMap()`, used by Executions (`testVersionState.ts`: `documentVersion` and the matching `versionStateClauses`), the campaign matrix (`cellVersion` in `campaigns/matrix.ts`) and the report (`runVersion` in `reports/reportParsers.ts`). The map holds each test's fingerprint and library commit (`CurrentTestVersion`). `sameSource` (`testVersionStatus.ts`) decides both this and `deriveStatus`'s Rebuild needed: equal fingerprints, or the same non-null library commit (one commit is one set of files, so two fingerprints of one commit differ only when the fingerprint rule changed; seen live when #850 changed it); a result needs a fingerprint either way (`taskTestVersion` writes a fingerprint and a commit together or neither, so a commit is never compared on its own). The commit rule leans on the `modified` check made at build time under that time's rule: sound for a rule change that only leaves more files out (#850's), not for one that starts counting a file, which must not accept the commit for older stamps. `versionStateClauses` writes the commit rule as one clause per commit, limited to the tests synced at it. No version is `not_recorded`; a test missing from the current map is `unknown`, never `older`. `currentFingerprintMap()` owns the bound: callers that come while a read runs share it, each waits at most `VERSION_READ_BUDGET_MS` (5 s; the report passes the time left to its deadline) and gets undefined on timeout (logged once per read), and a late read still serves the callers still waiting. It never rejects. The campaign matrix starts it together with its Elasticsearch read; the totals and run-list paths never read it.
- **Evidence documents show the state as of generation**: the campaign page line ("as of" its `as_of`, or "could not be compared" when recorded versions came back without a state), its CSV (`version`, `version_state` appended last) and the report. The report's version line (`runVersionLine`) is the commit with its state label for every state, the commit alone when there is no state, the state alone without a commit, and `version unknown` with neither. Its Method paragraph (`runVersionsBasis`) explains the states with the generation time when a run has a state other than `not_recorded`, says the versions could not be compared when runs have commits (or neither commit nor state) but no such state, explains `not recorded` when every run is, and is absent for a server without versions. The commit is the lasting fact.
- **Building several tests in one run is frontend-only** (`lib/buildQueue.ts` `runBuildQueue`, `hooks/useBuildQueue.tsx`, the Tests page's **Build N**): the browser tab runs the queue, one **Build & Sign** at a time, and the server keeps no record of the run. `BuildQueueProvider` sits above the router and the `ErrorBoundary` in `App.tsx` so a page change or a page error doesn't end a run; keep it there. It never rebuilds a `source: 'uploaded'` binary, polls every 5 s (`QUEUE_BUILD_POLL_MS`; a run shares the user's 1,000 requests per 15 min), and with `CLUSTER_WORKERS` >= 2 its builds can overlap, because build job status lives in one worker's memory. User doc: `wiki/docs/user-guide/test-browser/building-signing.md`.
- **Backend-only**: `backend-serverless/` reports `testVersions: false` in `/api/capabilities`; the frontend then makes no versions request and shows no version.

### About dialog & release check
`GET /api/about` (any signed-in user, backend-only, capability `about`) feeds the sidebar's About dialog. User doc: `wiki/docs/user-guide/console/about.md`.
- **`backend/src/data/releaseInfo.ts` is generated** from `docs/CHANGELOG.md` (`node scripts/generate-release-info.mjs`; the image is built from `backend/` alone, so the changelog isn't in it). Run it in every release PR after the changelog is written: a backend test fails when the file is stale or its version differs from `package.json`. `[Unreleased]` entries don't affect it.
- **"Official release" needs evidence**, never the version string (it stays the same on every commit until the next release PR): `GIT_TAG === v<version>`, or GitHub's compare saying the commit is the tag. `resolveReleaseStatus()` in `lib/buildInfo.ts` is the one place that decides.
- **`GIT_TAG` is a run-time variable**, set by `scripts/deploy-server.sh` from the checkout on every run and passed under `environment:` in `docker-compose.server.yml`. Don't make it a build arg: the script reuses images built earlier from the same commit (the appliance's included), so a baked value would be stale or missing.
- **The release check never runs on a request path** (`services/about/releaseCheck.ts`): one minute after start, then daily, result in memory. Two anonymous GETs to a fixed host and repository, with `Accept` and `User-Agent` only. Never add a token (not `GITHUB_TOKEN`) or anything that identifies the install. `RELEASE_CHECK=off` disables it.
- **Release notes from GitHub are untrusted markdown** (`ReleaseNotes.tsx`): no raw HTML, images dropped, links in a new tab. Agent release pages start with install commands; only the part after the `---` line is shown.
- "Agent update available" compares the official agent with what the install has **registered**, in the frontend; the endpoint has no fleet data.

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
- **Docker / server installs build from the host checkout** (`./agent` mounted at `/agent-src`): `git pull` BEFORE Build from source, or old code ships under the new version (happened with 0.7.3 on one install). The repo's `.git` is mounted at `AGENT_SOURCE_GIT_DIR` so notes record `at <commit>`, plus `(source says <v>)` on a version mismatch (`services/agent/sourceInfo.ts`). The server only serves an update when the version differs, so a corrected same-version rebuild never reaches agents that took the stale one.
- **`release_notes` holds two things**: what an operator typed (register by path, upload) and the line the build service writes (`buildReleaseNotes`: `Built from source (<os>/<arch>) at <commit>`), which the console's Source column reads back as the source commit (`agentVersionSource.ts`). The two write routes refuse typed notes that start with `Built from source` (`assertTypedReleaseNotes`, both backends), so that line can only come from the build service. If the build line's form changes, change the guard and the frontend parser with it.
- **Build from source** refreshes the `AGENT_REPO_URL` clone before every build (`AgentBuildService` + `GitSyncService.sync()`), because `ensureRepo()` never pulls and Render's `buildFilter` doesn't redeploy on agent-only merges. The commit goes into the release notes.
- **Defender ASR** rule `01443614` (prevalence/age) blocks every fresh build, agent and tests alike; no certificate satisfies it (Microsoft cloud reputation). Customers add a **per-rule** exclusion for the `C:\F0` folder, for that rule only. It is safe because agent 0.7.1+ and the bootstrap script lock `C:\F0` to SYSTEM + Administrators. Never the global ASR exclusion list (exempts every rule), never a Defender AV exclusion, never a cert Allow indicator: the agent and all test binaries share the active signing cert, so trusting it whitelists every test. Customer doc: `wiki/docs/deployment/endpoint-prerequisites.md`.

### Source-Built vs External Embed Dependencies
`EmbedDependency` has a `sourceBuilt: boolean` flag distinguishing binaries compiled from Go source by `build_all.sh` from external pre-compiled binaries. Detection uses four heuristics in `isSourceBuiltBinary()` (`buildService.ts`):
1. **Direct match** — `foo.exe` → `foo.go` exists
2. **Hyphen-to-underscore** — `validator-defender.exe` → `validator_defender.go` exists
3. **UUID-prefix stage** — `<uuid>-T1486.exe` → strip UUID, check `stage-T1486.go` or prefix match (`stage1-defense-evasion.go`)
4. **Fallback** — parse `build_all.sh` for literal `go build -o <filename>`

Only external (non-source-built) missing deps block the Build button and show Upload. Source-built deps show a wrench icon + "Auto-built" label. `saveUploadedFile()` rejects uploads for source-built deps.

### Microsoft Defender Integration

**EDR integrations are deployment-wide.** Defender, CrowdStrike and SentinelOne settings routes ignore the caller's Clerk org (`edrSettingsService()` in `integrations.routes.ts`, `getSettingsService` in `sentinelone.routes.ts`). Their background sync, enrichment and auto-resolve only ever read the deployment-wide section, so per-org credentials would never sync. `backend-serverless` works the same way. Startup logs a warning for EDR sections still saved under an org (`listDormantOrgEdrSections`). **With `REQUIRE_ORG_ISOLATION=true` (multi-tenant) the shared EDR config is read-only from the UI**: `requireDeploymentScopeForEdrWrite` (`middleware/edrScope.middleware.ts`) returns 403 on settings save/delete, auto-resolve mode, SentinelOne automatic mitigation and a SentinelOne re-backfill, so one tenant's admin can't change what runs for every tenant. There, use the `DEFENDER_*` / `CROWDSTRIKE_*` / `SENTINELONE_*` env vars. Alerts, pre-execution notices and Azure stay per org.
**EDR Elasticsearch readiness** (`services/edr/es-readiness.ts`): Save checks the analytics key with `_has_privileges` and creates the vendor's indices before responding (`elasticsearch` in the response), Test runs the read-only check (`GET /api/integrations/edr/:vendor/elasticsearch?fresh=1`), startup checks every configured EDR. Not ready = saved but a red "Saved, but not syncing" notice on the card (`EdrEsReadinessNotice`), re-checked once a minute. Its `VENDOR_ES` map (indices + ensure function) is keyed by `EdrVendorKey`, so a new EDR must list its indices there.
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
- **Settings live in `IntegrationsSettingsService`** (`getSentinelOneSettings`, `saveSentinelOneSettings`, `getSentinelOneSyncTimestamps`, ...), like Defender and CrowdStrike, with env fallback `SENTINELONE_BASE_URL` / `SENTINELONE_API_TOKEN` and the standalone `sentinelone_sync` key for env-var installs. The routes use the **deployment-wide** settings (see *EDR integrations are deployment-wide* below); the service's org-section logic (never copy or patch the legacy section) is a safety net. Don't give S1 its own file I/O again: writers go through `getRawFileSettingsForWrite()`, which refuses to overwrite an unparseable `integrations.json`.
- **Client** (`services/sentinelone/s1-client.ts`): `Authorization: ApiToken`, cursor pagination, 429 back-off, console host allowlist (`*.sentinelone.net`, `*.s1gov.net`) plus the SSRF check. A `read_only` client refuses every non-GET; writes are limited to a closed allowlist: incident status/notes (auto-resolve) and `threats/mitigate/{kill,quarantine}` (automatic mitigation). There are **no manual response-action routes**; they need their own permission, Clerk-session-only access, scope filtering and confirmation before they come back.
- **Sync**: threats incremental on `updatedAt__gte`; detection alerts only support `createdAt__gte`, so their local status can be stale. `sync_version` is recorded only after every enabled source re-synced cleanly; permanent per-doc bulk 4xx errors don't pin the checkpoint (429/5xx do); missing dates are `null`, never `''`; items that stop passing the severity/status filters are deleted. `POST /sync` returns 202 and runs in the background.
- **Auto-resolve** re-reads each candidate's live incident status from the console (`?ids=`) and only resolves what is still `unresolved`, failing closed. Never writes a verdict or mitigation, never test docs.
- **Automatic mitigation** (off by default, Response mode only, kill/quarantine of `not_mitigated` test-matched threats, live re-check first) is audited as `doc_type: response_action`. Its result must never count as SentinelOne prevention. The `f0rtika.auto_mitigated` receipt is written **before** the kill (no receipt, no kill), and every reader of `prevention_action` honours it via `services/shared/achillesMitigation.ts`: the enrichment pass (`SentinelOneEnrichmentService`, `ignoreAchillesMitigated: true`), the analytics facet and rows (`SentinelOneAnalyticsService`), and the execution report.
- **Endpoint Protection score** (`sentinelone/protection-score.ts`): S1 has no Secure Score / ZTA equivalent, so the posture pass computes an **Achilles** score (labelled as ours, never as S1's): the % of agents passing every check (checked in within 7 days via `lastActiveDate`, not the live `isActive`, because an offline laptop is still protected; protect mode, up to date, not infected, anti-tamper from the agent's effective policy, firewall control, skipped as `notDeployed` when no agent has it on; disk encrypted). A check an agent doesn't report is skipped, not failed; `networkStatus` is not a check ("disconnected" = isolated by S1). Stored as `doc_type: protection_score` in the posture index, served by `/posture/protection-score`, and it is the S1 `ztaScore` series in `/correlation/scores`.
- **S1 prevention = its own immediate response**: `threatPreventionAction` (`sentinelone/normalize.ts`) ignores mitigation entries that started more than 15 minutes after detection (later analyst / STAR / Achilles actions), and every entry of a Threat an analyst raised (`initiated_by` `dv_command`, a Deep Visibility mitigation: the Threat is created by the analyst's action, so its kill passes the 15-minute rule). Threat docs always carry `prevention_action` (null when none) because the sync writes partial updates.
- **Verdicts**: `f0rtika.sentinelone_*` flags count everywhere (Analytics, `reports/stageOutcome.ts`, frontend `stageVerdict.ts`, campaigns, notice emails, reports, SB export) because every vendor list derives from the **EDR vendor registry**: `backend/src/services/outcomes/vendors.ts` `EDR_VENDORS` (display names verbatim per use: `name`, `label`, `productName`, `abbrev`, `reportName`) and its mirror `frontend/src/lib/edrVendors.ts` (a parity test diffs the two). Adding an EDR = one entry in both; `tsc` then lists every keyed map still missing it (`VENDOR_SETTINGS`, `INDEX_BY_VENDOR`, `VENDOR_ADAPTERS`, `EDR_ENV_PREFIX`, the `CoverageVendor` assertion in `outcomes/vendor-assertions.ts`). Per-vendor UI (tabs, settings cards, dashboard posture tiles, the related-alerts panel) is still added by hand.
- **EDR-killed agent runs** (`services/edr/agent-kill-*.ts`, run after every EDR poll (Defender/CrowdStrike/S1/Sophos), configured EDRs only; Sophos supplies no kill evidence yet, see the Sophos section): a watchdog-failed task (`Agent went offline during execution` / `Task exceeded execution timeout`) becomes one whole-test Protected doc (`f0rtika.edr_terminated`, `edr_terminated_vendors`, `edr_terminated_alert_ids`, `stages_unknown`) when a same-host (short hostname) alert created between pick-up and failure shows the EDR killed/quarantined/blocked (not Achilles' own mitigation) with overlapping parent-level techniques (30d lookback; file name irrelevant). No evidence = stays `-1`, no ES doc; cyber-hygiene never converted. Counts in the Defense Score (joins the test's latest-basis pair); excluded from every technique view, report technique/tactic counts and vendor detection-rate/overlap (`NOT_STAGELESS`); chain-depth `agentTerminated`; not in the SB export. Matched alerts never get `achilles_correlated`, so never auto-resolved/auto-mitigated. Campaign matrix + Finished email show Protected; `finishedHoldActive` holds the Finished email up to 15 min after a cut-off run when an EDR is connected. Backend-only.
- **ATT&CK renumbering**: EDRs adopt new technique ids before the test library does (S1 reports `T1685` for the revoked `T1562.001`). Every alert-vs-test technique match (agent-kill overlap, technique coverage, Defender/EDR technique filters, related-alerts lookup, report alert correlation) goes through `data/techniqueAliases.ts`, built from `ATTACK_TECHNIQUE_REVOKED_BY`, which `scripts/generate-attack-techniques.mjs` writes from MITRE's revoked-by relationships. Never hand-edit the map; regenerate (`ATTACK_STIX_FILE=` reads a local bundle). `techniqueAliases.ts` and `technique-coverage.ts` stay byte-identical in both backends.
- **EDR launch blocks** (`services/edr/launch-block-*.ts`, run after every Defender/CrowdStrike/S1/Sophos poll, next to the kill pass): an EDR's static/ML block of the test orchestrator makes the agent report exit 260, same as Defender ASR 01443614. A standalone, non-cyber-hygiene 260 doc is rewritten **in place** (conditional on its seq_no) to 126 Protected (`f0rtika.edr_launch_blocked`, `launch_block.{original_exit_code,vendors,alert_ids,evidence,resolved_at}`, the vendor's `_detected`/`_prevented`/`_prevention_action`, plus `bundle_id`/`bundle_name` for a multi-stage test) when a prevention alert (`quarantined`/`process_killed`/`blocked`, not Achilles' own mitigation) on the same short host names the run's task folder `task-<doc _id>` (within 24 h) or, with no task folder, the orchestrator `<uuid>.exe` in the -5/+30 min window (nearest 260 run only, and none when an executed or resolved sibling run of the test on the host is as near, or enrichment already correlated the alert; a stage binary never counts). An alert proves at most one run ever: receipt `f0rtika.achilles_launch_block_doc_id` on the alert, skipped by the evidence search; each pass first re-links resolved docs whose alerts lack it. Vendors opt in via the required `launchBlockEvidence` in `VENDOR_SETTINGS` (`edr/vendor-settings.ts`): **Defender is false** (260 exists for its ASR rule). Alerts are queried first (cheap with many ASR 260s); 90 d first pass per process, then 2 d. Proving alerts get `achilles_correlated` (exact evidence, so auto-resolve may act), unlike kill alerts. Technique views use `NOT_STAGELESS` (covers `edr_terminated` + `edr_launch_blocked`; also in `enrichmentEligibleClauses`, so enrichment and vendor technique coverage skip both), and `STAGELESS_BUNDLE_DOC` routes both into the bundle pair; chain depth counts a launch block at stage 1. SQLite tasks keep exit 260 (Tasks page rows + 7-day tiles say "Not run"); campaigns/Finished email read the ES doc, but there's no Finished-email hold for 260. Not in the SB export (per-control docs only). Backend-only.
- **Backend shared code**: `services/edr/` holds the vendor-neutral pieces used by both endpoint EDRs.
  - `EdrAlertEnrichmentService` is the evidence-correlation pass for all four EDRs (Defender passes its own evidence queries for its re-fire window). It writes `<vendor>_stage_prevented` (did an alert naming THIS stage carry the action?), which the stage verdicts prefer over `_stage_detected` + `_prevention_action`; it re-checks detected stages for 72 h because EDRs attach the action late, and aggregates `prevention_action` over every matching alert (used only when more alerts matched than were read). A **multi-test alert** (evidence names binaries of 2+ different Achilles tests, `edr/multiTestEvidence.ts`) counts, at stage AND test level, only through the vendor's **per-file verdict**: Defender's sync stores `evidence_file_verdicts` (verdict + that file's own action per evidence file, sync v5); a stage/test gets credit only when its own file is `malicious`, and prevention only from that file's action, never the alert-wide one. Listings (Defender *A suspicious file was observed*, cmd.exe behaviour alerts: every item `suspicious`, agent included) and every multi-test alert of a vendor with no per-file verdicts count for nothing. Sub-queries read up to 100 hits (alerts beyond that count, unclassified). `projectAlertHit` gives them `attribution: 'multi_test'` (the panel folds them into one `MultiTestAlertsNote`, the report drops them) or the marked file's stage. One-time re-checks: `<vendor>_stage_rule: 'single_test'` (stage flags) and `<vendor>_evidence_rule: 'file_verdict'` (`_detected`), each downgrading only when alerts are still in the index and none counts.
  - **Alerts belong to a run** (`edr/runEvidence.ts`: `runWindow`, `runEvidence`, `alertCreditForRun`, `runActions`, `isOtherRunAlert`; the one place that decides, no caller re-implements it). A Defender alert stays open for days and gains evidence from later runs.
    - **Sync v9** stores `evidence_items` (`file/path/parent/parent_path/kind/verdict/action/started_at/added_at`, un-indexed; `null` over 1,000 items or an item whose `createdDateTime` is missing or unparseable; `started_at` null when empty, unparseable or before 2000, Defender's `0001-01-01` placeholder). Readiness is its own `evidence_items_version` (`evidenceItemsReady()`, written only after an error-free full look-back; `sync_version` is also saved by score syncs so it can't serve); the full re-sync selects by `lastUpdateDateTime` and repeats up to 3 times after write errors, then per-run crediting stays off until restart.
    - **Run start**: results store `routing.run_started_at` in UTC ISO form (`toISOString()` of the task's `started_at`, API `run_started_at`); `agent/runStartBackfill.ts` fills the last 90 days once at start-up from SQLite task rows, 120 s budget, logs `[Run-Start-Backfill] scanned= filled= unfillable=` (+ ` incomplete=true` when the budget ended it, logged even at 0 scanned).
    - **Rule**: run window = `[run_started_at - 60 s, event_time + 60 s]`; a process item is in the run by `started_at`, a file item (or a process item with no start) by `added_at` up to `event_time + 30 min`. With a run view actions come only from in-run items (not the alert-wide action); no `run_started_at`, no/`null` `evidence_items` or another vendor = the older rule exactly.
    - **Enrichment** uses it only for Defender (`runScopedEvidence`, set when `evidenceItemsReady()`). Marker `<vendor>_run_rule: 'run_activity'` (was `'run_evidence'`) = one-time re-check (a flag drops only when the run's lookup finds alerts and none counts for the run); a pass without a run view that sets a detection or prevention flag on a marked result clears it to `null`; during the run re-check a result with a queued sub-query that did not answer removes nothing that pass (both kinds unjudged; off it, each kind is judged from its own answer). Log gains `stageDetectionsRemoved/detectionsRemoved/preventionsRemoved`, and `removedFlagDocs` (at most 20 ids, counted on `updated` only) becomes `[Defender] Run-evidence re-check removed flags on: …` (+ `(+n more)`).
    - **Lookup and report**: `projectAlertHit(source, bundleUuid, window?)` gives `attributed_control_ids` + `stage_actions`; batch `alerts-for-tests` takes `runStartedAt` and drops an alert that names the test only in an earlier run (`leftOutOfRun`, with the vendor's path rule from `AlertsForTestDeps.pathNamesTest` / `VendorAdapter.pathNamesTest`: Defender passes `defenderPathNamesTest`, the enrichment pass's rule). Console lists an alert under every stage in `attributed_control_ids`; the report has `stageControlIds`. Serverless gets only the name-based `attributed_control_ids`.
    - **Found by activity span** (`defender/evidence-correlation.ts`): with a usable `run_started_at` the time clause is named `alert_time` (created/updated -5/+30 min of the end) OR `activity_span` (`first_activity_at <= end+30 min` AND `last_activity_at >= start-5 min`); no run start = the old query. `foundBySpanOnly(hit)` (`matched_queries`), `spanHitUnusable`: a span-only hit counts/lists only via in-run items (`leftOutOfRun(..., spanOnly)`), else treated as not returned. Enrichment: Defender + `runScopedEvidence` + run window only; a span-only alert is stamped `achilles_correlated` (so auto-resolvable) only when credited (alert-time hits as before). Console/report tier 1 only; technique tier, other EDRs, results without a run start unchanged.
    - **Known limits**: past 100 hits per sub-query only `alert_time` hits count the old way (`alert_time` aggregation), and unread span-only matches make that kind unjudged (`stageUnjudged`/`wideUnjudged`: no stage / test-level / prevention removal on it, marker still written); a re-detection adding no evidence item (a flag already stored is kept, see next bullet), a late alert with only a file item, activity >30 min after the end or a process >5 min after the last activity are not credited/found; results over 90 days are not revisited; an ASR block raises no alert.
    - **Keep rule** (Defender, per-run crediting on): a result whose stage may have been stopped (`mayHaveBeenStopped`: an exit code other than 0 and 101; exit 0 = skipped on a multi-stage test, and no code, are judged as before) loses no flag when its alerts hold nothing of the run and one of them knew the file before it. `stageNoRunItems` / `wideNoRunItems` = at least one usable alert, none unread, all `holdsNothingOfRun`, at least one `heldItemBeforeRun` (an item earlier than the window start; an alert with only later items keeps nothing). Stage query true = whole result held back (`stageUnjudged`+`wideUnjudged`); only test-level true = `wideUnjudged` only. Exit 101 and "items of the run, none for this stage" removed as before; no flag created. Pass field `keptWithoutRunEvidence` (in the `[Defender-Enrichment]` line; once per already-flagged result, in the update writing its marker, on `updated`). Note `f0rtika.defender_no_run_evidence` (`seen_at`, `kind` stage|wide, `alerts` ≤5 of `id/found_by/updated_at/first_activity_at/last_activity_at/items`): once on a fresh result (≤72 h, none yet); mapped `dynamic: false` with `seen_at` date + `kind` keyword searchable (`exists` on `.seen_at` finds cases), `alerts` `_source` only; the pass `putMapping`s that field on the index before its first note (once per index per service instance, a new one each Defender pass; failure = one warning, no note to that index); `noRunEvidenceDocs` (≤20) + `noRunEvidenceDocsOmitted`, log `[Defender] No evidence of the run for a stage that did not complete, note stored on: …` (+ `(+n more)`). Limits: kept flag beside an empty alert list; a non-EDR failure inside an open alert's span keeps a stale flag; silent block on a new run not credited; removed flags not restored.
  - **Exit code decides prevention** (marker `<vendor>_prevention_rule: 'in_run'`, a historical name): a result that exited 101 ran to completion and is never Prevented (Detected when an EDR alert names it, else Unprotected), for every EDR; the enrichment pass writes no `<vendor>_prevented` / `_stage_prevented: true` / `_prevention_action` on it, and `classifyStage` / `OUTCOME_FILTERS` / frontend `classifyExecution` / serverless `classifyStage` agree. No time rule: an EDR can mark a process blocked after it exited (Defender did, ~2 min later), which a time comparison let through. `edr/completedStageCleanup.ts` (copied to `backend-serverless`) sets stored 101 results' prevention flags to `false` / `false` / `null`, any age. In `backend/` it covers every EDR, connected or not, at start-up and every 5 min; in `backend-serverless/` it covers Defender and CrowdStrike flags only, and runs only when one of the two is configured, just before its enrichment pass. It uses `term`/`exists` filters only (`achilles-*` mixes `event.ERROR` types), re-checks each hit's exit code, and never touches detection flags. Error-coded stages (999) and 105/126/127 are unchanged. A run is Prevented only when one of its stages is. A stage's own prevention comes only from its own file's action or a process it started (`ownActions`: `evidence_file_verdicts` + `evidence_child_actions`, Defender sync v7); vendors without per-item actions keep the alert-wide one. Defender's alerts_v2 sends a process's parent as `parentProcessImageFile` (never `parentProcess`, kept only as a fallback); since sync v8 parent files are in `evidence_filenames` / `evidence_filepaths`, so an alert on a LOLBin a stage launched matches that stage (Defender `launchBlockEvidence` is false, so the orchestrator showing up as a parent can't fake a launch block). Alerts stay `achilles_correlated`, so auto-resolve still closes them.
  - **Run start** (`routing.run_started_at`, the start of a result's run window): written only by `boundedRunStart()` (`services/agent/runStart.ts`), at ingestion and in the start-up backfill, and only when it is within the task's `execution_timeout` + 120 s of the end. Both times are agent-reported; an unbounded start let an old alert of the test on that host count as this run's evidence. A new writer of the field must go through it.
  - `EdrAlertAnalyticsService` covers alerts, facets, coverage and detection rate, with a `getPostureScoreTrend()` hook.
  - Each vendor has a thin subclass that binds its index and flags: `CrowdStrikeEnrichmentService` / `SentinelOneEnrichmentService`, and `CrowdStrikeAnalyticsService` (adds ZTA) / `SentinelOneAnalyticsService`.
  - `edr/__tests__/alert-enrichment.vendors.test.ts` runs the shared enrichment rules once per vendor; add a vendor there when adding one.
- **Frontend** reuses the vendor-neutral `pages/analytics/components/integrations/` pieces (`vendorConfig.ts`, `IntegrationTabHeader`, `EndpointAlertDetailsDrawer`, feed, coverage). Put vendor differences in `vendorConfig`, not `vendor.id ===` branches.

### Sophos Integration
Pulls Common Alerts, SIEM events and XDR detections (GraphQL, REST v1 fallback) from one Sophos Central **tenant** into `achilles-sophos`, in the shared normalized alert shape, plus a 6-hourly posture pass (Account Health Check, endpoints, policies, exclusions, allowed items). User docs: `wiki/docs/user-guide/integrations/sophos.md`, `sophos-auto-resolve.md`, `wiki/docs/user-guide/analytics/sophos.md`, `wiki/docs/api-reference/sophos.md`, `docs/SOPHOS_INTEGRATION.md`; endpoint guide: `wiki/docs/deployment/endpoint-prerequisites.md` (Sophos Intercept X).

- **Backend-only.** `backend-serverless/` has no Sophos code except the `CoverageVendor` union in `technique-coverage.ts` (byte-identical with `backend/`); `/api/capabilities` reports `sophos: false` there.
- **One tenant credential per install**; partner / organization credentials are rejected by `POST /test`. Read-Only role for sync and posture; Service Principal Management only for auto-resolve writes (confirmed live Oct 2026 for resolving XDR detections; alert acknowledge not yet exercised live). Saving a new `client_id` requires its secret; `POST /` is refused while `SOPHOS_*` env credentials are set (a saved section would shadow them).
- **Settings** live in `IntegrationsSettingsService`, deployment-wide like the other EDRs (writers via `getRawFileSettingsForWrite()`); `requireDeploymentScopeForEdrWrite` is on every write route including manual Sync, so with `REQUIRE_ORG_ISOLATION=true` use the `SOPHOS_*` env vars.
- **Client** (`sophos-client.ts`): host allowlist (a whoami `dataRegion` outside it is refused), 50 requests/minute sliding window (tenant budget is 100/min, shared with the customer's SIEM). `read_only` refuses every non-GET except the sign-in, GraphQL query documents and the REST v1 detections query run (`POST /detections/v1/queries/detections`); `response` allows only alert `acknowledge` and the `detectionUpdateResolutionInfo` mutation with `TRUE_POSITIVE_BENIGN`. Never `authPua`, clean/clear, isolation, scans, or tamper toggles. **Never call `GET /endpoint/v1/endpoints/{id}/tamper-protection`** (it returns the tamper password); tamper state comes from the endpoint list.
- **SIEM keeps 24 h** (Sophos rejects an older start date). After a poll gap of about 23 h Achilles restarts at now - 23 h and records `sync_gap {from, to}`, shown in the tab until a reset or a clean poll 24 h later. ATT&CK techniques exist only on XDR detections; a no-XDR tenant still syncs. A plain 404 on a capability probe is `unknown`, never `not_licensed` (the CrowdStrike ZTA trap).
- **XDR evidence = flat `entities` + File `source_entities`.** A detection usually fires on a Windows program the test started (`cmd.exe`, `rundll32.exe`); the stage binary that started it is often only in `source_entities` (live, Oct 2026). The sync requests it (`SOPHOS_DETECTION_SYNC_FIELDS`) and `transformGraphqlDetection` appends File entities after the flat ones. Don't add Process entities: they are bare names of the whole ancestry (incl. the orchestrator), which the launch-block orchestrator-name rule would misread. Same lesson for every EDR: the test binary is often the parent / grandparent (CrowdStrike `parent_details` / `grandparent_details`, S1 `sourceParentProcessInfo`).
- **One row per detection** (`merge.ts`): SIEM events merge into their alert across polls, else into an XDR detection (`siemEventMatchesXdr`: same host, every SIEM file path among the XDR `evidence_filepaths`, no SHA-256 conflict, within ±5 min; closest XDR wins, an alert match has priority, two XDR detections never merge; XDR pages absorb stored `siem_event` rows via `planXdrWrites`); legacy cleanup events never become rows and only enrich an alert / SIEM row within 15 minutes. An absorbed `siem_event` row's `achilles_*` correlation / agent-kill receipts move to the absorbing alert or XDR detection (only where it has none; auto-resolve receipts never move), otherwise it is never auto-resolved. The shared pass re-checks recent stages for every EDR (`DEFAULT_RECHECK_UNPREVENTED_HOURS`, 72 h), which covers Sophos' remedy landing a poll after the alert; a re-check writes only missing flags.
- **Little EDR-killed-agent evidence from Sophos** (any tenant): `alertProvesKill` needs prevention AND technique overlap on one alert; Sophos alert/SIEM rows have prevention but no techniques, and XDR detections have techniques but no remedy prevention, unless an XDR detection absorbed the SIEM remedy of the same block (then it can prove a kill). Otherwise a watchdog-failed task stays an error even when Sophos killed the agent (`sophos/__tests__/agent-kill.test.ts` pins this). Follow-up: technique overlap from a same-host XDR detection in the window.
- **Prevented = Sophos' own automatic response only**; cleanup failed (`kill_failed`) is detection only; XDR detections set `prevention_action` only for Sophos' own block/cleanup titles ("<threat>: File activity blocked (…)" → `blocked`, "Cleanup succeeded: File cleanup result: Success (…)" → `quarantined`). XDR detections are re-read with a 30-min overlap (Sophos completes their entities minutes after creation; the stage process arrives late). The 15-minute rule never uses SIEM `created_at` (ingest time).
- **Health Check headline** is labelled "Achilles average of Sophos Health Check scores", never as Sophos'; missing categories are skipped, never zeroed (formula in the wiki). It is the Sophos `ztaScore` series.
- **Critical posture findings** (`posture.service.ts`): an allowed certificate matching the active Achilles signing cert, a folder exclusion covering `C:\F0` / `/opt/f0`, or a process exclusion of the agent. Don't remove them: the agent and every test share the certificate.
- **Auto-resolve**: live re-check first, 30 per pass, 401/403 halt with the role hint. Dry-run receipts (`auto_resolve_dry_run_at`) never set `auto_resolved`, so they never block a later real resolve. SIEM-only, EDR-killed-agent and REST v1 rows aren't resolved. Receipts on alert docs only, never test docs.
- **Adding an EDR** means the registry (`PREVENTION_ACTION_PRECEDENCE`) and `alert-enrichment.vendors.test.ts`. Fixtures are provisional until captured on a PoC tenant (`backend/scripts/sophos-capture.ts`, runbook `docs/sophos-poc-runbook.md`; output dirs `sophos-capture-*/` are gitignored); live-behaviour statements in the guide stay marked "pending validation" until then.

### Pre-execution notices
Emails the security engineers before every `execute_test` run and holds the tests until the mail server accepts the notice for every recipient, plus a 0-5 minute lead. Off by default. User doc: `wiki/docs/user-guide/integrations/pre-execution-notices.md`.
- **The hold lives in `getNextTask`** (`tasks.service.ts`): a pending task with a `notice_id` is only handed out when its `run_notices` row is `sent`/`overridden` and `release_at <= now < pickup_deadline`. Held tasks stay `status='pending'`; agents are unchanged. Compare JS-computed ISO strings, never `datetime('now')`.
- **Backend-only.** `backend-serverless/` has no email stack and `GET /api/capabilities` reports `preExecutionNotices: false` there, which hides the Settings card, badges and banner.
- **Per org, with legacy fallback (like alerts).** Settings live at `orgs[orgId].pre_execution_notices`, falling back to the legacy top-level `pre_execution_notices` when the org has no section (so `'default'` and unknown org ids use legacy). SMTP/Slack come from the same org's `alerts` (org section, else legacy). A notice's **owning org** is the `org_id` of the tasks it gates (`run_notices.org_id`; NULL on pre-R20 rows = legacy): Run Now/batch use the request's validated `org_id`, retry the original task's, the scheduler `schedule.org_id` (one shared run notice **per org** per tick). Every send, Finished email, bounded wait, Slack alert and release reads `new IntegrationsSettingsService(notice.org_id ?? undefined)`, never a global service. Routes are org-scoped: settings via the caller's org; `GET /`, `/status`, `/:id/release` see only the caller org's notices (another org's id is a 404), no-org callers see all (legacy mode) unless `REQUIRE_ORG_ISOLATION=true` (403). The daily SMTP check runs for the legacy section and each org with its own enabled section.
- **Notice code ignores the alerts `configured` flag.** SMTP counts as usable when `smtp_host` + `from_address` are set and Slack when `webhook_url` + `enabled` are set (`services/notices/channels.ts`), because the Alerts UI never sends `configured` and `saveAlertSettings` keeps it false. The gate itself depends on `enabled` only, so a broken SMTP holds tests rather than letting them run unannounced.
- **The gate fails closed.** `getPreExecutionNoticeSettings()` reads the notice section from the *raw* JSON (it holds no secrets), so an undecryptable credential elsewhere in `integrations.json` can't null the file and read as "off"; an unparseable file falls back to the last good read per org. Don't route it back through `getFileSettings()`.
- **The run tag never reaches the hosts.** Telemetry shows the test UUID (binary names, `C:\F0\tasks` / `/opt/f0/tasks`); the notice email's "Finding this activity" section says so. Don't tell the SOC to search for `PA-RUN-…`.
- **Trap: `recreateTasksTable`** in `backend/src/services/agent/database.ts` (run by `migrateExecuteCommandType`) recreates the `tasks` table on a database whose CHECK predates `execute_command`. Any new `tasks` column must be added to its `optionalCols`, and its index to the index recreation, or the recreation fails on a database that has the column.
- **Advance digest** (`services/notices/digest.service.ts`, `notice_digests`): daily 09:00 heads-up per schedule org; runs outside `processNotices` on purpose (never delays the gate); never touches `run_notices`/`tasks`.
- Code: `backend/src/services/notices/`, `backend/src/api/notices.routes.ts`. `services/notices/` must not import `tasks.service.ts` (import cycle); `tasks.service.ts` imports from `notices.repo.ts`.

### Alerting Service
Threshold-based alerting dispatched when test results cross configured score thresholds. Hooked into the result ingestion pipeline.

- **Channels**: Slack (Block Kit via webhook URL), Email (Nodemailer with SMTP)
- **Thresholds**: Score drop % (relative) and absolute score floor, configurable per metric
- **Settings**: Stored in `~/.projectachilles/integrations.json` (AES-256-GCM encrypted)
- **Backend service**: `services/alerts/` — `alerts.service.ts` (threshold evaluation), `slack.service.ts`, `email.service.ts`
- **Frontend**: `AlertsConfig` settings component, `NotificationBell` in TopBar
- **Dispatch trigger**: Called from `results.service.ts` after successful ES ingestion
- **Backend-only**: `backend-serverless/` has no alerting routes. `GET /api/capabilities` reports `alerting: false` there, which hides the Settings card and the bell's alert calls (the bell still shows flash notifications). The frontend default is `true`, because alerting predates the flag.

### Visual Theme
A single theme: the f0 dark theme (since the f0 restyle). `useTheme` (`frontend/src/hooks/useTheme.tsx`) keeps the old provider/hook API so consumers and test mocks still work, but `theme` is always `'dark'` and there is no theme selector. CSS variables in `frontend/src/styles/index.css` drive all styling via Tailwind CSS v4 `@theme` blocks; print layouts (execution report, campaign evidence) re-point those tokens to a fixed light palette.
