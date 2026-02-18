# Deploying ProjectAchilles to Railway.app

This guide covers deploying ProjectAchilles to [Railway](https://railway.com) using GitHub integration and Elastic Cloud for analytics.

## Architecture

Railway runs two services from this monorepo:

| Service | Root Directory | Dockerfile | Public Domain |
|---------|---------------|------------|---------------|
| **backend** | `backend/` | `backend/Dockerfile` | Yes (agents connect here) |
| **frontend** | `frontend/` | `frontend/Dockerfile` | Yes (users visit this) |

Services communicate over Railway's [private network](https://docs.railway.com/guides/private-networking) using `<service>.railway.internal` DNS names. Elasticsearch is handled externally by Elastic Cloud.

## Prerequisites

- Railway account ([railway.com](https://railway.com)) — Hobby plan ($5/month) or above
- GitHub repo with this project pushed
- Clerk application keys ([dashboard.clerk.com](https://dashboard.clerk.com))
- Elastic Cloud deployment ([cloud.elastic.co](https://cloud.elastic.co))
- GitHub Personal Access Token (if using a private test repo)

## Step 1: Create the Railway Project

1. Log in to [railway.com](https://railway.com)
2. Click **New Project** → **Empty Project**
3. Name it (e.g., "ProjectAchilles")

## Step 2: Deploy the Backend

1. In your project canvas, click **+ New** → **GitHub Repo**
2. Select your ProjectAchilles repository
3. In the service's **Settings** tab:
   - **Root Directory**: `backend`
   - Railway auto-detects the Dockerfile via `railway.toml`
4. Add **two volumes** (Settings → Volumes):

   | Mount Path | Purpose |
   |------------|---------|
   | `/root/.projectachilles` | SQLite database, certificates, encrypted settings |
   | `/app/data` | Git-synced test repository cache |

5. Configure **environment variables** (Settings → Variables):

   ```
   NODE_ENV=production
   PORT=3000
   CLERK_PUBLISHABLE_KEY=pk_live_...
   CLERK_SECRET_KEY=sk_live_...
   SESSION_SECRET=<openssl rand -base64 32>
   ENCRYPTION_SECRET=<openssl rand -base64 32>
   CORS_ORIGIN=https://<your-frontend>.up.railway.app
   AGENT_SERVER_URL=https://<your-backend>.up.railway.app
   TESTS_REPO_URL=https://github.com/your-org/f0_library.git
   TESTS_REPO_BRANCH=main
   GITHUB_TOKEN=ghp_...
   ELASTICSEARCH_CLOUD_ID=<from Elastic Cloud console>
   ELASTICSEARCH_API_KEY=<from Elastic Cloud console>
   ```

   > **`ENCRYPTION_SECRET` is required on Railway.** Without it, the backend falls back to a machine-derived key (hostname + username) that changes across deploys, corrupting encrypted settings.

6. Assign a **public domain** (Settings → Networking → Generate Domain)
   - This is the URL agents will use to report results (`AGENT_SERVER_URL`)

## Step 3: Deploy the Frontend

1. Click **+ New** → **GitHub Repo** → same repository
2. In the service's **Settings** tab:
   - **Root Directory**: `frontend`
3. Configure **environment variables**:

   ```
   CLERK_PUBLISHABLE_KEY=pk_live_...
   BACKEND_HOST=backend.railway.internal
   BACKEND_PORT=3000
   ```

   > `BACKEND_HOST` triggers an nginx config rewrite at container start, pointing the API proxy to the backend's private network address. Without it, nginx defaults to `backend:3000` (Docker Compose behavior).

4. Assign a **public domain** (Settings → Networking → Generate Domain)
   - This is the URL users visit in their browser
   - Update the backend's `CORS_ORIGIN` to match this domain

## Step 4: Wire Services Together

Use Railway's [reference variables](https://docs.railway.com/guides/variables) to avoid hardcoding domains. In the backend's variables:

```
CORS_ORIGIN=https://${{ frontend.RAILWAY_PUBLIC_DOMAIN }}
AGENT_SERVER_URL=https://${{ backend.RAILWAY_PUBLIC_DOMAIN }}
```

## Step 5: Verify

1. Wait for both services to build and deploy (first build takes 3-5 minutes)
2. Visit your frontend domain — you should see the Clerk login page
3. Check the backend health: `curl https://<backend-domain>/api/health`
4. After logging in, go to **Analytics → Setup** and verify the Elastic Cloud connection

## Volumes

| Volume | Mount Path | Contents |
|--------|-----------|----------|
| Backend data | `/root/.projectachilles` | `agents.db` (SQLite), `analytics.json` (encrypted ES config), `tests.json`, `certs/` |

> **Single volume only.** Railway fails to start containers with multiple volumes attached to one service. The test repo cache (`/app/data`) is not persisted — the backend re-clones the repo from GitHub on each deploy, which takes ~10 seconds.

These persist across deploys. Railway volumes mount as root, which matches the backend container's default user.

## Auto-Deploy

With GitHub integration, every push to your configured branch triggers a rebuild. Railway uses `watchPatterns` from `railway.toml` to only rebuild a service when its relevant files change:

- **backend** rebuilds on: `src/**`, `package.json`, `Dockerfile`, `tsconfig.json`
- **frontend** rebuilds on: `src/**`, `package.json`, `Dockerfile`, `nginx.conf`, `docker-entrypoint.sh`

A commit touching only `frontend/src/` will **not** trigger a backend redeploy.

## What's Not Available on Railway

**Agent cross-compilation** — The backend's build-from-source feature (Go agent compilation) requires the `agent/` source directory mounted at `/agent-src`. On Railway, the backend's build context is `backend/` only, so this directory isn't available. The backend gracefully disables this feature when the source is missing. Build agents locally and upload them through the UI instead.

## Cost Estimate

With Elastic Cloud handling analytics externally, Railway costs are minimal:

| Service | Est. Monthly Cost |
|---------|------------------|
| Backend (~0.5 vCPU, ~512MB RAM) | ~$7-10 |
| Frontend (~0.1 vCPU, ~64MB RAM) | ~$1-2 |
| Volumes (~1-2 GB) | ~$0.30 |
| **Total** | **~$10-13** |

The Hobby plan includes $5/month in credits. See [Railway pricing](https://railway.com/pricing) for current rates.

## Troubleshooting

### Frontend shows "502 Bad Gateway"
The nginx proxy can't reach the backend. Verify:
- `BACKEND_HOST` is set to `backend.railway.internal` on the frontend service
- The backend service is running and healthy
- Both services are in the same Railway project/environment

The entrypoint configures nginx with dynamic DNS resolution (`resolver` + variable-based `proxy_pass`) so that backend IP changes after redeployment are picked up automatically. If you see 502s immediately after a backend redeploy, the frontend should self-heal within 5 seconds.

### Custom domains require TXT verification
Railway requires both a CNAME record and a `_railway-verify.app` TXT record for custom domain SSL provisioning. Without the TXT record, DNS will resolve but Railway returns "Application not found" and won't issue a Let's Encrypt certificate. Check Settings → Networking on each service for the exact TXT values.

### Encrypted settings lost after redeploy
`ENCRYPTION_SECRET` is not set. Without it, the backend derives a key from the container's hostname, which changes on every deploy. Set a stable `ENCRYPTION_SECRET` in Railway variables.

### Agent enrollment commands show wrong URL
Set `AGENT_SERVER_URL` to the backend's public Railway domain (with `https://`).

### Analytics shows "not configured"
The Elastic Cloud connection is stored in the encrypted `analytics.json` file. If `ENCRYPTION_SECRET` changed, the file becomes unreadable. Reconfigure via Analytics → Setup, or set `ELASTICSEARCH_CLOUD_ID` and `ELASTICSEARCH_API_KEY` as env vars (env vars take priority over the file).
