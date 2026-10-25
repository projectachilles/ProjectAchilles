---
sidebar_position: 1
title: Overview & Comparison
description: Compare all ProjectAchilles deployment targets — Docker Compose, public/on-prem server, on-prem LAN installer, Railway, Render, Fly.io, and Vercel.
---

# Deployment Overview

ProjectAchilles supports eight deployment targets. Choose based on your requirements for database, storage, agent build capability, and budget.

Every target signs users in through Clerk. Set up the Clerk app first, including the session token claim and the first admin's role: see [Prerequisites](./prerequisites#clerk-authentication-required).

## Comparison Matrix

| Target | Backend | Database | File Storage | Agent Builds | Cost | Best For |
|--------|---------|----------|-------------|-------------|------|----------|
| **Docker Compose** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Free | Local dev, self-hosted, air-gapped |
| **Server installer (on-prem or cloud)** — recommended for self-hosting | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Your hardware or VPS cost | One-command wizard on one Linux server: a LAN with a managed CA and GPO trust, or a cloud server (DigitalOcean, Hetzner) with Let's Encrypt |
| **Public server** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | VPS cost | Scripted install on a VPS (or a droplet it creates) with auto-TLS, no wizard |
| **On-prem server** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | Your hardware | Scripted install over SSH on a private network, own PKI, no wizard |
| **Railway** | `backend/` | SQLite (volume) | Filesystem (volume) | Partial | ~$10-13/mo | Simplicity, auto-deploy from GitHub |
| **Render** | `backend/` | SQLite (persistent disk) | Filesystem (disk) | Partial | ~$14/mo | Flat-rate pricing, Blueprint deploy |
| **Fly.io** | `backend/` | SQLite (volume) | Filesystem (volume) | Yes | ~$8/mo | Cheapest always-on, custom domains |
| **Vercel** | `backend-serverless/` | Turso (libSQL) | Vercel Blob | No | ~$20/mo | Scalability, edge performance |

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

### Railway
- GitHub-based auto-deploy with watch patterns for selective rebuilds
- Private networking between services (no public backend exposure needed)
- Limited Go cross-compilation (no CGO, constrained memory)
- Volume storage for SQLite and settings

### Render
- Blueprint deploy (`render.yaml`) for one-click setup
- Persistent disk storage (1 GB) for SQLite and certificates
- Starter plan offers flat-rate pricing
- Custom domains with CNAME records

### Fly.io
- Docker Machine-based deployment with persistent volumes
- Cheapest always-on option at ~$8/month
- Full Go build support (Docker-based builds)
- Custom domains with A/AAAA records (not CNAME)
- No auto-deploy from GitHub (requires `flyctl deploy` or CI/CD)

### Vercel (Serverless)
- Purpose-built serverless fork (`backend-serverless/`)
- Replaces SQLite with Turso, filesystem with Vercel Blob
- No Go build support (returns 503 for build endpoints)
- Test library cloned at build time, not runtime
- Vercel Cron for scheduling and key rotation

:::tip[Which Should I Choose?]
- **Just evaluating?** Use [Docker Compose](./docker-compose) or [Local Dev](../getting-started/quick-start-local)
- **Self-hosting on one Linux server, on your LAN or in the cloud?** Use the [Server Installer](./server-installer): a LAN with a managed CA and GPO trust, or a DigitalOcean/Hetzner server with Let's Encrypt
- **Prefer to script it yourself, or need DigitalOcean provisioning?** Use [Public Server](./public-server) (any VPS, or `deploy-do.sh` creates the droplet) or [On-Prem Server](./on-prem-server) (over SSH; internal CA, DNS-01 or your own cert)
- **Need the cheapest managed always-on?** Use [Fly.io](./fly-io) (~$8/mo)
- **Want the simplest managed deploy?** Use [Railway](./railway) (GitHub auto-deploy)
- **Need serverless scale?** Use [Vercel](./vercel) (requires Turso + Blob)
:::

## What's Next?

1. Review [Prerequisites](./prerequisites) for your chosen target
2. Follow the target-specific guide
3. Complete the [Production Checklist](./production-checklist)
4. Reference the [Environment Variables](./environment-variables) guide
