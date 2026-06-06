# Deploying ProjectAchilles to a Public Server (DigitalOcean / any VPS)

This guide deploys a **fully functional, publicly reachable** ProjectAchilles
install on a single Linux server with a real domain and an automatically-issued
TLS certificate. It works on a DigitalOcean droplet or any Ubuntu 22.04/24.04
host (Hetzner, Linode, EC2, bare metal).

For an **on-prem / internal** server (private network, internal CA, or your own
certificate), see [`ON_PREM_SERVER.md`](./ON_PREM_SERVER.md). Both guides share
the same scripts and compose file — only the TLS strategy and provisioning
differ.

## Architecture

```
                 :443 (HTTPS)
  Browser  ─────────────────►┐
  Agents   ─────────────────►│   ┌──────────────────────────────────┐
                             └──►│  Caddy  (TLS termination, :80/:443) │
                                 │    │ reverse_proxy                   │
                                 │    ▼                                 │
                                 │  frontend (nginx, SPA + /api proxy)  │
                                 │    │ /api → backend:3000             │
                                 │    ▼                                 │
                                 │  backend (Express, SQLite, Go builds)│
                                 │    │                                 │
                                 │    ▼ (optional)                      │
                                 │  elasticsearch (internal only)       │
                                 └──────────────────────────────────────┘
                                        single Docker network
```

- **One public origin.** `https://achilles.example.com/` serves the UI and
  `.../api` serves the backend; agents enroll and heartbeat against the same
  host. Only Caddy is exposed — backend, frontend, and Elasticsearch stay on the
  internal Docker network.
- **Automatic HTTPS.** Caddy obtains and renews a Let's Encrypt certificate.
- **Self-contained.** SQLite + the agent source live in Docker volumes. Go
  cross-compilation runs inside the backend container.

## Prerequisites

- A domain you control (e.g. `example.com`) and the ability to create an A record.
- A server (or a DigitalOcean account + `doctl` to create one).
- Clerk application keys — [dashboard.clerk.com](https://dashboard.clerk.com) → API Keys.
- (Optional) Elastic Cloud deployment if you don't want to self-host Elasticsearch.
- (Optional) A GitHub token if your test library / agent repo is private.

### Droplet sizing

| Elasticsearch | Recommended size | Notes |
|---------------|------------------|-------|
| Self-hosted (`ES_MODE=self`) | **4 GB RAM / 2 vCPU** (`s-2vcpu-4gb`) | ES wants ~2 GB; the rest runs the app + Go builds. |
| Elastic Cloud (`ES_MODE=cloud`) | 2 GB RAM / 1–2 vCPU (`s-1vcpu-2gb`) | Smaller — ES is external. |

## Quick start

Everything is driven by a single config file. Copy the template and fill it in:

```bash
cp deploy.config.env.example deploy.config.env
$EDITOR deploy.config.env
```

Minimum fields for a public deployment:

```ini
ACHILLES_DOMAIN=achilles.example.com
ACME_EMAIL=admin@example.com
TLS_MODE=acme-http
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
ES_MODE=self          # or: cloud (then set ELASTICSEARCH_CLOUD_ID/API_KEY)
```

Then pick one of the three paths below.

### Path A — DigitalOcean, one command (create droplet + install)

Fill in the `DO_*` section of `deploy.config.env` (API token, region, size, and
your registered SSH key fingerprint from `doctl compute ssh-key list`), then:

```bash
./scripts/deploy-do.sh
```

This creates the droplet, applies a firewall (22/80/443), optionally creates the
DNS A record (`DO_MANAGE_DNS=true` if your domain is on DigitalOcean DNS), then
installs and starts the stack over SSH.

### Path B — existing server you can SSH to

Point your domain's A record at the server's IP first, then:

```bash
./scripts/deploy-remote.sh root@<server-ip>
```

This rsyncs the repo, copies your config, and runs the installer remotely.

### Path C — running directly on the server

SSH into the server, clone the repo, create `deploy.config.env`, then:

```bash
./scripts/deploy-server.sh
```

The installer is **hybrid**: it reads `deploy.config.env` and interactively
prompts for any required value left blank. With a complete config it runs fully
unattended — ideal for driving from an LLM / agentic coding tool.

## DNS

Create a single **A record** pointing your subdomain at the server's public IP:

```
achilles.example.com.   A   203.0.113.10
```

For `TLS_MODE=acme-http`, DNS must resolve and ports 80/443 must be reachable
**before** Caddy can issue the certificate. Caddy retries automatically; watch
progress with `docker compose -f docker-compose.server.yml logs -f caddy`.

## Configuration reference

All fields are documented inline in `deploy.config.env.example`. Highlights:

| Field | Purpose |
|-------|---------|
| `ACHILLES_DOMAIN` | Public FQDN; the single origin for UI, API, and agents. |
| `ACME_EMAIL` | Let's Encrypt account email. |
| `TLS_MODE` | `acme-http` for public servers (see on-prem guide for others). |
| `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Authentication. |
| `SESSION_SECRET` / `ENCRYPTION_SECRET` / `CLI_AUTH_SECRET` | Leave blank to auto-generate. |
| `ES_MODE` | `self` (bundled ES container) or `cloud` (Elastic Cloud). |
| `ELASTICSEARCH_CLOUD_ID` / `ELASTICSEARCH_API_KEY` | Required when `ES_MODE=cloud`. |
| `SEED_ES` | `true` to seed ~1000 synthetic records on first provision (self ES). |
| `TESTS_REPO_URL` / `AGENT_REPO_URL` | Git-synced test library + agent source. |
| `GITHUB_TOKEN` | Only for private repos. |

Generated files (gitignored, mode 600): `backend/.env` (app config) and `.env`
(compose interpolation). Re-running the installer regenerates them.

## Enrolling agents

Agents connect to the same public host over HTTPS. In the UI go to **Endpoints →
enrollment**, generate a token, and run the printed command on the endpoint. The
enrollment command uses `AGENT_SERVER_URL` (`https://achilles.example.com`),
which the installer set for you. Because the certificate is publicly trusted, no
extra CA configuration is needed on the agent.

## Day-2 operations

```bash
# From the repo dir on the server:
docker compose -f docker-compose.server.yml ps          # status
docker compose -f docker-compose.server.yml logs -f      # logs
docker compose -f docker-compose.server.yml restart      # restart all

# Upgrade: pull new code, then re-run the installer (idempotent)
git pull
./scripts/deploy-server.sh

# Stop / start
docker compose -f docker-compose.server.yml down
docker compose -f docker-compose.server.yml up -d
```

### Backups

Persistent state lives in Docker volumes:

| Volume | Contents |
|--------|----------|
| `achilles-data` | SQLite DB, encrypted settings, certificates (`~/.projectachilles`). |
| `esdata` | Elasticsearch indices (self-hosted only). |
| `caddy-data` | TLS certificates + Caddy local CA. |

Back up `achilles-data` regularly, e.g.:

```bash
docker run --rm -v projectachilles_achilles-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/achilles-data-$(date +%F).tar.gz -C /data .
```

> The volume prefix (`projectachilles_`) is the compose project name — confirm
> with `docker volume ls`.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| TLS cert not issued | `logs -f caddy`; confirm DNS resolves and 80/443 are open. Let's Encrypt rate-limits — use a staging email while testing. |
| 502 from the UI | Backend still starting or unhealthy: `logs -f backend`, `curl -sk https://DOMAIN/api/health`. |
| Agents can't connect | Confirm `AGENT_SERVER_URL` in `backend/.env` matches the public URL and the firewall allows 443. |
| ES errors in analytics | `ES_MODE=self` needs ≥4 GB RAM; or switch to `cloud` and set the Cloud ID/API key. |
| Out of disk during Go builds | The agent toolchain caches under `go-cache`; ensure the droplet has ≥20 GB disk. |

## Security notes

- Only ports 80/443 (and 22 for admin) should be open. The `deploy-do.sh`
  firewall enforces this; on a BYO server configure `ufw`/security groups the same way.
- Secrets live in `backend/.env` and `.env` (mode 600) and in the
  `achilles-data` volume (encrypted at rest via `ENCRYPTION_SECRET`).
- Self-hosted Elasticsearch runs with security disabled but is **never published
  to the host or internet** — it is reachable only on the internal Docker
  network. Do not add a host port mapping for it.
