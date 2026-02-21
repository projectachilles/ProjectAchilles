# Deploying ProjectAchilles to Vercel

This guide covers deploying ProjectAchilles to [Vercel](https://vercel.com) using the serverless backend (`backend-serverless/`) and the standard Vite frontend, with Turso for the database, Vercel Blob for file storage, and Elastic Cloud for analytics.

## Architecture

Vercel runs two projects from this monorepo:

| Project | Root Directory | Runtime | Public Domain |
|---------|---------------|---------|---------------|
| **backend** | `backend-serverless/` | `@vercel/node` (serverless function) | Yes (agents connect here) |
| **frontend** | `frontend/` | Vite (static SPA) | Yes (users visit this) |

Unlike the Docker-based deployments (Railway, Render, Docker Compose), the Vercel backend is a purpose-built serverless fork that replaces filesystem-dependent services:

| Concern | Docker backend | Vercel backend |
|---------|---------------|----------------|
| Database | SQLite (better-sqlite3) | **Turso** (@libsql/client) |
| File storage | `~/.projectachilles/` directory | **Vercel Blob** |
| Signing keys | File system | **Environment variables** (Ed25519) |
| Encryption secret | Optional (machine-derived fallback) | **Required** |
| Test library | Runtime git sync (cron) | **Build-time clone** |
| Cron jobs | Optional | **Vercel Crons** (schedule processing, key rotation) |

## Prerequisites

- Vercel account ([vercel.com](https://vercel.com)) — **Pro plan** recommended (required for Cron jobs)
- Turso database ([turso.tech](https://turso.tech)) — free tier is sufficient
- GitHub repo with this project pushed
- Clerk application keys ([dashboard.clerk.com](https://dashboard.clerk.com)) — create a **separate** Clerk app for Vercel
- Elastic Cloud deployment ([cloud.elastic.co](https://cloud.elastic.co))
- GitHub Personal Access Token (if using a private test repo)

## Step 1: Create the Turso Database

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Authenticate
turso auth login

# Create database (choose a region close to your Vercel deployment)
turso db create projectachilles

# Get the connection URL
turso db show projectachilles --url
# → libsql://projectachilles-<your-org>.turso.io

# Create an auth token
turso db tokens create projectachilles
# → eyJhbGci...
```

Save both values — you'll need them as `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

> The backend automatically creates all tables on first connection. No manual schema setup is needed.

## Step 2: Generate Ed25519 Signing Keys

The agent update system uses Ed25519 keys to sign binary hashes. On Vercel, these are provided via environment variables instead of the filesystem.

```bash
# Generate a key pair and save to temp files
openssl genpkey -algorithm Ed25519 -outform DER -out /tmp/ed25519_private.der

# Encode private key (PKCS8 DER → base64)
SIGNING_PRIVATE_KEY_B64=$(base64 -w0 /tmp/ed25519_private.der)
echo "SIGNING_PRIVATE_KEY_B64=$SIGNING_PRIVATE_KEY_B64"

# Extract and encode public key (SPKI DER → base64)
SIGNING_PUBLIC_KEY_B64=$(openssl pkey -inform DER -in /tmp/ed25519_private.der -pubout -outform DER | base64 -w0)
echo "SIGNING_PUBLIC_KEY_B64=$SIGNING_PUBLIC_KEY_B64"

# Clean up
rm /tmp/ed25519_private.der
```

Save both base64 strings for Step 4.

## Step 3: Create Vercel Projects

You need **two separate Vercel projects**, both linked to the same GitHub repo with different root directories.

### Option A: Vercel Dashboard (Recommended)

1. Log in to [vercel.com](https://vercel.com)
2. Click **Add New → Project → Import Git Repository**
3. Select your ProjectAchilles repository

**For the backend:**
- **Root Directory**: `backend-serverless`
- **Framework Preset**: Other
- **Build Command**: auto-detected from `vercel-build` script
- **Output Directory**: leave default

**For the frontend:**
- **Root Directory**: `frontend`
- **Framework Preset**: Vite (auto-detected from `vercel.json`)
- **Build Command**: `npm run build`
- **Output Directory**: `dist`

### Option B: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Backend
cd backend-serverless
vercel link    # follow prompts to create/link project
cd ..

# Frontend
cd frontend
vercel link    # follow prompts to create/link project
cd ..
```

## Step 4: Set Environment Variables

Configure these in the Vercel Dashboard (**Settings → Environment Variables**) or via CLI (`vercel env add`).

### Backend (`backend-serverless`)

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | |
| `CLERK_PUBLISHABLE_KEY` | `pk_live_...` | From Clerk dashboard |
| `CLERK_SECRET_KEY` | `sk_live_...` | From Clerk dashboard |
| `SESSION_SECRET` | `openssl rand -base64 32` | Generate a random value |
| `ENCRYPTION_SECRET` | `openssl rand -base64 32` | **Required** — no fallback on Vercel |
| `TURSO_DATABASE_URL` | `libsql://projectachilles-...turso.io` | From Step 1 |
| `TURSO_AUTH_TOKEN` | `eyJhbGci...` | From Step 1 |
| `SIGNING_PRIVATE_KEY_B64` | Base64 string | From Step 2 |
| `SIGNING_PUBLIC_KEY_B64` | Base64 string | From Step 2 |
| `CORS_ORIGIN` | `https://<frontend>.vercel.app` | Your frontend's Vercel URL |
| `AGENT_SERVER_URL` | `https://<backend>.vercel.app` | Your backend's Vercel URL |
| `TESTS_REPO_URL` | `https://github.com/your-org/f0_library.git` | Test library repo |
| `TESTS_REPO_BRANCH` | `main` | |
| `GITHUB_TOKEN` | `ghp_...` | PAT with `repo` scope |
| `ELASTICSEARCH_CLOUD_ID` | From Elastic Cloud console | |
| `ELASTICSEARCH_API_KEY` | From Elastic Cloud console | |

### Frontend (`frontend`)

| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_...` or `pk_live_...` | **Must** have `VITE_` prefix for Vite to expose it |
| `VITE_API_URL` | `https://<backend>.vercel.app` | Backend's Vercel URL |

> **Tip:** After the first deployment, update `CORS_ORIGIN`, `AGENT_SERVER_URL`, and `VITE_API_URL` with the actual assigned `.vercel.app` domains, then redeploy.

## Step 5: Configure Clerk

Create a **separate Clerk application** for your Vercel deployment:

1. In [dashboard.clerk.com](https://dashboard.clerk.com), create a new application
2. Under **Domains → Allowed Origins**, add your Vercel frontend URL (e.g., `https://achilles-frontend.vercel.app`)
3. Under **Allowed Redirect URLs**, add `https://<frontend>.vercel.app/*`
4. If using a custom domain, add that too
5. Copy the publishable key and secret key to both projects' environment variables

## Step 6: Deploy

```bash
# Deploy both projects to production
cd backend-serverless && vercel --prod && cd ..
cd frontend && vercel --prod && cd ..
```

Or simply push to GitHub — Vercel auto-deploys on push if you connected the repo.

## Step 7: Verify

```bash
# Health check
curl https://<backend>.vercel.app/api/health

# Capabilities (confirms serverless mode)
curl https://<backend>.vercel.app/api/capabilities
# → {"build":false,"certGenerate":false,"certUpload":true,"gitSync":false,"agentBuild":false,"platform":"vercel"}
```

1. Visit your frontend URL — you should see the Clerk login page
2. After logging in, go to **Analytics → Setup** and verify the Elastic Cloud connection
3. Check the test browser to confirm the test library was cloned at build time

## Cron Jobs

The backend defines two Vercel Cron jobs in `vercel.json`:

| Schedule | Endpoint | Purpose |
|----------|----------|---------|
| Every minute | `/api/cron/schedules` | Process pending test execution schedules |
| Every minute | `/api/cron/auto-rotation` | Rotate agent API keys (configurable interval, default 90 days) |

Cron jobs are protected by `CRON_SECRET`, which Vercel auto-injects — no manual configuration needed. Cron jobs require the **Pro plan** or above.

To verify crons are running, check the Vercel Dashboard → your backend project → **Crons** tab.

## Test Library

Unlike the Docker backend (which syncs the test library via git at runtime), the Vercel backend clones the test library **at build time** via the `vercel-build` script:

```bash
git clone --depth 1 https://x-access-token:${GITHUB_TOKEN}@github.com/... data/f0_library
```

This means:
- **Test library updates require a redeploy** (push to GitHub or trigger manually)
- The "Sync" button in the UI is disabled on Vercel (`gitSync: false` in `/api/capabilities`)
- Build logs will show the clone step

## What's Not Available on Vercel

| Feature | Status | Reason |
|---------|--------|--------|
| Go agent builds | 503 | Vercel has no Go toolchain |
| Certificate generation | 503 | No `openssl` binary |
| Certificate upload | Available | Stored in Vercel Blob |
| Runtime git sync | Disabled | No persistent filesystem — tests cloned at build time |
| Agent binary upload | Available | Stored in Vercel Blob |

Build agents locally and upload them through the UI. The frontend automatically hides unavailable features based on the `/api/capabilities` response.

## Custom Domains

1. In Vercel Dashboard → your project → **Settings → Domains**
2. Add your domain (e.g., `achilles.example.com`)
3. Add the DNS records Vercel provides (CNAME or A record)
4. Vercel automatically provisions a TLS certificate
5. Update `CORS_ORIGIN` on the backend to match the frontend's custom domain
6. Update `AGENT_SERVER_URL` if agents should use the backend's custom domain
7. Update Clerk allowed origins

## Cost Estimate

| Service | Est. Monthly Cost |
|---------|------------------|
| Vercel Pro (both projects) | $20 |
| Turso (free tier: 9 GB, 500M rows read) | $0 |
| Vercel Blob (1 GB included on Pro) | $0 |
| **Total** | **~$20** |

For comparison: Railway ~$10-13/mo (usage-based), Render ~$14/mo (flat rate). The Vercel Pro plan includes both projects, cron jobs, and Blob storage. See [Vercel pricing](https://vercel.com/pricing) for current rates.

## Gotchas

### Local `.env` files leak into Vercel builds

Vercel uploads all files not excluded by `.vercelignore`. If `.vercelignore` exists, it **completely replaces** `.gitignore` for the upload filter — `.gitignore` exclusions are ignored. Both `backend-serverless/.vercelignore` and `frontend/.vercelignore` exclude `.env` and `.env.*` to prevent local environment variables from overriding Vercel env vars at runtime (via `dotenv.config()`).

If you add new ignore patterns, add them to **both** `.gitignore` and `.vercelignore`.

### `CORS_ORIGIN` must not contain trailing whitespace or newlines

When setting `CORS_ORIGIN` via the Vercel CLI with `echo ... | vercel env add`, `echo` appends a trailing newline. This newline gets stored in the env var and causes Express to set an invalid `Access-Control-Allow-Origin` header, resulting in HTTP 500 on every request. Use `printf` (no trailing newline) instead:

```bash
# Correct — no trailing newline
printf "https://your-frontend.vercel.app" | vercel env add CORS_ORIGIN production

# Wrong — echo adds \n which breaks CORS
echo "https://your-frontend.vercel.app" | vercel env add CORS_ORIGIN production
```

### `__dirname` is unreliable in `@vercel/node`

`@vercel/node` bundles TypeScript source with ncc/esbuild, which changes the directory layout at runtime. `__dirname` (derived from `import.meta.url`) points to the bundled output location, not the source tree. Use `process.cwd()` instead — it reliably returns `/var/task` in the Vercel runtime:

```typescript
// Correct — works in Vercel
path.resolve(process.cwd(), 'data/f0_library/tests_source')

// Wrong — __dirname points to bundle internals
path.resolve(__dirname, '../../data/f0_library/tests_source')
```

### Frontend Clerk key must use `VITE_` prefix

Vite only exposes env vars prefixed with `VITE_` to client-side code via `import.meta.env`. The frontend reads `VITE_CLERK_PUBLISHABLE_KEY` — setting `CLERK_PUBLISHABLE_KEY` (without prefix) on the frontend project has no effect. The Docker/Railway deployments work differently because `docker-entrypoint.sh` injects `window.__env__` at runtime.

### Clerk custom domains require DNS setup

If you create a Clerk application with a custom domain (e.g., `clerk.yourdomain.com`), Clerk issues `pk_live_` keys even in Development mode and routes all JS loading through that domain. Without a DNS CNAME record pointing to Clerk's servers, the browser gets `ERR_NAME_NOT_RESOLVED`. For initial setup, create the Clerk app **without** a custom domain to get standard `pk_test_`/`sk_test_` keys that use `*.clerk.accounts.dev` (no DNS required). Add a custom domain later when ready for production.

### `includeFiles` required for static data

`@vercel/node` only bundles imported JavaScript/TypeScript modules. Static data files (like the cloned test library in `data/`) must be explicitly included via `includeFiles` in `vercel.json`:

```json
{ "src": "api/index.ts", "use": "@vercel/node", "config": { "includeFiles": "data/**" } }
```

Without this, the test library directory won't exist at runtime even though it was cloned during the build step.

## Troubleshooting

### Frontend API calls return CORS errors
`CORS_ORIGIN` on the backend doesn't match the frontend's actual URL. Verify:
- The value includes the protocol (`https://`)
- It matches exactly (no trailing slash, no trailing newline — see Gotchas above)
- If using a custom domain, update `CORS_ORIGIN` to the custom domain

### `ENCRYPTION_SECRET` errors
Unlike the Docker backend, the Vercel backend has **no fallback** for `ENCRYPTION_SECRET`. It must be set. If you see encryption-related errors, verify the variable is set in Vercel's environment settings and redeploy.

### Test library is empty or outdated
The test library is cloned at build time. To update:
1. Verify `TESTS_REPO_URL` and `GITHUB_TOKEN` are set correctly
2. Trigger a redeploy (push a commit or click **Redeploy** in the Vercel Dashboard)
3. Check build logs for the git clone step

### Agent enrollment commands show wrong URL
Set `AGENT_SERVER_URL` to the backend's public Vercel domain (with `https://`).

### Analytics shows "not configured"
The Elastic Cloud connection is stored encrypted in Vercel Blob. If `ENCRYPTION_SECRET` changed, the stored settings become unreadable. Reconfigure via Analytics → Setup, or set `ELASTICSEARCH_CLOUD_ID` and `ELASTICSEARCH_API_KEY` as env vars (env vars take priority over stored settings).

### Cron jobs not running
- Verify you're on the Vercel **Pro plan** (crons aren't available on Hobby)
- Check the **Crons** tab in the Vercel Dashboard for execution history
- Cron jobs only run in the **Production** environment, not Preview deployments

### Cold starts
Vercel serverless functions may experience cold starts (~1-2 seconds) after periods of inactivity. This affects the first API request after idle time. Subsequent requests within the same invocation window are fast. For agents reporting results, this is usually not an issue — the agent retries on timeout.
