## Repository Shape

- There is no root package/workspace manifest. `backend/`, `frontend/`, `backend-serverless/`, `blog/`, and `wiki/` are independent npm projects; `cli/` uses Bun; `agent/` and `installer/` (the `achilles-installer` TUI) are separate Go modules; `appliance/` builds the Windows Hyper-V appliance image.
- Main entrypoints are `backend/src/server.ts`, `frontend/src/main.tsx`, `backend-serverless/src/app.ts` plus `backend-serverless/api/index.ts`, `cli/bin/achilles.ts`, and `agent/main.go`.
- `backend-serverless/` is an independent Vercel fork, not a build of `backend/`: it uses async Turso/libSQL and Vercel Blob, build-time test-library cloning, and cron routes. Changes to shared API contracts, types, Elasticsearch mappings, or business logic usually need deliberate edits and tests in both backends.
- `blog/` is an independent Next.js site; `wiki/` is Docusaurus. Do not assume either shares frontend code or deployment.

## Setup And Verification

- Use Node 22 and each npm package's committed `package-lock.json` (`npm ci`). The CLI uses Bun and `cli/bun.lock`. The agent's executable source of truth is `agent/go.mod`, currently Go 1.26.
- Note: `mise.toml` pins `go = "1.24.2"`, which does NOT satisfy `go.mod` (1.26.0). Use a Go toolchain >= 1.26 when building `agent/`.
- Full local stack: `./scripts/start.sh -k --daemon`; stop it with `./scripts/start.sh --stop`. The script installs package dependencies, selects free backend/frontend ports, and synchronizes the chosen backend port into Vite.
- CI order for `backend/` and `frontend/` is `npm ci`, `npm run build`, then `npm test`. There is no repository lint/formatter command.
- Focused Vitest: from the owning package run `npx vitest path/to/file.test.ts` or `npx vitest -t "test name"`. Tests are discovered under `src/**/__tests__/**/*.test.{ts,tsx}` (backend variants accept `.ts`).
- Relevant package gates: `backend-serverless`: `npm run build && npm test`; `cli`: `bun run typecheck && bun run test && bun run build`; `blog`: `npm test && npm run build`; `wiki`: `npm run build`; `agent` and `installer`: `go test ./... && go build ./...` in each.
- `agent/Makefile` cross-compiles static binaries with `CGO_ENABLED=0`; `make build-all` writes `agent/dist/`. Windows signing needs `osslsigncode` and certificate env/state; macOS signing needs `rcodesign`. Signing targets intentionally leave builds unsigned when tooling or credentials are absent.

## Runtime And Data

- Local backend startup requires Clerk keys in `backend/.env`; frontend uses `frontend/.env`. Vite proxies `/api` and `/ws` to `VITE_BACKEND_PORT` (default `3000`). Use `.env.example` files as templates and never put live credentials in tracked docs or samples.
- Backend runtime state is outside the checkout in `~/.projectachilles/` (SQLite, encrypted settings, signing material, binaries, builds, and custom tests). Re-cloning does not reset it; do not delete it as routine cleanup.
- Docker Compose runs backend/frontend/wiki by default. Local Elasticsearch and synthetic seeding require `docker compose --profile elasticsearch up -d`; this profile disables Elasticsearch security and is development-only.
- Several features exist only in `backend/` (campaigns, pre-execution notices, SentinelOne, Sophos, console identity, alerting, stage coverage, Go builds; API keys too). `backend-serverless/` reports the first group as `false` in `GET /api/capabilities` and the frontend hides them; a new backend-only feature needs its flag there.
- `backend-serverless/CLAUDE.md` contains Vercel-specific constraints. In particular, use `process.cwd()` rather than bundle-derived `__dirname`, keep static `data/**` in `vercel.json` `includeFiles`, and remember `.vercelignore` replaces `.gitignore` for upload filtering. Its `vercel-build` script clones the test library at build time (`TESTS_REPO_URL`, optional `GITHUB_TOKEN`).

## Commits And Deployment

- Commit convention: `<type>(<scope>): <description>` — types `feat|fix|docs|style|refactor|perf|test|chore`; scopes include `frontend`, `backend`, `backend-serverless`, `agent`, `analytics`, `browser`, `vercel`, `wiki`, `ci`, `deps`.
- Beyond Docker Compose, deployment targets are: public/on-prem server via `docker-compose.server.yml` + Caddy (`./scripts/deploy-server.sh`, `./scripts/deploy-remote.sh u@host`, `./scripts/deploy-do.sh`; configured from `deploy.config.env`; `achilles-installer` and `scripts/install-onprem.sh` wrap the same engine, and the Hyper-V appliance ships it prebuilt), Render (`render.yaml`), Fly.io (`.github/workflows/deploy-flyio.yml`), and Vercel (serverless fork). Guides live under `docs/deployment/`.

## Code Traps

- Both TypeScript backends are ESM and require `.js` suffixes on relative imports in `.ts` source; extensionless imports compile but fail at runtime.
- Backend route handlers use `asyncHandler`; HTTP failures use `AppError`. New protected routes must apply the existing Clerk permission middleware; device routes under `/api/agent/*` use agent-key auth instead.
- Backend database tests use in-memory SQLite. When replacing the database module with `vi.mock`, define the mock first and dynamically import the subject afterward; static import order can bind the production database.
- Any new `tasks` column must also be added to `migrateExecuteCommandType`'s `optionalCols` (and its index to the index recreation) in `backend/src/services/agent/database.ts`; that migration recreates `tasks` even on fresh databases and silently drops unlisted columns. `notice_id` and `campaign_run_id` are there.
- SQLite CHECK-constraint migrations recreate tables: disable foreign keys outside the transaction, drop stale temp tables, copy/swap the table, recreate indexes, then re-enable foreign keys. See `backend/src/services/agent/database.ts` before changing schema migration logic.
- Frontend source supports `@/` as the `frontend/src` alias. API calls should go through the authenticated API layer; Redux consumers use the typed `useAppDispatch`/`useAppSelector` hooks.
- User-facing API/config behavior may require matching pages under `wiki/`; `./scripts/check-docs-drift.sh` reports the repository's code-to-doc mappings.
- API keys: scope→permission mapping lives only in `permissionsForScope()` (`backend/src/middleware/apiKeyAuth.middleware.ts`); the `read` scope is computed as "every permission ending in `:read`", so the naming convention is the security boundary. Key/user management routes stay Clerk-session-only, and API keys do not exist in `backend-serverless/`.
- Agent version registration: the registered version must equal the binary's embedded `-X main.version` (read from Go build info by `binaryVersion.ts`); unstamped binaries or mismatches are rejected with 422. See root `CLAUDE.md` "Agent Self-Update Safety" before touching the updater.

<!-- impeccable:start -->
# Design Context

- Before UI work, use the `impeccable` skill and read root `PRODUCT.md` and `DESIGN.md`; if absent, use `frontend/src/styles/index.css` as the token source of truth.
- There is one theme (the f0 dark theme). Use structural and semantic tokens; never hard-code hex/OKLCH colors in components (print layouts re-point the tokens to a light palette).
- Status color must also have an icon, label, or shape. Preserve WCAG 2.2 AA, keyboard focus, reduced-motion behavior, and the flat-at-rest/kinetic-on-interaction model.
<!-- impeccable:end -->
