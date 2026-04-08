---
sidebar_position: 7
title: Vercel (Serverless)
description: Deploy ProjectAchilles to Vercel with Turso database, Vercel Blob storage, and serverless functions.
---

# Vercel Deployment (Serverless)

Deploy ProjectAchilles to [Vercel](https://vercel.com) using the serverless backend (`backend-serverless/`) with Turso for the database and Vercel Blob for file storage.

## Architecture

| Project | Root Directory | Runtime |
|---------|---------------|---------|
| **backend** | `backend-serverless/` | `@vercel/node` (serverless) |
| **frontend** | `frontend/` | Vite (static SPA) |

:::warning Different Backend
The Vercel deployment uses `backend-serverless/` — a purpose-built fork that replaces SQLite with Turso, filesystem with Vercel Blob, and process scheduling with Vercel Cron.
:::

| Concern | Docker backend | Vercel backend |
|---------|---------------|----------------|
| Database | SQLite (better-sqlite3) | Turso (@libsql/client) |
| File storage | `~/.projectachilles/` | Vercel Blob |
| Signing keys | Filesystem | Environment variables (Ed25519) |
| Test library | Runtime git sync | Build-time clone |
| Cron jobs | setInterval | Vercel Crons |

## Prerequisites

- Vercel account — **Pro plan** recommended (required for Cron jobs)
- Turso database (free tier sufficient)
- Clerk application keys
- Elastic Cloud deployment

## Step 1: Create Turso Database

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create projectachilles
turso db show projectachilles --url      # → libsql://...turso.io
turso db tokens create projectachilles   # → eyJhbGci...
```

## Step 2: Generate Ed25519 Signing Keys

```bash
openssl genpkey -algorithm Ed25519 -outform DER -out /tmp/ed25519_private.der
SIGNING_PRIVATE_KEY_B64=$(base64 -w0 /tmp/ed25519_private.der)
SIGNING_PUBLIC_KEY_B64=$(openssl pkey -inform DER -in /tmp/ed25519_private.der \
  -pubout -outform DER | base64 -w0)
rm /tmp/ed25519_private.der
```

## Step 3: Add Vercel Blob Storage

In the [Vercel Dashboard](https://vercel.com/dashboard), go to **Storage** → **Create Database** → **Blob**. Link the Blob store to your backend project. This auto-provisions the `BLOB_READ_WRITE_TOKEN` environment variable — no manual value needed.

:::info
Vercel Blob is used for certificate storage, agent binary uploads, and other file-based data that replaces the filesystem on serverless.
:::

## Step 4: Create Vercel Projects

Create **two separate Vercel projects** linked to the same GitHub repo:

- **Backend**: Root Directory `backend-serverless`, Framework Preset "Other"
- **Frontend**: Root Directory `frontend`, Framework Preset "Vite"

## Step 5: Set Environment Variables

:::tip Generate Secrets
```bash
./scripts/generate-secrets.sh --target vercel
```
Outputs `SESSION_SECRET`, `ENCRYPTION_SECRET`, `CLI_AUTH_SECRET`, and Ed25519 signing keys — ready to paste.
:::

### Backend

| Variable | Value |
|----------|-------|
| `CLERK_PUBLISHABLE_KEY` | `pk_live_...` |
| `CLERK_SECRET_KEY` | `sk_live_...` |
| `SESSION_SECRET` | Random 32+ chars |
| `ENCRYPTION_SECRET` | Random 32+ chars (**required, no fallback**) |
| `CLI_AUTH_SECRET` | Random 32+ chars |
| `TURSO_DATABASE_URL` | `libsql://...turso.io` |
| `TURSO_AUTH_TOKEN` | Turso auth token |
| `SIGNING_PRIVATE_KEY_B64` | From Step 2 |
| `SIGNING_PUBLIC_KEY_B64` | From Step 2 |
| `BLOB_READ_WRITE_TOKEN` | Auto-provisioned by Blob integration (Step 3) |
| `CORS_ORIGIN` | `https://<frontend>.vercel.app` |
| `AGENT_SERVER_URL` | `https://<backend>.vercel.app` |
| `TESTS_REPO_URL` | Test library Git URL |
| `GITHUB_TOKEN` | PAT with `repo` scope (only for private repos) |
| `ELASTICSEARCH_CLOUD_ID` | From Elastic Cloud |
| `ELASTICSEARCH_API_KEY` | From Elastic Cloud |

### Frontend

| Variable | Value |
|----------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` (must have `VITE_` prefix) |
| `VITE_API_URL` | `https://<backend>.vercel.app` |

## Cron Jobs

| Schedule | Endpoint | Purpose |
|----------|----------|---------|
| Every minute | `/api/cron/schedules` | Process pending schedules |
| Every minute | `/api/cron/auto-rotation` | Rotate agent API keys |

Cron jobs require the **Pro plan** and only run in Production.

## What's Not Available

| Feature | Status | Reason |
|---------|--------|--------|
| Go agent builds | 503 | No Go toolchain |
| Certificate generation | 503 | No `openssl` binary |
| Runtime git sync | Disabled | No persistent filesystem |
| Certificate upload | **Available** | Stored in Vercel Blob |
| Agent binary upload | **Available** | Stored in Vercel Blob |

## Gotchas

:::danger Always Use printf for Environment Variables
`echo` appends a trailing newline that corrupts env var values:

```bash
# Correct
printf "libsql://..." | vercel env add TURSO_DATABASE_URL production

# Wrong — echo adds \n
echo "libsql://..." | vercel env add TURSO_DATABASE_URL production
```

**Symptoms:** `TURSO_DATABASE_URL` newline → "Invalid URL" on all database endpoints. `CORS_ORIGIN` newline → HTTP 500 on cross-origin requests.
:::

:::warning Frontend Clerk Key Prefix
Vite only exposes env vars with `VITE_` prefix. Use `VITE_CLERK_PUBLISHABLE_KEY` on the frontend project, not `CLERK_PUBLISHABLE_KEY`.
:::

:::info __dirname is Unreliable
`@vercel/node` bundles with ncc/esbuild. Use `process.cwd()` (always `/var/task`) instead of `__dirname` for path resolution.
:::

## Cost Estimate

| Service | Est. Monthly Cost |
|---------|------------------|
| Vercel Pro (both projects) | $20 |
| Turso (free tier) | $0 |
| Vercel Blob (1 GB included) | $0 |
| **Total** | **~$20** |

## Troubleshooting

### CORS errors

Verify `CORS_ORIGIN` matches the frontend URL exactly (with `https://`, no trailing slash, no trailing newline).

### Agent endpoints return 500

Check `TURSO_DATABASE_URL` for trailing newline — use `printf` not `echo` when setting via CLI.

### Test library empty

Tests are cloned at build time. Trigger a redeploy after setting `TESTS_REPO_URL` and `GITHUB_TOKEN`.

### Cron jobs not running

Verify Pro plan and check the **Crons** tab in the Vercel Dashboard. Crons only run in Production.
