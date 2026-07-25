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

## Repository Shape

- There is no root package/workspace manifest. `backend/`, `frontend/`, `backend-serverless/`, `blog/`, and `wiki/` are independent npm projects; `cli/` uses Bun; `agent/` is Go.
- Main entrypoints are `backend/src/server.ts`, `frontend/src/main.tsx`, `backend-serverless/src/app.ts` plus `backend-serverless/api/index.ts`, `cli/bin/achilles.ts`, and `agent/main.go`.
- `backend-serverless/` is an independent Vercel fork, not a build of `backend/`: it uses async Turso/libSQL and Vercel Blob, build-time test-library cloning, and cron routes. Changes to shared API contracts, types, Elasticsearch mappings, or business logic usually need deliberate edits and tests in both backends.
- `blog/` is an independent Next.js site; `wiki/` is Docusaurus. Do not assume either shares frontend code or deployment.

## Setup And Verification

- Use Node 22 and each npm package's committed `package-lock.json` (`npm ci`). The CLI uses Bun and `cli/bun.lock`. The agent's executable source of truth is `agent/go.mod`, currently Go 1.25.
- Full local stack: `./scripts/start.sh -k --daemon`; stop it with `./scripts/start.sh --stop`. The script installs package dependencies, selects free backend/frontend ports, and synchronizes the chosen backend port into Vite.
- CI order for `backend/` and `frontend/` is `npm ci`, `npm run build`, then `npm test`. There is no repository lint/formatter command.
- Focused Vitest: from the owning package run `npx vitest path/to/file.test.ts` or `npx vitest -t "test name"`. Tests are discovered under `src/**/__tests__/**/*.test.{ts,tsx}` (backend variants accept `.ts`).
- Relevant package gates: `backend-serverless`: `npm run build && npm test`; `cli`: `bun run typecheck && bun run test && bun run build`; `blog`: `npm test && npm run build`; `wiki`: `npm run build`; `agent`: `go test ./... && go build ./...`.
- `agent/Makefile` cross-compiles static binaries with `CGO_ENABLED=0`; `make build-all` writes `agent/dist/`. Windows signing needs `osslsigncode` and certificate env/state; macOS signing needs `rcodesign`. Signing targets intentionally leave builds unsigned when tooling or credentials are absent.

## Runtime And Data

- Local backend startup requires Clerk keys in `backend/.env`; frontend uses `frontend/.env`. Vite proxies `/api` and `/ws` to `VITE_BACKEND_PORT` (default `3000`). Use `.env.example` files as templates and never put live credentials in tracked docs or samples.
- Backend runtime state is outside the checkout in `~/.projectachilles/` (SQLite, encrypted settings, signing material, binaries, builds, and custom tests). Re-cloning does not reset it; do not delete it as routine cleanup.
- Docker Compose runs backend/frontend/wiki by default. Local Elasticsearch and synthetic seeding require `docker compose --profile elasticsearch up -d`; this profile disables Elasticsearch security and is development-only.
- `backend-serverless/CLAUDE.md` contains Vercel-specific constraints. In particular, use `process.cwd()` rather than bundle-derived `__dirname`, keep static `data/**` in `vercel.json` `includeFiles`, and remember `.vercelignore` replaces `.gitignore` for upload filtering.

## Code Traps

- Both TypeScript backends are ESM and require `.js` suffixes on relative imports in `.ts` source; extensionless imports compile but fail at runtime.
- Backend route handlers use `asyncHandler`; HTTP failures use `AppError`. New protected routes must apply the existing Clerk permission middleware; device routes under `/api/agent/*` use agent-key auth instead.
- Backend database tests use in-memory SQLite. When replacing the database module with `vi.mock`, define the mock first and dynamically import the subject afterward; static import order can bind the production database.
- SQLite CHECK-constraint migrations recreate tables: disable foreign keys outside the transaction, drop stale temp tables, copy/swap the table, recreate indexes, then re-enable foreign keys. See `backend/src/services/agent/database.ts` before changing schema migration logic.
- Frontend source supports `@/` as the `frontend/src` alias. API calls should go through the authenticated API layer; Redux consumers use the typed `useAppDispatch`/`useAppSelector` hooks.
- User-facing API/config behavior may require matching pages under `wiki/`; `./scripts/check-docs-drift.sh` reports the repository's code-to-doc mappings.

<!-- impeccable:start -->
# Design Context

- Before UI work, use the `impeccable` skill and read root `PRODUCT.md` and `DESIGN.md`; if absent, use `frontend/src/styles/index.css` as the token source of truth.
- One component set supports Default, Neobrutalism, and Hacker Terminal themes. Use structural and semantic tokens; never hard-code hex/OKLCH colors in components.
- Status color must also have an icon, label, or shape. Preserve WCAG 2.2 AA, keyboard focus, reduced-motion behavior, and the flat-at-rest/kinetic-on-interaction model.
<!-- impeccable:end -->
