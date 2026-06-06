---
sidebar_position: 4
title: Public Server (VPS/Droplet)
description: Deploy a publicly-reachable single-server ProjectAchilles install behind Caddy with automatic Let's Encrypt TLS — on DigitalOcean or any Ubuntu host.
---

# Public Server Deployment

Deploy a **fully functional, publicly reachable** ProjectAchilles install on a
single Linux server with your own domain and an automatically-issued TLS
certificate. Works on a [DigitalOcean](https://www.digitalocean.com) droplet or
any Ubuntu 22.04/24.04 host (Hetzner, Linode, EC2, bare metal).

For an internal/private network install, see [On-Prem Server](./on-prem-server).

## Architecture

A single [Caddy](https://caddyserver.com) reverse proxy terminates TLS and
serves **one public origin** — UI at `/`, API at `/api`, and agents on the same
host. Backend, frontend, and Elasticsearch stay on the internal Docker network.

| Component | Exposed | Role |
|-----------|---------|------|
| **Caddy** | `:80`, `:443` | TLS termination + reverse proxy, automatic Let's Encrypt |
| **frontend** | internal | nginx SPA + `/api` proxy to backend |
| **backend** | internal | Express, SQLite, Go agent builds |
| **elasticsearch** | internal | Optional bundled analytics (`ES_MODE=self`) |

Defined by `docker-compose.server.yml` + `deploy/caddy/`, driven by the scripts
in `scripts/`.

## Sizing

| Elasticsearch | Recommended | Notes |
|---------------|-------------|-------|
| Self-hosted (`ES_MODE=self`) | 4 GB RAM / 2 vCPU (`s-2vcpu-4gb`) | ES wants ~2 GB. |
| Elastic Cloud (`ES_MODE=cloud`) | 2 GB RAM (`s-1vcpu-2gb`) | ES is external. |

## Prerequisites

- A domain you control and the ability to create an A record.
- A server (or a DigitalOcean account + [`doctl`](https://docs.digitalocean.com/reference/doctl/) to create one).
- Clerk application keys.
- (Optional) Elastic Cloud deployment; a GitHub token for private repos.

## Step 1: Configure

```bash
cp deploy.config.env.example deploy.config.env
$EDITOR deploy.config.env
```

Minimum fields:

```ini
ACHILLES_DOMAIN=achilles.example.com
ACME_EMAIL=admin@example.com
TLS_MODE=acme-http
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
ES_MODE=self          # or: cloud (then set ELASTICSEARCH_CLOUD_ID/API_KEY)
```

The installer is **hybrid**: it reads `deploy.config.env` and interactively
prompts for any required value left blank. A complete config runs fully
unattended — ideal for driving from an LLM / agentic coding tool.

## Step 2: Deploy

Pick one path:

```bash
# A — DigitalOcean: create droplet + firewall (+ optional DNS), then install.
#     Fill the DO_* section first (API token, region, size, SSH key fingerprint).
./scripts/deploy-do.sh

# B — Existing server you can SSH to (point the A record at it first).
./scripts/deploy-remote.sh root@<server-ip>

# C — Running directly on the server.
./scripts/deploy-server.sh
```

## Step 3: DNS

Create a single **A record** pointing your subdomain at the server's public IP:

```
achilles.example.com.   A   203.0.113.10
```

For `acme-http`, DNS must resolve and ports 80/443 must be reachable before
Caddy can issue the certificate. Watch progress:

```bash
docker compose -f docker-compose.server.yml logs -f caddy
```

## Step 4: Verify

```bash
curl -s https://achilles.example.com/api/health
# {"status":"ok","service":"ProjectAchilles",...}
```

Then open `https://achilles.example.com/` and confirm Clerk login works.

## Enrolling agents

Agents connect to the same public host over HTTPS. In **Endpoints → enrollment**,
generate a token and run the printed command on the endpoint. Because the
certificate is publicly trusted, no extra CA configuration is needed —
`AGENT_SERVER_URL` was already set to your public URL by the installer.

## Day-2 operations

```bash
docker compose -f docker-compose.server.yml ps         # status
docker compose -f docker-compose.server.yml logs -f    # logs

# Upgrade (idempotent):
git pull && ./scripts/deploy-server.sh
```

Persistent state lives in Docker volumes: `achilles-data` (SQLite, encrypted
settings, certs), `esdata` (self-hosted ES), `caddy-data` (TLS certs). Back up
`achilles-data` regularly.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| TLS cert not issued | `logs -f caddy`; DNS resolves? 80/443 open? Let's Encrypt rate-limits — test with a staging email. |
| 502 from the UI | Backend starting/unhealthy: `logs -f backend`, `curl -sk https://DOMAIN/api/health`. |
| Agents can't connect | `AGENT_SERVER_URL` matches the public URL; firewall allows 443. |
| ES errors | `ES_MODE=self` needs ≥4 GB RAM, or switch to `cloud`. |

:::info Full reference
The complete guide — including the configuration reference, backups, and
security notes — is in
[`docs/deployment/SELF_HOSTED_SERVER.md`](https://github.com/projectachilles/ProjectAchilles/blob/main/docs/deployment/SELF_HOSTED_SERVER.md).
:::
