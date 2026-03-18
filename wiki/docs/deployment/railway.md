---
sidebar_position: 4
title: Railway
description: Deploy ProjectAchilles to Railway with GitHub auto-deploy, private networking, and Elastic Cloud analytics.
---

# Railway Deployment

Deploy ProjectAchilles to [Railway](https://railway.com) using GitHub integration and Elastic Cloud for analytics.

## Architecture

Railway runs two services from the monorepo:

| Service | Root Directory | Dockerfile | Public Domain |
|---------|---------------|------------|---------------|
| **backend** | `backend/` | `backend/Dockerfile` | Yes (agents connect here) |
| **frontend** | `frontend/` | `frontend/Dockerfile` | Yes (users visit this) |

Services communicate over Railway's [private network](https://docs.railway.com/guides/private-networking) using `<service>.railway.internal` DNS names.

## Prerequisites

- Railway account — Hobby plan ($5/month) or above
- GitHub repo with this project pushed
- Clerk application keys (create a **separate** app for Railway)
- Elastic Cloud deployment
- GitHub Personal Access Token (if using a private test repo)

## Step 1: Create the Railway Project

1. Log in to [railway.com](https://railway.com)
2. Click **New Project** → **Empty Project**
3. Name it (e.g., "ProjectAchilles")

## Step 2: Deploy the Backend

1. Click **+ New** → **GitHub Repo** → select your repository
2. In Settings:
   - **Root Directory**: `backend`
   - Railway auto-detects the Dockerfile via `railway.toml`
3. Add a **volume** (Settings → Volumes):

   | Mount Path | Purpose |
   |------------|---------|
   | `/root/.projectachilles` | SQLite database, certificates, encrypted settings |

4. Configure **environment variables**:

   ```bash
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

:::danger ENCRYPTION_SECRET is Required
Without `ENCRYPTION_SECRET`, the backend falls back to a machine-derived key (hostname + username) that changes across deploys, corrupting encrypted settings.
:::

5. Assign a **public domain** (Settings → Networking → Generate Domain)

## Step 3: Deploy the Frontend

1. Click **+ New** → **GitHub Repo** → same repository
2. Set **Root Directory**: `frontend`
3. Configure **environment variables**:

   ```bash
   CLERK_PUBLISHABLE_KEY=pk_live_...
   BACKEND_HOST=backend.railway.internal
   BACKEND_PORT=3000
   ```

   :::info Private Networking
   `BACKEND_HOST` triggers an nginx config rewrite at container start, pointing the API proxy to the backend's private network address.
   :::

4. Assign a **public domain** and update the backend's `CORS_ORIGIN` to match

## Step 4: Wire Services Together

Use Railway's [reference variables](https://docs.railway.com/guides/variables):

```bash
CORS_ORIGIN=https://${{ frontend.RAILWAY_PUBLIC_DOMAIN }}
AGENT_SERVER_URL=https://${{ backend.RAILWAY_PUBLIC_DOMAIN }}
```

## Step 5: Verify

1. Wait for both services to build (first build: 3-5 minutes)
2. Visit your frontend domain — you should see the Clerk login page
3. Check backend health: `curl https://<backend-domain>/api/health`
4. After logging in, verify the Elastic Cloud connection at **Analytics → Setup**

## Auto-Deploy

Railway uses `watchPatterns` from `railway.toml` for selective rebuilds:

- **backend** rebuilds on: `src/**`, `package.json`, `Dockerfile`, `tsconfig.json`
- **frontend** rebuilds on: `src/**`, `package.json`, `Dockerfile`, `nginx.conf`, `docker-entrypoint.sh`

## Limitations

**Agent cross-compilation** is not available on Railway. The build-from-source feature requires the `agent/` source directory mounted at `/agent-src`, which isn't available since Railway's build context is `backend/` only. Build agents locally and upload them through the UI.

## Cost Estimate

| Service | Est. Monthly Cost |
|---------|------------------|
| Backend (~0.5 vCPU, ~512MB RAM) | ~$7-10 |
| Frontend (~0.1 vCPU, ~64MB RAM) | ~$1-2 |
| Volumes (~1-2 GB) | ~$0.30 |
| **Total** | **~$10-13** |

## Troubleshooting

### Frontend shows "502 Bad Gateway"

Verify `BACKEND_HOST` is set to `backend.railway.internal` on the frontend service and both services are in the same Railway project/environment.

### Custom domains require TXT verification

Railway requires both a CNAME record and a `_railway-verify.app` TXT record for custom domain SSL provisioning.

### Encrypted settings lost after redeploy

`ENCRYPTION_SECRET` is not set. Set a stable value in Railway variables.

### Analytics shows "not configured"

Reconfigure via Analytics → Setup, or set `ELASTICSEARCH_CLOUD_ID` and `ELASTICSEARCH_API_KEY` as env vars (env vars take priority over stored settings).
