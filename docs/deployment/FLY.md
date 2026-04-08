# Deploying ProjectAchilles to Fly.io

This guide covers deploying ProjectAchilles to [Fly.io](https://fly.io) using Docker Machines with persistent volumes, with Elastic Cloud for analytics.

## Architecture

Fly.io runs two Machines (Docker containers) from this monorepo:

| Service | Root Directory | Dockerfile | Public Domain |
|---------|---------------|------------|---------------|
| **achilles-backend** | `backend/` | `backend/Dockerfile` | Yes (agents connect here) |
| **achilles-frontend** | `frontend/` | `frontend/Dockerfile` | Yes (users visit this) |

The frontend calls the backend directly via CORS (using `VITE_API_URL`). No internal networking is needed — Fly.io does support private networking (`.internal` DNS), but direct CORS is simpler and consistent with the Render Starter deployment. Elasticsearch is handled externally by Elastic Cloud.

Both Machines run always-on (`auto_stop_machines = 'off'`) — agents send heartbeats every 60s, and cold starts would break monitoring.

## Prerequisites

- Fly.io account ([fly.io](https://fly.io))
- `flyctl` CLI installed (`curl -L https://fly.io/install.sh | sh`)
- GitHub repo with this project pushed
- Clerk application keys ([dashboard.clerk.com](https://dashboard.clerk.com)) — create a new app or re-assign an existing one
- Elastic Cloud deployment ([cloud.elastic.co](https://cloud.elastic.co))
- GitHub Personal Access Token (if using a private test repo)

## Step 1: Create the Fly.io Apps

```bash
flyctl auth login

# Create backend app
flyctl apps create achilles-backend --org personal

# Create frontend app
flyctl apps create achilles-frontend --org personal
```

If app names are taken, choose alternatives and update the `app` field in each `fly.toml` accordingly.

## Step 2: Create Persistent Volume

```bash
flyctl volumes create achilles_data --app achilles-backend --region cdg --size 1
```

The volume name `achilles_data` must match the `source` in `backend/fly.toml [mounts]`. The `--region` must match the `primary_region` in `fly.toml` (default: `cdg` / Paris).

## Step 3: Set Backend Environment Variables

Fly.io uses `flyctl secrets set` for environment variables. These are encrypted at rest and injected at runtime.

```bash
flyctl secrets set \
  CLERK_PUBLISHABLE_KEY="pk_live_..." \
  CLERK_SECRET_KEY="sk_live_..." \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  ENCRYPTION_SECRET="$(openssl rand -base64 32)" \
  CLI_AUTH_SECRET="$(openssl rand -base64 32)" \
  CORS_ORIGIN="https://<your-frontend>.fly.dev" \
  AGENT_SERVER_URL="https://<your-backend>.fly.dev" \
  TESTS_REPO_URL="https://github.com/your-org/f0_library.git" \
  TESTS_REPO_BRANCH="main" \
  AGENT_REPO_URL="https://github.com/your-org/ProjectAchilles.git" \
  AGENT_REPO_BRANCH="main" \
  GITHUB_TOKEN="ghp_..." \
  ELASTICSEARCH_CLOUD_ID="<from Elastic Cloud console>" \
  ELASTICSEARCH_API_KEY="<from Elastic Cloud console>" \
  --app achilles-backend
```

| Variable | Value | Notes |
|----------|-------|-------|
| `CLERK_PUBLISHABLE_KEY` | `pk_live_...` | From Clerk dashboard |
| `CLERK_SECRET_KEY` | `sk_live_...` | From Clerk dashboard |
| `SESSION_SECRET` | `<openssl rand -base64 32>` | Generate a random secret |
| `ENCRYPTION_SECRET` | `<openssl rand -base64 32>` | **Required** — see note below |
| `CLI_AUTH_SECRET` | `<openssl rand -base64 32>` | **Required** for CLI login (`achilles login`) |
| `CORS_ORIGIN` | `https://<your-frontend>.fly.dev` | Your frontend's Fly URL |
| `AGENT_SERVER_URL` | `https://<your-backend>.fly.dev` | Your backend's Fly URL |
| `TESTS_REPO_URL` | `https://github.com/your-org/f0_library.git` | Test library repo |
| `TESTS_REPO_BRANCH` | `main` | |
| `AGENT_REPO_URL` | `https://github.com/your-org/ProjectAchilles.git` | Agent source for builds |
| `AGENT_REPO_BRANCH` | `main` | |
| `GITHUB_TOKEN` | `ghp_...` | PAT with `repo` scope |
| `ELASTICSEARCH_CLOUD_ID` | From Elastic Cloud console | |
| `ELASTICSEARCH_API_KEY` | From Elastic Cloud console | |

> **`ENCRYPTION_SECRET` is required on Fly.io.** Without it, the backend derives a key from the container's hostname, which changes across deploys and corrupts encrypted settings.

## Step 4: Set Frontend Environment Variables

```bash
flyctl secrets set \
  CLERK_PUBLISHABLE_KEY="pk_live_..." \
  VITE_API_URL="https://<your-backend>.fly.dev" \
  --app achilles-frontend
```

| Variable | Value | Notes |
|----------|-------|-------|
| `CLERK_PUBLISHABLE_KEY` | `pk_live_...` | Same publishable key as backend |
| `VITE_API_URL` | `https://<your-backend>.fly.dev` | Backend's public URL (direct CORS) |

> **Note:** `CLERK_PUBLISHABLE_KEY` (without `VITE_` prefix) is used by `docker-entrypoint.sh`, which injects it as `window.__env__.VITE_CLERK_PUBLISHABLE_KEY` at container start. `VITE_API_URL` is injected as `window.__env__.VITE_API_URL` — tells the frontend to call the backend directly via CORS.

## Step 5: Deploy

```bash
# Deploy backend (first build takes 3-5 minutes — Go toolchain is large)
cd backend && flyctl deploy --app achilles-backend

# Deploy frontend
cd frontend && flyctl deploy --app achilles-frontend
```

Fly.io builds the Docker image remotely on its builders and deploys it to a Machine. Subsequent builds reuse cached Docker layers and are faster.

## Step 6: Verify

```bash
# Backend health
curl https://<your-backend>.fly.dev/api/health
# Expected: {"status":"ok","service":"ProjectAchilles",...}

# Agent endpoint reachability
curl -o /dev/null -w "%{http_code}" https://<your-backend>.fly.dev/api/agent/enroll
# Expected: 401 (no API key)
```

1. Visit `https://<your-frontend>.fly.dev` — you should see the landing page
2. Click "Sign In" and verify the Clerk login page loads
3. After logging in, go to **Analytics → Setup** and verify the Elastic Cloud connection

## Inter-Service Networking

The frontend calls the backend directly via CORS using the `VITE_API_URL` environment variable (set to the backend's public `https://<app>.fly.dev` URL). The `docker-entrypoint.sh` script detects `VITE_API_URL` and removes the nginx proxy blocks (`/api/` and `/ws`) that would otherwise fail to resolve the hardcoded Docker Compose `backend` hostname.

Fly.io does support [private networking](https://fly.io/docs/networking/private-networking/) using `.internal` DNS between apps in the same organization. If you prefer to keep the backend private, you could set `BACKEND_HOST=<backend-app>.internal` on the frontend instead of `VITE_API_URL`. However, direct CORS is simpler and consistent with other deployments.

| Mode | Frontend → Backend | Env Var | Backend Exposure |
|------|-------------------|---------|-----------------|
| Direct CORS (default) | Public URL | `VITE_API_URL=https://<backend>.fly.dev` | Public |
| Private network | nginx proxy via `.internal` DNS | `BACKEND_HOST=<backend-app>.internal` | Can be private |

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

> **Go cache persistence:** The Go module and build caches (`go-cache/`) are stored on the persistent volume so that `go mod download` and compilation results survive container redeploys. Without this, every agent build would re-download all Go dependencies and recompile from scratch, adding 1-2 minutes per build.

## Deploying Updates

Fly.io does not auto-deploy from GitHub. To deploy new code:

```bash
# Redeploy after code changes
cd backend && flyctl deploy --app achilles-backend
cd frontend && flyctl deploy --app achilles-frontend
```

For CI/CD automation, add `flyctl deploy` to your GitHub Actions workflow. Fly.io provides a [setup-flyctl](https://github.com/superfly/flyctl-actions) GitHub Action:

```yaml
- uses: superfly/flyctl-actions/setup-flyctl@master
- run: flyctl deploy --app achilles-backend
  working-directory: backend
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Generate a deploy token with `flyctl tokens create deploy --app achilles-backend` and add it as a GitHub Actions secret.

## Custom Domains

### Step 1: Add Certificates

```bash
flyctl certs create <your-backend-domain> --app achilles-backend
flyctl certs create <your-frontend-domain> --app achilles-frontend
```

Fly.io shows the required DNS records (A and AAAA IPs).

### Step 2: DNS Records

Add A and AAAA records in your DNS provider. Unlike Render and Vercel (which use CNAMEs), Fly.io uses dedicated IP addresses:

| Record | Type | Target |
|--------|------|--------|
| `<frontend-subdomain>` | A | IPv4 from `flyctl certs show` |
| `<frontend-subdomain>` | AAAA | IPv6 from `flyctl certs show` |
| `<backend-subdomain>` | A | IPv4 from `flyctl certs show` |
| `<backend-subdomain>` | AAAA | IPv6 from `flyctl certs show` |
| `clerk.<frontend-subdomain>` | CNAME | `frontend-api.clerk.services` |

> The Clerk CNAME is only needed if you're using a Clerk production instance with custom domains. Clerk provides the exact CNAME target in its Dashboard under **Domains**.

### Step 3: Verify DNS and TLS

```bash
# Check DNS propagation
dig <your-frontend-domain> A +short
dig <your-backend-domain> A +short

# Check TLS certificates (auto-provisioned by Let's Encrypt)
flyctl certs check <your-backend-domain> --app achilles-backend
flyctl certs check <your-frontend-domain> --app achilles-frontend
```

Certificates are auto-provisioned by Let's Encrypt once DNS propagates (usually within minutes).

### Step 4: Update Environment Variables

After DNS propagates and TLS certificates are issued, update the URLs to use custom domains:

| Variable | App | New Value |
|----------|-----|-----------|
| `CORS_ORIGIN` | Backend | `https://<your-frontend-domain>` |
| `AGENT_SERVER_URL` | Backend | `https://<your-backend-domain>` |
| `VITE_API_URL` | Frontend | `https://<your-backend-domain>` |

```bash
flyctl secrets set CORS_ORIGIN="https://<frontend-domain>" AGENT_SERVER_URL="https://<backend-domain>" --app achilles-backend
flyctl secrets set VITE_API_URL="https://<backend-domain>" --app achilles-frontend
```

> **Important:** `CORS_ORIGIN` and `AGENT_SERVER_URL` must be full URLs with the `https://` scheme. `VITE_API_URL` tells the frontend where to send API calls.

## Clerk Setup

You can either create a new Clerk application or re-assign an existing one.

### Using an Existing Clerk App

If you already have a Clerk production instance configured for your domains (e.g., from a Vercel or Render deployment), you can re-use the same keys. Clerk configuration is domain-based — as long as the custom domains match, the same `pk_live_` / `sk_live_` keys and OAuth credentials work across any hosting provider.

Requirements:
- The Clerk app's production domain matches your frontend custom domain
- The `clerk.<domain>` CNAME still points to `frontend-api.clerk.services`
- OAuth callback URLs (`https://clerk.<domain>/v1/oauth_callback`) remain valid

### Creating a New Clerk App

Create a **separate Clerk application** for your Fly.io deployment. Clerk development and production instances behave differently — production requires additional OAuth configuration.

#### Step 1: Create Application

1. In [dashboard.clerk.com](https://dashboard.clerk.com), create a new application
2. Enable desired social providers (GitHub, Google, etc.)
3. Copy the publishable key (`pk_test_...`) and secret key (`sk_test_...`) to both apps' secrets

#### Step 2: Add Production Instance (for custom domains)

When you're ready to use custom domains instead of `*.fly.dev`:

1. In Clerk Dashboard, go to **Configure** → **Production**
2. Add your custom domain — Clerk will provide DNS records to add (a CNAME for `clerk.<your-domain>`)
3. After DNS verification, Clerk generates **production keys** (`pk_live_...` / `sk_live_...`)
4. Update `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on **both** Fly apps with the production keys

> **Important:** Development keys (`pk_test_`) and production keys (`pk_live_`) are not interchangeable. After switching to production, the development keys stop working for that instance.

#### Step 3: Configure OAuth Credentials (Production Only)

**This step is critical.** Clerk development instances use Clerk's shared OAuth credentials for social providers — login works out of the box. **Production instances require your own OAuth credentials.** Without them, social login buttons will redirect to the provider with an empty `client_id`, resulting in a 404 error.

**GitHub OAuth:**

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**
2. Set **Authorization callback URL** to `https://clerk.<your-domain>/v1/oauth_callback`
3. After creation, generate a **Client Secret**
4. In Clerk Dashboard → **Configure** → **SSO Connections** → **GitHub**: enter Client ID and Client Secret

**Google OAuth:**

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URI: `https://clerk.<your-domain>/v1/oauth_callback`
4. In Clerk Dashboard → **Configure** → **SSO Connections** → **Google**: enter Client ID and Client Secret

## Agent Build from Source

The backend Docker image includes Go 1.24.3, so agent cross-compilation works on Fly.io — same as Railway and Render. Set `AGENT_REPO_URL` and the backend clones the `agent/` subdirectory at startup (sparse checkout), then uses it for Go cross-compilation.

| Variable | Value | Notes |
|----------|-------|-------|
| `AGENT_REPO_URL` | `https://github.com/your-org/ProjectAchilles.git` | Required for agent builds |
| `AGENT_REPO_BRANCH` | `main` | Branch to clone from |
| `GITHUB_TOKEN` | `ghp_...` | Required if the repo is private |

If `AGENT_REPO_URL` is not set, the backend disables the build feature and shows "Agent build from source is not available" in the UI. You can still upload pre-built binaries manually.

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

For comparison: Railway ~$10-13/mo (usage-based), Render ~$14/mo (flat rate), Vercel ~$20/mo (Pro plan). See [Fly.io pricing](https://fly.io/docs/about/pricing/) for current rates.

## Helper Scripts

Generate all secrets in `flyctl` format:

```bash
./scripts/generate-secrets.sh --target fly --format flyctl
# Output: flyctl secrets set SESSION_SECRET=... ENCRYPTION_SECRET=... CLI_AUTH_SECRET=...
```

Interactive setup wizard:

```bash
./scripts/setup.sh    # Select: PaaS → Fly.io
```

Initialize Elasticsearch indices on Elastic Cloud:

```bash
./scripts/init-elasticsearch.sh --cloud-id "deploy:..." --api-key "..."
```

## Troubleshooting

### Frontend shows nginx "502 Bad Gateway" or fails to start

**Symptom:** The frontend container crashes at startup with `[emerg] host not found in upstream "backend"`.

**Cause:** The nginx config hardcodes `proxy_pass http://backend:3000` for Docker Compose. On Fly.io, there's no "backend" DNS name, so nginx can't resolve the upstream.

**Fix:** Set `VITE_API_URL` on the frontend app. The `docker-entrypoint.sh` script detects this and removes the `/api/` and `/ws` proxy blocks from nginx.conf, switching to direct CORS mode.

### Frontend shows CORS errors

The backend's `CORS_ORIGIN` doesn't match the frontend's origin. Verify:
- `CORS_ORIGIN` is set to the frontend's **full URL** with scheme (e.g., `https://achilles-frontend.fly.dev`)
- Do not use just the hostname — the `https://` prefix is required

### Encrypted settings lost after redeploy

`ENCRYPTION_SECRET` is not set. Without it, the backend derives a key from the container's hostname, which changes across deploys. Set a stable `ENCRYPTION_SECRET` via `flyctl secrets set`.

### Agent enrollment commands show wrong URL

Set `AGENT_SERVER_URL` to the backend's public Fly domain (with `https://`), e.g., `https://achilles-backend.fly.dev`.

### Analytics shows "not configured"

The Elastic Cloud connection is stored in the encrypted `analytics.json` file. If `ENCRYPTION_SECRET` changed, the file becomes unreadable. Reconfigure via Analytics → Setup, or set `ELASTICSEARCH_CLOUD_ID` and `ELASTICSEARCH_API_KEY` as env vars (env vars take priority over the file).

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

**Symptom:** Clicking "Sign in with GitHub" redirects to GitHub with `client_id=` (empty), and GitHub returns a 404 page. Google login may fail similarly.

**Cause:** You are using a Clerk **production instance** but haven't configured custom OAuth credentials. Production instances require your own GitHub/Google OAuth app credentials — unlike development instances, which use Clerk's shared credentials automatically.

**Fix:** Follow the "Configure OAuth Credentials" steps in the Clerk Setup section above. Every social provider enabled in Clerk needs its own Client ID and Client Secret when running in production mode.

### Agent builds fail with "Agent source not found"

The `AGENT_REPO_URL` environment variable is not set, or the Git clone failed at startup. Check:
- `AGENT_REPO_URL` is set to the full HTTPS URL of your ProjectAchilles repo
- `GITHUB_TOKEN` is set if the repo is private
- The container logs for git clone errors: `flyctl logs --app achilles-backend`

The agent source is cloned once at startup via sparse checkout (only the `agent/` subdirectory). If the clone fails, the build feature is disabled.

### Build times are slow

First builds take 3-5 minutes (Fly's remote builders download the Docker image layers). Subsequent builds reuse cached layers. Go agent builds benefit from the persistent volume cache — first build downloads Go modules (~30s), subsequent builds reuse the cache.
