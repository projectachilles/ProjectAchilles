---
sidebar_position: 6
title: Fly.io
description: Deploy ProjectAchilles to Fly.io — the cheapest always-on option with Docker Machines and persistent volumes.
---

# Fly.io Deployment

Deploy ProjectAchilles to [Fly.io](https://fly.io) using Docker Machines with persistent volumes. At ~$8/month, this is the cheapest always-on deployment option.

## Architecture

| Service | Machine Size | Volume | Public Domain |
|---------|-------------|--------|---------------|
| **achilles-backend** | shared-2x, 512 MB | 1 GB `achilles_data` | Yes |
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
  TESTS_REPO_URL="https://github.com/your-org/f0_library.git" \
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

## Custom Domains

Fly.io uses **A/AAAA records** (not CNAME like Render/Vercel):

```bash
flyctl certs create your-frontend-domain --app achilles-frontend
flyctl certs create your-backend-domain --app achilles-backend
```

Add the A/AAAA records shown by `flyctl certs show` to your DNS provider. TLS certificates are auto-provisioned by Let's Encrypt.

## Deploying Updates

Fly.io does **not** auto-deploy from GitHub. Either deploy manually or set up CI/CD:

```yaml
# .github/workflows/deploy-fly.yml
- uses: superfly/flyctl-actions/setup-flyctl@master
- run: flyctl deploy --app achilles-backend
  working-directory: backend
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

## Useful Commands

```bash
flyctl logs --app achilles-backend          # View logs
flyctl ssh console --app achilles-backend   # SSH into Machine
flyctl status --app achilles-backend        # Machine status
flyctl volumes list --app achilles-backend  # List volumes
flyctl apps restart achilles-backend        # Restart
```

## Agent Build from Source

Full Go build support (Docker image includes Go 1.24.3). Set `AGENT_REPO_URL` and `AGENT_REPO_BRANCH`.

## Cost Estimate

| Service | Est. Monthly Cost |
|---------|------------------|
| Backend (shared-2x, 512 MB) | ~$5 |
| Frontend (shared-1x, 256 MB) | ~$3 |
| Volume (1 GB) | ~$0.15 |
| **Total** | **~$8** |

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
