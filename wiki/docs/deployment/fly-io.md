---
sidebar_position: 8
title: Fly.io
description: Deploy ProjectAchilles to Fly.io — the cheapest always-on option with Docker Machines and persistent volumes.
---

# Fly.io Deployment

Deploy ProjectAchilles to [Fly.io](https://fly.io) using Docker Machines with persistent volumes. With shared-CPU Machines it costs about $8/month, the cheapest always-on option; the checked-in `backend/fly.toml` uses a dedicated-CPU Machine, which costs more (see [Cost Estimate](#cost-estimate)).

## Architecture

| Service | Machine Size | Volume | Public Domain |
|---------|-------------|--------|---------------|
| **achilles-backend** | performance, 1 CPU, 2 GB (`backend/fly.toml`) | 1 GB `achilles_data` | Yes |
| **achilles-frontend** | shared-1x, 256 MB | None | Yes |

The frontend calls the backend directly via CORS. Both Machines run always-on (`auto_stop_machines = 'off'`) since agents send heartbeats every 60s.

## Prerequisites

- Fly.io account
- `flyctl` CLI: `curl -L https://fly.io/install.sh | sh`
- Clerk application keys
- Elastic Cloud deployment

## Step 1: Create Apps and Volume

```bash
flyctl auth login

# Create apps
flyctl apps create achilles-backend --org personal
flyctl apps create achilles-frontend --org personal

# Create persistent volume (must match region in fly.toml)
flyctl volumes create achilles_data --app achilles-backend --region cdg --size 1
```

## Step 2: Set Environment Variables

```bash
flyctl secrets set \
  CLERK_PUBLISHABLE_KEY="pk_live_..." \
  CLERK_SECRET_KEY="sk_live_..." \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  ENCRYPTION_SECRET="$(openssl rand -base64 32)" \
  CLI_AUTH_SECRET="$(openssl rand -base64 32)" \
  CORS_ORIGIN="https://achilles-frontend.fly.dev" \
  AGENT_SERVER_URL="https://achilles-backend.fly.dev" \
  TESTS_REPO_URL="https://github.com/ubercylon8/f0_library.git" \
  GITHUB_TOKEN="ghp_..." \
  ELASTICSEARCH_CLOUD_ID="..." \
  ELASTICSEARCH_API_KEY="..." \
  --app achilles-backend

flyctl secrets set \
  CLERK_PUBLISHABLE_KEY="pk_live_..." \
  VITE_API_URL="https://achilles-backend.fly.dev" \
  --app achilles-frontend
```

## Step 3: Deploy

```bash
cd backend && flyctl deploy --app achilles-backend
cd ../frontend && flyctl deploy --app achilles-frontend
```

First builds take 3-5 minutes. Subsequent builds reuse cached Docker layers.

## Step 4: Verify

```bash
curl https://achilles-backend.fly.dev/api/health
# Expected: {"status":"ok","service":"ProjectAchilles",...}
```

Visit `https://achilles-frontend.fly.dev` and verify Clerk login works.

:::warning[Set up roles in Clerk]
Every user without a role is read-only. In the Clerk Dashboard, add the
`metadata` claim to the session token, then give your own account
`{"role": "admin"}` in its public metadata and sign in again:
[session token claim](./clerk-setup#session-token-claim) and
[first admin](./clerk-setup#first-admin). Invite everyone else from
**Settings → Users**.
:::

## Custom Domains

Fly.io uses **A/AAAA records** (not CNAME like Render/Vercel):

```bash
flyctl certs create your-frontend-domain --app achilles-frontend
flyctl certs create your-backend-domain --app achilles-backend
```

Add the A/AAAA records shown by `flyctl certs show` to your DNS provider. TLS certificates are auto-provisioned by Let's Encrypt.

## Deploying Updates

Fly.io does **not** auto-deploy from GitHub. Deploy manually with `flyctl deploy`, or use the workflow in the repository: `.github/workflows/deploy-flyio.yml` runs on every push to `main`, runs the backend and frontend build and tests, and then deploys both apps with `flyctl deploy --remote-only`. It needs a `FLY_API_TOKEN` repository secret (`flyctl tokens create deploy`), and it passes the commit to the backend image so `/api/health` reports what is running.

## Useful Commands

```bash
flyctl logs --app achilles-backend          # View logs
flyctl ssh console --app achilles-backend   # SSH into Machine
flyctl status --app achilles-backend        # Machine status
flyctl volumes list --app achilles-backend  # List volumes
flyctl apps restart achilles-backend        # Restart
```

## Agent Build from Source

Full Go build support (the Docker image includes Go 1.25). Set `AGENT_REPO_URL` and `AGENT_REPO_BRANCH`.

Before **every build**, the backend fetches the latest commit of `AGENT_REPO_BRANCH` (`git fetch --depth 1` + hard reset), so a build always compiles the current branch, even when an agent-only merge didn't trigger a redeploy. The commit is recorded in the version's release notes (`Built from source (windows/amd64) at 1bbe749`). If the fetch fails, the build fails rather than compiling stale code.

## Cost Estimate

| Service | Est. Monthly Cost |
|---------|------------------|
| Backend (shared-cpu-2x, 512 MB) | ~$5 |
| Frontend (shared-1x, 256 MB) | ~$3 |
| Volume (1 GB) | ~$0.15 |
| **Total** | **~$8** |

This is the price with a shared-CPU backend (`flyctl scale vm shared-cpu-2x --memory 512 --app achilles-backend`). The checked-in `backend/fly.toml` asks for a dedicated CPU (`performance`, 1 CPU, 2 GB), because SQLite under a real fleet was slow on a shared CPU; that Machine costs roughly $30/month. See [Fly.io pricing](https://fly.io/docs/about/pricing/) for current prices.

## Helper Scripts

```bash
# Generate all secrets in flyctl format (copy-paste ready)
./scripts/generate-secrets.sh --target fly --format flyctl

# Interactive setup wizard — collects Clerk/ES config, outputs Fly.io-ready env vars
./scripts/setup.sh    # Select: PaaS → Fly.io

# Initialize Elasticsearch indices on Elastic Cloud
./scripts/init-elasticsearch.sh --cloud-id "deploy:..." --api-key "..."
```

## Troubleshooting

### Frontend shows "502 Bad Gateway" at startup

The nginx config hardcodes Docker Compose hostnames. Set `VITE_API_URL` on the frontend — `docker-entrypoint.sh` detects this and removes the proxy blocks.

### Volume data not persisting

Verify the volume is attached and in the same region as the Machine:

```bash
flyctl volumes list --app achilles-backend
```

### TLS certificate not provisioning

```bash
flyctl certs check <domain> --app <app-name>
```

Verify DNS records point to the correct Fly.io IPs.
