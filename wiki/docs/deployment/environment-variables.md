---
sidebar_position: 9
title: Environment Variables Reference
description: Complete reference of all environment variables across all ProjectAchilles deployment targets.
---

# Environment Variables Reference

This page consolidates all environment variables used across all deployment targets.

## Backend Variables

### Required (All Targets)

| Variable | Description | Example |
|----------|-------------|---------|
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key | `pk_live_abc123...` |
| `CLERK_SECRET_KEY` | Clerk secret key | `sk_live_xyz789...` |
| `CORS_ORIGIN` | Allowed CORS origin (frontend URL) | `https://app.example.com` |

### Required (Production)

| Variable | Description | Notes |
|----------|-------------|-------|
| `SESSION_SECRET` | Session signing key | `openssl rand -base64 32` |
| `ENCRYPTION_SECRET` | Settings encryption key | **Required** on all PaaS targets (no machine-derived fallback) |
| `CLI_AUTH_SECRET` | JWT signing key for CLI device-flow auth | `openssl rand -base64 32` |
| `AGENT_SERVER_URL` | External URL for agent communication | Must include `https://` |

### Elasticsearch

| Variable | Description |
|----------|-------------|
| `ELASTICSEARCH_CLOUD_ID` | Elastic Cloud deployment ID |
| `ELASTICSEARCH_API_KEY` | API key for authentication (see required permissions below) |
| `ELASTICSEARCH_NODE` | Direct node URL (e.g., `http://localhost:9200`) |
| `ELASTICSEARCH_INDEX_PATTERN` | Index pattern (default: `achilles-results-*`) |

:::info Elasticsearch API Key Permissions
When creating an API key manually (Kibana → Stack Management → API Keys), use these role descriptors:

```json
{
  "achilles_role": {
    "cluster": ["monitor"],
    "indices": [{
      "names": ["achilles-*", "archived-*"],
      "privileges": ["manage", "read", "write"],
      "allow_restricted_indices": false
    }]
  }
}
```

For local development, `start.sh` creates this key automatically from the `elastic` user password.
:::

### Test Library

| Variable | Description |
|----------|-------------|
| `TESTS_REPO_URL` | Git URL for the test library |
| `TESTS_REPO_BRANCH` | Branch to sync (default: `main`) |
| `GITHUB_TOKEN` | PAT for private repos |
| `TESTS_SOURCE_PATH` | Local fallback path for tests |

### Agent Build

| Variable | Description |
|----------|-------------|
| `AGENT_REPO_URL` | Git URL for agent source (enables build-from-source) |
| `AGENT_REPO_BRANCH` | Branch to clone (default: `main`) |

### Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Node environment | `development` |

### Vercel-Only

| Variable | Description |
|----------|-------------|
| `TURSO_DATABASE_URL` | Turso database URL (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | Turso authentication token |
| `SIGNING_PRIVATE_KEY_B64` | Ed25519 private key (base64, PKCS8 DER) |
| `SIGNING_PUBLIC_KEY_B64` | Ed25519 public key (base64, SPKI DER) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token (auto-provisioned when Blob integration is added via Vercel Marketplace) |

### Docker-Only

| Variable | Description |
|----------|-------------|
| `NGROK_FRONTEND_DOMAIN` | ngrok domain for frontend tunnel |
| `NGROK_BACKEND_DOMAIN` | ngrok domain for backend/agent tunnel |

## Frontend Variables

| Variable | Description | Notes |
|----------|-------------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | **Must** have `VITE_` prefix |
| `VITE_BACKEND_PORT` | Backend port for Vite proxy | Default: `3000` (dev only) |
| `VITE_API_URL` | Full backend URL | Production — direct CORS mode |

### PaaS Frontend Variables

| Variable | Description | Used By |
|----------|-------------|---------|
| `CLERK_PUBLISHABLE_KEY` | Clerk key (without `VITE_` prefix) | `docker-entrypoint.sh` injects as `window.__env__` |
| `BACKEND_HOST` | Backend internal hostname | nginx proxy mode (Railway, Standard+ Render) |
| `BACKEND_PORT` | Backend internal port | nginx proxy mode |

## Per-Target Summary

| Variable | Docker | Railway | Render | Fly.io | Vercel |
|----------|:------:|:-------:|:------:|:------:|:------:|
| `CLERK_PUBLISHABLE_KEY` | Yes | Yes | Yes | Yes | Yes |
| `CLERK_SECRET_KEY` | Yes | Yes | Yes | Yes | Yes |
| `CORS_ORIGIN` | Yes | Yes | Yes | Yes | Yes |
| `SESSION_SECRET` | Prod | Yes | Yes | Yes | Yes |
| `ENCRYPTION_SECRET` | Prod | **Required** | **Required** | **Required** | **Required** |
| `AGENT_SERVER_URL` | Prod | Yes | Yes | Yes | Yes |
| `CLI_AUTH_SECRET` | Optional | Yes | Yes | Yes | Yes |
| `ELASTICSEARCH_*` | Optional | Optional | Optional | Optional | Optional |
| `TESTS_REPO_URL` | Optional | Optional | Optional | Optional | Optional |
| `TURSO_*` | — | — | — | — | **Required** |
| `SIGNING_*_B64` | — | — | — | — | **Required** |
| `BLOB_READ_WRITE_TOKEN` | — | — | — | — | Auto |
| `BACKEND_HOST` | Auto | Yes | No* | No | — |
| `VITE_API_URL` | — | — | Yes | Yes | Yes |

\* Render Standard plan supports `BACKEND_HOST`; Starter plan uses `VITE_API_URL` instead.
