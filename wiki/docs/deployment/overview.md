---
sidebar_position: 1
title: Overview & Comparison
description: Compare all ProjectAchilles deployment targets — Docker Compose, public/on-prem server, on-prem LAN installer, Windows Hyper-V appliance, Render, Fly.io, and Vercel.
---

# Deployment Overview

ProjectAchilles supports eight deployment targets. Choose based on your requirements for database, storage, agent build capability, and budget.

Every target signs users in through Clerk. Set up the Clerk app first, including the session token claim and the first admin's role: see [Clerk Setup](./clerk-setup).

## Comparison Matrix

| Target | Backend | Database | File Storage | Agent Builds | Cost | Best For |
|--------|---------|----------|-------------|-------------|------|----------|
| **Docker Compose** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Free | Local dev, self-hosted, air-gapped |
| **Server installer (on-prem or cloud)** — recommended for self-hosting | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Your hardware or VPS cost | One-command wizard on one Linux server: a LAN with a managed CA and GPO trust, or a cloud server (DigitalOcean, Hetzner) with Let's Encrypt |
| **Public server** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | VPS cost | Scripted install on a VPS (or a droplet it creates) with auto-TLS, no wizard |
| **On-prem server** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Your hardware | Scripted install over SSH on a private network, own PKI, no wizard |
| **Windows Hyper-V appliance** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Your hardware | A ready-made VM image for a Windows Server host: import it, answer the first-boot questions, run the wizard |
| **Render** | `backend/` | SQLite (persistent disk) | Filesystem (disk) | Partial (needs `AGENT_REPO_URL`) | ~$33/mo | Flat-rate pricing, Blueprint deploy |
| **Fly.io** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes (needs `AGENT_REPO_URL`) | From ~$8/mo | Cheapest always-on, custom domains |
| **Vercel** | `backend-serverless/` | Turso (libSQL) | Vercel Blob | No | ~$20/mo | Serverless; a subset of the features |

## Key Differences

### Docker Compose (Self-Hosted)
- Full feature set including Go cross-compilation and code signing
- Optional local Elasticsearch with synthetic seed data
- Best for development, testing, and on-premises deployment
- Requires managing your own infrastructure

### Server Installer (On-Prem or Cloud)
- `install-onprem.sh` downloads a checksum-verified `achilles-installer` and starts a ten-screen terminal wizard
- Detects a LAN or a public IP and adapts: a name-constrained ProjectAchilles CA with GPO trust for Windows fleets, or Let's Encrypt on a cloud server
- Invites the first admin through Clerk; day-2 `status`, `upgrade`, `backup` and `restore` commands; unattended mode from a config file
- Same engine and stack as the two scripted installs below

### Public Server (VPS/Droplet)
- Single-server install behind a [Caddy](https://caddyserver.com) reverse proxy with one public origin
- Automatic Let's Encrypt TLS; UI, API, and agents share the same domain
- One-command DigitalOcean provisioning (`deploy-do.sh`) or install on any Ubuntu host
- Self-hosted or Elastic Cloud Elasticsearch; full Go build support

### On-Prem Server
- Install over SSH onto a server you provide, on a private/internal network
- Selectable TLS that needs no inbound internet: internal CA, Let's Encrypt DNS-01, or bring-your-own cert
- Agent trust wired via the agent's `ca_cert` for internal CAs
- Same automation as the public server, driven by `deploy-remote.sh`

### Windows Hyper-V Appliance
- A sealed VM image with the server installer and the container images already inside; see [Windows Hyper-V Appliance](./appliance)
- `Import-Achilles.ps1` checks the download, creates the VM and starts it
- First boot asks for keyboard, password, network and hostname, then hands over to the same wizard as the server installer

### Render
- Blueprint deploy (`render.yaml`) for one-click setup
- Persistent disk storage (5 GB in the Blueprint) for SQLite, certificates and built binaries
- The Blueprint runs the backend on the Standard plan (2 GB / 1 CPU) and the frontend on Starter
- Can deploy from GitHub Actions after CI passes, instead of Render's own auto-deploy
- Custom domains with CNAME records

### Fly.io
- Docker Machine-based deployment with persistent volumes
- Cheapest always-on option at ~$8/month with a shared-CPU backend; the checked-in `fly.toml` uses a dedicated CPU, which costs more
- Full Go build support (Docker-based builds)
- Custom domains with A/AAAA records (not CNAME)
- No auto-deploy from GitHub by Fly itself; the repository's `deploy-flyio.yml` workflow deploys on push to `main`

### Vercel (Serverless)
- Purpose-built serverless fork (`backend-serverless/`)
- Replaces SQLite with Turso, filesystem with Vercel Blob
- No Go build support (returns 503 for build endpoints)
- Test library cloned at build time, not runtime
- Vercel Cron for scheduling and key rotation
- Not included: campaigns, pre-execution notices, alerting, SentinelOne, Sophos, console identity, the Stage coverage and Outcome breakdown cards, API keys and CLI sign-in. See [Vercel](./vercel#whats-not-available)

:::tip[Which Should I Choose?]
- **Just evaluating?** Use [Docker Compose](./docker-compose) or [Local Dev](../getting-started/quick-start-local)
- **Self-hosting on one Linux server, on your LAN or in the cloud?** Use the [Server Installer](./server-installer): a LAN with a managed CA and GPO trust, or a DigitalOcean/Hetzner server with Let's Encrypt
- **Prefer to script it yourself, or need DigitalOcean provisioning?** Use [Public Server](./public-server) (any VPS, or `deploy-do.sh` creates the droplet) or [On-Prem Server](./on-prem-server) (over SSH; internal CA, DNS-01 or your own cert)
- **Running Windows Server with Hyper-V and no Linux server?** Use the [Windows Hyper-V Appliance](./appliance)
- **Need the cheapest managed always-on?** Use [Fly.io](./fly-io) (~$8/mo)
- **Need serverless scale?** Use [Vercel](./vercel) (requires Turso + Blob)
:::

## What's Next?

1. Review [Prerequisites](./prerequisites) for your chosen target
2. Follow the target-specific guide
3. Complete the [Production Checklist](./production-checklist)
4. Reference the [Environment Variables](./environment-variables) guide
