---
sidebar_position: 2
title: Prerequisites
description: Common prerequisites for deploying ProjectAchilles — Clerk authentication, Elasticsearch, domains, and environment variables.
---

# Prerequisites

Before deploying ProjectAchilles to any target, you need to set up authentication and (optionally) Elasticsearch.

## Clerk Authentication (Required)

All deployment targets require [Clerk](https://clerk.com) for user authentication.

### 1. Create a Clerk Application

1. Sign up at [clerk.com](https://clerk.com)
2. Create a new application
3. Choose your sign-in methods:
   - **OAuth providers** — Google, Microsoft, GitHub (recommended)
   - **Email/password** — Optional, see [Email Auth Setup](../user-guide/authentication/email-password)

### 2. Get Your API Keys

From the Clerk Dashboard → **API Keys**:

| Key | Used By | Example |
|-----|---------|---------|
| **Publishable Key** | Frontend + Backend | `pk_test_abc123...` |
| **Secret Key** | Backend only | `sk_test_xyz789...` |

:::warning Separate Clerk Apps Per Environment
Create separate Clerk applications for each deployment target (local dev, staging, production). Keys are not interchangeable between environments.

**Exception:** If you move from one hosting provider to another with the same custom domain, you can reuse the same Clerk production app.
:::

### 3. Configure OAuth Providers

For each OAuth provider you want to support:

**Google:**
1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID
3. Add your Clerk callback URL: `https://your-clerk-domain/v1/oauth_callback`
4. Enter Client ID and Secret in Clerk Dashboard → User & Authentication → Social Connections

**GitHub:**
1. Go to GitHub → Settings → Developer Settings → OAuth Apps
2. Create a new OAuth App
3. Set callback URL to your Clerk callback URL
4. Enter Client ID and Secret in Clerk Dashboard

**Microsoft:**
1. Go to [Azure Portal](https://portal.azure.com) → App Registrations
2. Create a new registration with redirect URI
3. Enter Application (client) ID and secret in Clerk Dashboard

## Elasticsearch (Optional)

The Analytics module requires Elasticsearch 8.x. You can use:

### Elastic Cloud (Recommended)

1. Create a free trial at [elastic.co/cloud](https://www.elastic.co/cloud)
2. Note your **Cloud ID** and create an **API Key**
3. Set `ELASTICSEARCH_CLOUD_ID` and `ELASTICSEARCH_API_KEY` in your backend environment

### Self-Hosted Elasticsearch

Run Elasticsearch 8.17+ with security disabled for internal use:

```bash
docker compose --profile elasticsearch up -d
```

Or connect to an existing cluster with `ELASTICSEARCH_NODE=http://your-es-host:9200`.

:::danger Client Version Must Match Server
The `@elastic/elasticsearch` client must stay on version 8.x to match the Elasticsearch 8.x server. Version 9.x sends `compatible-with=9` headers that ES 8.x rejects with HTTP 400.
:::

## Custom Domains (Production)

For production deployments, you'll need:

1. A domain name (e.g., `projectachilles.yourdomain.com`)
2. DNS access to create CNAME or A/AAAA records
3. Clerk custom domain configuration (production apps only)

Domain setup is covered in each deployment target's guide.

## Environment Variables

See [Environment Variables Reference](./environment-variables) for the complete list per deployment target.

### Minimum Required

| Variable | Description | All Targets |
|----------|-------------|:-----------:|
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key (backend) | Yes |
| `CLERK_SECRET_KEY` | Clerk secret key (backend) | Yes |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (frontend) | Yes |
| `CORS_ORIGIN` | Allowed CORS origin | Yes |
| `ENCRYPTION_SECRET` | Settings encryption key | Production |
| `SESSION_SECRET` | Session signing key | Production |
