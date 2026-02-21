# backend-serverless/CLAUDE.md

Serverless fork of `backend/` for Vercel deployment. See root `CLAUDE.md` for the full project overview and `VERCEL.md` for deployment instructions.

## Quick Reference

```bash
npm run build            # TypeScript compilation (tsc)
npm test                 # Vitest — all tests
npx vitest src/services/agent/__tests__/enrollment.service.test.ts  # Single file
```

## Key Differences from `backend/`

| Concern | `backend/` | `backend-serverless/` |
|---------|-----------|----------------------|
| Database | `better-sqlite3` (sync) | `@libsql/client` (async, Turso) |
| DB helper | `getDatabase()` → sync `Database` | `getDb()` → async `DbHelper` |
| Storage | `fs` (filesystem) | `@vercel/blob` (via `storage.ts`) |
| Signing | Filesystem keypair (PFX) | `SIGNING_PRIVATE_KEY_B64` / `SIGNING_PUBLIC_KEY_B64` env vars (Ed25519) |
| Entry point | `server.ts` (Express listen) | `app.ts` (Express export) + `api/index.ts` |
| Scheduling | `setInterval` in process | Vercel Crons → `cron.routes.ts` |
| Test library | Runtime git sync | Build-time clone (`vercel-build` script) |
| Build system | Go cross-compilation | Stubbed (returns 503) |
| Cert generation | OpenSSL | Stubbed (returns 503) |

These are **independent codebases**. Changes to `backend/` do not propagate here. If a change affects shared logic (types, API contracts, ES mappings), update both.

## Vercel Runtime Gotchas

### `__dirname` is unreliable

`@vercel/node` bundles source with ncc/esbuild, changing the directory layout. `import.meta.url`-derived `__dirname` does not match the source tree at runtime. Use `process.cwd()` instead — it reliably returns `/var/task` in the Vercel runtime:

```typescript
// Correct
path.resolve(process.cwd(), 'data/f0_library/tests_source')

// Wrong — __dirname points to bundle internals
path.resolve(__dirname, '../../data/f0_library/tests_source')
```

### `includeFiles` required for static data

`@vercel/node` only bundles imported JS/TS modules. Static data (the cloned test library in `data/`) must be explicitly included in `vercel.json`:

```json
{ "src": "api/index.ts", "use": "@vercel/node", "config": { "includeFiles": "data/**" } }
```

### `.vercelignore` replaces `.gitignore`

When `.vercelignore` exists, Vercel uses it **instead of** `.gitignore` for upload filtering. Local `.env` files will leak into the build unless explicitly excluded in `.vercelignore`. The current `.vercelignore` excludes `.env`, `.env.*`, `data/`, `node_modules/`, `*.db`, and `.vercel`.

### `vercel-build` script must be idempotent

The build script runs `rm -rf data/f0_library` before `git clone` to handle re-deploys where the directory might already exist (from Vercel's build cache or a previous partial run). The git clone URL must be quoted to prevent shell word splitting on the parameter expansion.

### CORS_ORIGIN newline

When setting `CORS_ORIGIN` via CLI, use `printf` (no trailing newline) instead of `echo`. A trailing newline in the header value causes Express to return HTTP 500 with "Invalid character in header content":

```bash
printf "https://your-frontend.vercel.app" | vercel env add CORS_ORIGIN production
```

### Frontend Clerk key prefix

The frontend reads `VITE_CLERK_PUBLISHABLE_KEY` (with `VITE_` prefix). Vite only exposes `VITE_`-prefixed env vars to client-side code. The Docker/Railway deployments use `docker-entrypoint.sh` to inject `window.__env__` at runtime, bypassing this restriction.

## Environment Variables

Backend env vars are set in the Vercel Dashboard or via `vercel env add`. See `VERCEL.md` § Step 4 for the full table.

Critical variables:
- `ENCRYPTION_SECRET` — **required**, no fallback on Vercel (Docker backend derives one from machine ID)
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — Turso database connection
- `CORS_ORIGIN` — must exactly match frontend URL (no trailing slash or newline)
- `TESTS_REPO_URL` / `GITHUB_TOKEN` — test library cloned at build time

## Deployment

```bash
cd backend-serverless && npx vercel --prod   # Deploy backend
cd frontend && npx vercel --prod             # Deploy frontend
```

Both services must be redeployed when env vars change — Vercel bakes env vars into the build.
