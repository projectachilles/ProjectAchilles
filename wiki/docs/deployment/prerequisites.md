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

### 3. Add the role to the session token \{#session-token-claim}

ProjectAchilles reads each user's role from their Clerk **public metadata**
(step 4). Put it in the session token so the backend can read it from every
request:

1. In the Clerk Dashboard, open **Configure → Sessions**.
2. Under **Customize session token**, leave the name as it is (`__session`) and
   set the **Claims** to:

   ```json
   {
     "metadata": "{{user.public_metadata}}"
   }
   ```

   If the claims already hold other keys, add `metadata` next to them.
3. Select **Save**.

Clerk keeps this setting **per instance**: a development and a production
instance each need it, and so does every Clerk app you create for another
deployment.

:::info What happens without it
From v2.5.0, the backend looks up the role of a signed-in browser session whose token has
no `metadata` claim in Clerk instead (cached for a minute per user), so
permissions still work, at the cost of a Clerk API call per user per minute.
Before v2.5.0, every user without the claim was read-only, admins included: every
admin action failed with **Insufficient permissions** (403). Clerk has no API for
this setting, so no installer can set it for you.
:::

### 4. Make the first admin \{#first-admin}

A role is a `role` key in the user's public metadata: `admin`, `operator`,
`analyst` or `explorer`. A signed-in user with no role gets `explorer`
(read-only), so every new deployment needs one admin, who then manages everyone
else from the web UI.

1. Sign up at `https://<your-domain>/sign-up` (or create the user in the Clerk
   Dashboard under **Users → Create user**).
2. In the Clerk Dashboard, open **Users →** the user **→ Metadata**, select
   **Edit** next to **Public**, set it to the following, and save:

   ```json
   {
     "role": "admin"
   }
   ```

   Leave other keys, such as `org_id`, in place.
3. Sign out of ProjectAchilles and sign in again (or wait a minute) so the
   session picks up the role.

Two installers do this for you: the [Server Installer](./server-installer)
invites or promotes the **first admin email** you give it, and
`./scripts/start.sh` (local development) sets the role for the email you enter.

**More people:** an admin invites them, with a role, from **Settings → Users** in
the web UI.

### 5. Restrict sign-ups \{#restrict-sign-ups}

Anyone who can reach the sign-up page can create an account, and an account with
no role can still read the dashboards and the test library. Unless the app is
only reachable from your own network, open **Configure → Access mode** in the
Clerk Dashboard and either:

- set the sign-up mode to **Invite-only**. Invitations from **Settings → Users**
  and from the Server Installer still work; or
- keep **Open** and enable the **allowlist** with your email domain (a paid Clerk
  feature on production instances).

### 6. Configure OAuth Providers

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
