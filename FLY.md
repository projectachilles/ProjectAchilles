# Deploying ProjectAchilles to Fly.io

This guide covers deploying ProjectAchilles to [Fly.io](https://fly.io) using Docker Machines with persistent volumes, with Elastic Cloud for analytics.

## Architecture

Fly.io runs two Machines (Docker containers) from this monorepo:

| Service | Fly App | Dockerfile | Custom Domain |
|---------|---------|------------|---------------|
| **achilles-backend** | `achilles-backend` | `backend/Dockerfile` | `rga.agent.projectachilles.io` |
| **achilles-frontend** | `achilles-frontend` | `frontend/Dockerfile` | `rga.projectachilles.io` |

The frontend calls the backend directly via CORS (using `VITE_API_URL`). No internal networking is needed. Elasticsearch is handled externally by Elastic Cloud.

Both Machines run always-on (no auto-stop) — agents send heartbeats every 60s, and cold starts would break monitoring.

## Prerequisites

- Fly.io account ([fly.io](https://fly.io))
- `flyctl` CLI installed (`curl -L https://fly.io/install.sh | sh`)
- GitHub repo with this project pushed
- Clerk application keys ([dashboard.clerk.com](https://dashboard.clerk.com))
- Elastic Cloud deployment ([cloud.elastic.co](https://cloud.elastic.co))
- GitHub Personal Access Token (if using a private test repo)

## Setup

### Step 1: Create Apps

```bash
flyctl auth login

# Create backend app
flyctl apps create achilles-backend --org personal

# Create frontend app
flyctl apps create achilles-frontend --org personal
```

If app names are taken, choose alternatives and update `fly.toml` accordingly.

### Step 2: Create Persistent Volume

```bash
flyctl volumes create achilles_data --app achilles-backend --region cdg --size 1
```

The volume name `achilles_data` must match the `source` in `backend/fly.toml [mounts]`. The `--region` must match the `primary_region` in `fly.toml`.

### Step 3: Set Backend Secrets

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
  ELASTICSEARCH_CLOUD_ID="<from Elastic Cloud console>" \
  ELASTICSEARCH_API_KEY="<from Elastic Cloud console>" \
  --app achilles-backend
```

### Step 4: Set Frontend Secrets

```bash
flyctl secrets set \
  CLERK_PUBLISHABLE_KEY="pk_live_..." \
  VITE_API_URL="https://<your-backend-domain>" \
  --app achilles-frontend
```

> **Note:** `CLERK_PUBLISHABLE_KEY` (without `VITE_` prefix) is used by `docker-entrypoint.sh`, which injects it as `window.__env__.VITE_CLERK_PUBLISHABLE_KEY` at container start. `VITE_API_URL` is injected as `window.__env__.VITE_API_URL` — tells the frontend to call the backend directly via CORS.

### Step 5: Deploy

```bash
# Deploy backend (first build takes 3-5 minutes — Go toolchain is large)
cd backend && flyctl deploy --app achilles-backend

# Deploy frontend
cd frontend && flyctl deploy --app achilles-frontend
```

### Step 6: Verify

```bash
# Backend health
curl https://achilles-backend.fly.dev/api/health
# Expected: {"status":"ok","service":"ProjectAchilles",...}

# Agent endpoint reachability
curl -o /dev/null -w "%{http_code}" https://achilles-backend.fly.dev/api/agent/enroll
# Expected: 401 (no API key)
```

Visit `https://achilles-frontend.fly.dev` — you should see the landing page.

## Custom Domains

### Step 1: Add Certificates

```bash
flyctl certs create <your-backend-domain> --app achilles-backend
flyctl certs create <your-frontend-domain> --app achilles-frontend
```

Fly.io shows the required DNS records (A and AAAA).

### Step 2: DNS Records

Add A and AAAA records in your DNS provider. Fly.io uses dedicated IPs (not CNAME):

| Record | Type | Target |
|--------|------|--------|
| `<backend-subdomain>` | A | IP from `flyctl certs show` |
| `<backend-subdomain>` | AAAA | IPv6 from `flyctl certs show` |
| `<frontend-subdomain>` | A | IP from `flyctl certs show` |
| `<frontend-subdomain>` | AAAA | IPv6 from `flyctl certs show` |
| `clerk.<frontend-subdomain>` | CNAME | `frontend-api.clerk.services` |

> The Clerk CNAME is only needed if you're using a Clerk production instance with custom domains. Clerk provides the exact CNAME target in its Dashboard under **Domains**.

### Step 3: Verify DNS and TLS

```bash
# Check DNS propagation
getent hosts <your-frontend-domain>
getent hosts <your-backend-domain>

# Check TLS certificates (auto-provisioned by Let's Encrypt)
flyctl certs check <your-backend-domain> --app achilles-backend
flyctl certs check <your-frontend-domain> --app achilles-frontend
```

### Step 4: Update Environment Variables

After DNS propagates and TLS certificates are issued:

| Variable | App | New Value |
|----------|-----|-----------|
| `CORS_ORIGIN` | Backend | `https://<your-frontend-domain>` |
| `AGENT_SERVER_URL` | Backend | `https://<your-backend-domain>` |
| `VITE_API_URL` | Frontend | `https://<your-backend-domain>` |

```bash
flyctl secrets set CORS_ORIGIN="https://<frontend>" AGENT_SERVER_URL="https://<backend>" --app achilles-backend
flyctl secrets set VITE_API_URL="https://<backend>" --app achilles-frontend
```

## Clerk Setup

You can either create a new Clerk application or re-assign an existing one.

### Using an Existing Clerk App

If you already have a Clerk production instance configured for your domains (e.g., from a Vercel deployment), you can re-use the same keys. The Clerk configuration is domain-based — as long as the custom domains match, the same `pk_live_` / `sk_live_` keys and OAuth credentials work across any hosting provider.

Requirements:
- The Clerk app's production domain matches your frontend custom domain
- The `clerk.<domain>` CNAME still points to `frontend-api.clerk.services`
- OAuth callback URLs (`https://clerk.<domain>/v1/oauth_callback`) remain valid

### Creating a New Clerk App

Follow the same process as Render — see `RENDER.md` → "Clerk Setup" for the full walkthrough including production instance setup and OAuth credential configuration.

## Persistent Volume

The backend uses a 1 GB volume at `/root/.projectachilles`:

| Path | Purpose |
|------|---------|
| `agents.db` | SQLite database (agents, tokens, tasks, schedules) |
| `analytics.json` | Encrypted Elasticsearch connection settings |
| `tests.json` | Test repository configuration |
| `certs/` | Code signing certificates (max 5, subdirectory per cert) |
| `binaries/` | Built agent binaries organized by `<os>-<arch>/` |
| `go-cache/mod/` | Go module cache (persisted across redeploys) |
| `go-cache/build/` | Go build cache (persisted across redeploys) |
| `agent-source/` | Sparse-checkout clone of the agent Go source |

> **Important:** Fly.io volumes are tied to a single Machine in a single region. This is fine because SQLite doesn't support multi-machine concurrency. If you destroy and recreate a Machine, the volume data persists as long as the volume itself isn't deleted.

## Agent Build from Source

The backend Docker image includes Go 1.24.3, so agent cross-compilation works on Fly.io — same as Railway and Render. Set `AGENT_REPO_URL` and the backend clones the `agent/` subdirectory at startup (sparse checkout), then uses it for Go cross-compilation.

If `AGENT_REPO_URL` is not set, the backend disables the build feature. You can still upload pre-built binaries manually.

## Useful Commands

```bash
# View logs
flyctl logs --app achilles-backend
flyctl logs --app achilles-frontend

# SSH into a running Machine
flyctl ssh console --app achilles-backend

# Check Machine status
flyctl status --app achilles-backend
flyctl status --app achilles-frontend

# List volumes
flyctl volumes list --app achilles-backend

# List secrets (names only, values hidden)
flyctl secrets list --app achilles-backend

# Scale Machine resources
flyctl scale vm shared-cpu-2x --app achilles-backend
flyctl scale memory 512 --app achilles-backend

# Restart a Machine
flyctl apps restart achilles-backend
```

## Cost Estimate

| Service | Est. Monthly Cost |
|---------|------------------|
| Backend Machine (shared-2x, 512 MB) | ~$5 |
| Frontend Machine (shared-1x, 256 MB) | ~$3 |
| Volume (1 GB) | ~$0.15 |
| **Total** | **~$8** |

For comparison: Railway ~$10-13/mo (usage-based), Render ~$14/mo (flat rate). See [Fly.io pricing](https://fly.io/docs/about/pricing/) for current rates.

## Troubleshooting

### Frontend shows nginx "502 Bad Gateway" or fails to start

**Symptom:** The frontend container crashes at startup with `[emerg] host not found in upstream "backend"`.

**Cause:** The nginx config hardcodes `proxy_pass http://backend:3000` for Docker Compose. On Fly.io, there's no "backend" DNS name, so nginx can't resolve the upstream.

**Fix:** Set `VITE_API_URL` on the frontend app. The `docker-entrypoint.sh` script detects this and removes the `/api/` and `/ws` proxy blocks from nginx.conf, switching to direct CORS mode.

### Frontend shows CORS errors

The backend's `CORS_ORIGIN` doesn't match the frontend's origin. Verify:
- `CORS_ORIGIN` is set to the frontend's **full URL** with scheme (e.g., `https://achilles-frontend.fly.dev`)
- Include `https://` — the scheme is required

### Encrypted settings lost after redeploy

`ENCRYPTION_SECRET` is not set. Without it, the backend derives a key from the container's hostname, which changes across deploys. Set a stable `ENCRYPTION_SECRET` via `flyctl secrets set`.

### Agent enrollment commands show wrong URL

Set `AGENT_SERVER_URL` to the backend's public domain (with `https://`).

### TLS certificate not provisioning

```bash
flyctl certs check <domain> --app <app-name>
```

Verify DNS records point to the correct Fly.io IPs. Certificates are auto-provisioned by Let's Encrypt once DNS propagates (usually within minutes).

### Volume data not persisting

Verify the volume is attached:
```bash
flyctl volumes list --app achilles-backend
```

The volume `achilles_data` must exist in the same region as the Machine. Check `fly.toml` has `[mounts]` with matching `source` name.

### GitHub/Google login returns 404

See `RENDER.md` → "Troubleshooting" → "GitHub/Google login returns 404 or fails". The fix is the same: configure OAuth credentials in the Clerk production instance.

### Build times are slow

First builds take 3-5 minutes (Fly's remote builders download the Docker image layers). Subsequent builds reuse cached layers. Go agent builds benefit from the persistent volume cache — first build downloads Go modules (~30s), subsequent builds reuse the cache.
