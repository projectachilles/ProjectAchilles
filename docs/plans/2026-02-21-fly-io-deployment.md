# Fly.io Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy ProjectAchilles (backend + frontend) on Fly.io with custom domains, persistent storage, and Clerk auth.

**Architecture:** Two Fly.io apps running the existing Docker images. Backend has a 1 GB persistent volume for SQLite + certs + Go cache. Frontend serves static assets via nginx. Direct CORS between frontend and backend (no internal proxy). Re-uses the existing Vercel Clerk production app on `<your-frontend-domain>`.

**Tech Stack:** Fly.io Machines, Docker, fly.toml config, Playwright for dashboard operations

---

### Task 1: Create backend fly.toml

**Files:**
- Create: `backend/fly.toml`

**Step 1: Write the fly.toml configuration**

```toml
# Fly.io configuration for ProjectAchilles Backend
# Docs: https://fly.io/docs/reference/configuration/

app = 'achilles-backend'
primary_region = 'cdg'

[build]
  dockerfile = 'Dockerfile'

[env]
  NODE_ENV = 'production'
  PORT = '3000'

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 1

[checks]
  [checks.health]
    port = 3000
    type = 'http'
    interval = '30s'
    timeout = '5s'
    grace_period = '30s'
    method = 'GET'
    path = '/api/health'

[mounts]
  source = 'achilles_data'
  destination = '/root/.projectachilles'

[[vm]]
  memory = '512mb'
  cpu_kind = 'shared'
  cpus = 2
```

Notes for the implementer:
- `primary_region = 'cdg'` is Paris (closest to EU users). Adjust if needed.
- `auto_stop_machines = 'off'` — agents send heartbeats every 60s, cold starts would break monitoring.
- `[mounts]` attaches the persistent volume created in Task 3.
- The Dockerfile `EXPOSE 3000` matches `internal_port = 3000`.
- `grace_period = '30s'` gives the backend time to clone repos and init on first boot.

**Step 2: Verify fly.toml syntax**

Visually confirm: app name, port 3000, volume mount at `/root/.projectachilles`, health check path `/api/health`, shared-2x VM with 512 MB.

---

### Task 2: Create frontend fly.toml

**Files:**
- Create: `frontend/fly.toml`

**Step 1: Write the fly.toml configuration**

```toml
# Fly.io configuration for ProjectAchilles Frontend
# Docs: https://fly.io/docs/reference/configuration/

app = 'achilles-frontend'
primary_region = 'cdg'

[build]
  dockerfile = 'Dockerfile'

[http_service]
  internal_port = 80
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  memory = '256mb'
  cpu_kind = 'shared'
  cpus = 1
```

Notes for the implementer:
- Frontend Dockerfile serves via nginx on port 80, so `internal_port = 80`.
- No volume needed — frontend is a static SPA.
- Smallest VM (shared-1x, 256 MB) is plenty for nginx serving static files.
- No custom health check needed — Fly uses the default TCP check on port 80.

---

### Task 3: Create Fly.io apps and volume via dashboard (Playwright)

This task uses Playwright to navigate the Fly.io web dashboard.

**Step 1: Navigate to Fly.io dashboard**

Open `https://fly.io/dashboard`. If not authenticated, ask the user to log in.

**Step 2: Install flyctl CLI**

Fly.io app creation, volume creation, and secret management is much more efficient via CLI. Check if `flyctl` is available; if not, install it:

```bash
curl -L https://fly.io/install.sh | sh
```

Then authenticate:

```bash
flyctl auth login
```

This opens a browser for OAuth. Ask user to authenticate if needed.

**Step 3: Create the backend app**

```bash
cd backend
flyctl apps create achilles-backend --org personal
```

If the app name is taken, the user picks an alternative.

**Step 4: Create the persistent volume**

```bash
flyctl volumes create achilles_data --app achilles-backend --region cdg --size 1
```

The volume name `achilles_data` must match the `source` in `fly.toml [mounts]`.

**Step 5: Create the frontend app**

```bash
cd frontend
flyctl apps create achilles-frontend --org personal
```

---

### Task 4: Set backend environment variables (secrets)

Fly.io uses `flyctl secrets set` for sensitive env vars. These are encrypted at rest and injected as environment variables at runtime.

**Step 1: Set backend secrets**

The values come from the existing Vercel Clerk app and Elastic Cloud. Retrieve them from:
- Clerk Dashboard: `pk_live_*` and `sk_live_*` for the `<your-frontend-domain>` app
- Elastic Cloud console: Cloud ID and API key
- Existing GitHub token (same as other deployments)

```bash
flyctl secrets set \
  CLERK_PUBLISHABLE_KEY="pk_live_..." \
  CLERK_SECRET_KEY="sk_live_..." \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  ENCRYPTION_SECRET="$(openssl rand -base64 32)" \
  CORS_ORIGIN="https://<your-frontend-domain>" \
  AGENT_SERVER_URL="https://<your-backend-domain>" \
  TESTS_REPO_URL="https://github.com/your-org/f0_library.git" \
  TESTS_REPO_BRANCH="main" \
  AGENT_REPO_URL="https://github.com/your-org/ProjectAchilles.git" \
  AGENT_REPO_BRANCH="main" \
  GITHUB_TOKEN="ghp_..." \
  ELASTICSEARCH_CLOUD_ID="..." \
  ELASTICSEARCH_API_KEY="..." \
  --app achilles-backend
```

Notes:
- `SESSION_SECRET` and `ENCRYPTION_SECRET` are freshly generated (different from Render/Railway).
- `CORS_ORIGIN` = frontend custom domain. `AGENT_SERVER_URL` = backend custom domain.
- `TESTS_REPO_URL` and `AGENT_REPO_URL` use the same repos as other deployments.

**Step 2: Verify secrets are set**

```bash
flyctl secrets list --app achilles-backend
```

Should show all variable names (values are hidden).

---

### Task 5: Set frontend environment variables (secrets)

**Step 1: Set frontend secrets**

```bash
flyctl secrets set \
  CLERK_PUBLISHABLE_KEY="pk_live_..." \
  VITE_API_URL="https://<your-backend-domain>" \
  --app achilles-frontend
```

Notes:
- `CLERK_PUBLISHABLE_KEY` (without `VITE_` prefix) is used by `docker-entrypoint.sh` which injects it as `window.__env__.VITE_CLERK_PUBLISHABLE_KEY` at container start.
- `VITE_API_URL` is injected as `window.__env__.VITE_API_URL` — tells the frontend to call the backend directly via CORS.

---

### Task 6: Deploy both services

**Step 1: Deploy the backend**

```bash
cd backend
flyctl deploy --app achilles-backend
```

This builds the Docker image remotely on Fly's builders and deploys it. First build takes 3-5 minutes (Go toolchain is large).

**Step 2: Verify backend health**

```bash
curl https://achilles-backend.fly.dev/api/health
```

Expected: `{"status":"ok"}`

If the app name is different (due to name conflict), use the actual `.fly.dev` domain.

**Step 3: Deploy the frontend**

```bash
cd frontend
flyctl deploy --app achilles-frontend
```

**Step 4: Verify frontend loads**

Open `https://achilles-frontend.fly.dev` in Playwright. Should show the Clerk login page.

---

### Task 7: Configure custom domains on Fly.io

**Step 1: Add backend custom domain**

```bash
flyctl certs create <your-backend-domain> --app achilles-backend
```

Fly.io will show the required DNS records (typically a CNAME to `achilles-backend.fly.dev` or an A/AAAA record).

**Step 2: Add frontend custom domain**

```bash
flyctl certs create <your-frontend-domain> --app achilles-frontend
```

**Step 3: Note the DNS targets**

```bash
flyctl certs show <your-backend-domain> --app achilles-backend
flyctl certs show <your-frontend-domain> --app achilles-frontend
```

Record the CNAME/A/AAAA targets for DNS update in next task.

---

### Task 8: Update DNS records

The domains `<your-frontend-domain>` and `<your-backend-domain>` currently point to Vercel. Update them to point to Fly.io.

**Step 1: Navigate to DNS provider via Playwright**

Open the DNS management page for `projectachilles.io`. The provider may be Cloudflare, Route53, or another registrar.

**Step 2: Update DNS records**

| Record | Type | Old Target (Vercel) | New Target (Fly.io) |
|--------|------|-------------------|-------------------|
| `<frontend-subdomain>` | CNAME | `cname.vercel-dns.com` | Value from Task 7 Step 3 |
| `<backend-subdomain>` | CNAME | `cname.vercel-dns.com` | Value from Task 7 Step 3 |

Keep the `clerk.<frontend-subdomain>` CNAME unchanged — it still points to `frontend-api.clerk.services` for Clerk's sign-in pages.

**Step 3: Wait for DNS propagation**

```bash
dig <your-frontend-domain> CNAME +short
dig <your-backend-domain> CNAME +short
```

Verify they resolve to Fly.io targets.

**Step 4: Verify TLS certificates**

```bash
flyctl certs check <your-backend-domain> --app achilles-backend
flyctl certs check <your-frontend-domain> --app achilles-frontend
```

Fly auto-provisions Let's Encrypt certs once DNS propagates.

---

### Task 9: Verify Clerk configuration

The Clerk app was previously configured for Vercel. Since we're keeping the same domains (`<your-frontend-domain>`), the Clerk config should work unchanged.

**Step 1: Navigate to Clerk dashboard via Playwright**

Open `https://dashboard.clerk.com`. Navigate to the app configured for `<your-frontend-domain>`.

**Step 2: Verify allowed origins**

Check that `https://<your-frontend-domain>` is listed as an allowed origin.

**Step 3: Verify OAuth callback URL**

Confirm the GitHub and Google OAuth apps still use `https://clerk.<your-frontend-domain>/v1/oauth_callback` — this hasn't changed since the Clerk CNAME is unchanged.

**Step 4: Retrieve Clerk keys**

Copy `pk_live_*` and `sk_live_*` for use in Tasks 4-5 if not already set.

---

### Task 10: End-to-end verification

**Step 1: Backend health check on custom domain**

```bash
curl https://<your-backend-domain>/api/health
```

Expected: `{"status":"ok"}`

**Step 2: Frontend loads on custom domain**

Navigate to `https://<your-frontend-domain>` via Playwright. Should show the landing page.

**Step 3: Clerk login works**

Click "Sign in" and verify the Clerk sign-in page loads (hosted at `clerk.<your-frontend-domain>`). Try GitHub OAuth — should redirect to GitHub with a valid `client_id`.

**Step 4: Agent device endpoint**

```bash
curl https://<your-backend-domain>/api/agent/enroll
```

Expected: 401 Unauthorized (no API key provided) — confirms the endpoint is reachable.

**Step 5: Check backend logs for startup issues**

```bash
flyctl logs --app achilles-backend
```

Look for successful git clone of test library and agent source.

---

### Task 11: Write FLY.md documentation

**Files:**
- Create: `FLY.md` (project root)

**Step 1: Write the deployment guide**

Follow the same structure as `RENDER.md`:
- Architecture overview
- Prerequisites
- Setup steps (apps, volumes, secrets, deploy)
- Custom domains + DNS
- Clerk setup (reference existing production app or new)
- Persistent volume contents
- Cost estimate
- Troubleshooting

Include Fly.io-specific details:
- Volume attachment (`flyctl volumes create`)
- Secrets management (`flyctl secrets set`)
- Deployment (`flyctl deploy`)
- Logs (`flyctl logs`)
- SSH access (`flyctl ssh console`)

**Step 2: Update CLAUDE.md deployment table**

Add Fly.io row to the deployment table in `CLAUDE.md`:

```markdown
| **Fly.io** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | `FLY.md` |
```

---

### Task 12: Commit and push

**Step 1: Stage new files**

```bash
git add backend/fly.toml frontend/fly.toml FLY.md CLAUDE.md docs/plans/2026-02-21-fly-io-deployment-design.md docs/plans/2026-02-21-fly-io-deployment.md
```

**Step 2: Commit**

```bash
git commit -m "feat(fly): add Fly.io deployment config and documentation

Add fly.toml for backend (persistent volume, health check, shared-2x)
and frontend (nginx on port 80, shared-1x). FLY.md documents the full
deployment process including Clerk production OAuth, DNS, and volumes.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**Step 3: Push**

```bash
git push
```
