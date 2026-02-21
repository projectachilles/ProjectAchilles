# Vercel Production Setup — Custom Domains & Clerk

This guide covers promoting a Vercel deployment from development to production with custom domains and Clerk production credentials. It assumes you already have a working Vercel deployment (see `VERCEL.md` for initial setup).

## Overview

| Component | Development | Production |
|-----------|------------|------------|
| **Frontend URL** | `*.vercel.app` | `<frontend>.<yourdomain>` |
| **Backend URL** | `*.vercel.app` | `<backend>.<yourdomain>` |
| **Clerk instance** | Development (`pk_test_`) | Production (`pk_live_`) |
| **OAuth providers** | Clerk shared credentials | Custom GitHub & Google apps |

## Step 1: Create Clerk Production Instance

1. Go to [Clerk Dashboard](https://dashboard.clerk.com) and select your Vercel app
2. Click the **Development** dropdown in the top breadcrumb
3. Click **Create production instance**
4. Choose **Clone from Development** — this copies your auth settings (email/password, social providers, etc.)
5. Set your **Application domain** to your frontend domain (e.g., `<frontend>.<yourdomain>`)
6. Complete the setup wizard

> **Note**: Clerk's "Secondary application" option is correct for subdomain-based deployments. "Primary application" claims the root domain.

## Step 2: DNS Records

Clerk requires 5 CNAME records, and Vercel requires A records for each custom domain. All records go in your DNS provider for the parent domain (e.g., `<yourdomain>`).

### Clerk CNAME Records

| Type | Name | Value |
|------|------|-------|
| CNAME | `clerk.<frontend>` | `frontend-api.clerk.services` |
| CNAME | `accounts.<frontend>` | `accounts.clerk.services` |
| CNAME | `clkmail.<frontend>` | `mail.<your-clerk-id>.clerk.services` |
| CNAME | `clk._domainkey.<frontend>` | `dkim1.<your-clerk-id>.clerk.services` |
| CNAME | `clk2._domainkey.<frontend>` | `dkim2.<your-clerk-id>.clerk.services` |

> The exact CNAME values (including `<your-clerk-id>`) are shown on the Clerk Dashboard under **Configure → Domains**.

### Vercel A Records

| Type | Name | Value |
|------|------|-------|
| A | `<frontend>` | `76.76.21.21` |
| A | `<backend>` | `76.76.21.21` |

> `76.76.21.21` is Vercel's IP for custom domains.

### Verify DNS

After adding the records, verify propagation in the Clerk Dashboard (**Configure → Domains**). Clerk checks all 5 CNAMEs and issues SSL certificates automatically. DNS can take up to 5 minutes to propagate.

## Step 3: Add Custom Domains in Vercel

Add domain aliases to each Vercel project:

```bash
# Frontend project
cd frontend
vercel alias <frontend>.<yourdomain>

# Backend project
cd backend-serverless
vercel alias <backend>.<yourdomain>
```

Or add them via the Vercel Dashboard under **Project → Settings → Domains**.

## Step 4: Get Production API Keys

From the Clerk Dashboard (make sure **production** environment is selected):

1. Go to **API keys**
2. Copy the **Publishable key** (`pk_live_...`)
3. Reveal and copy the **Secret key** (`sk_live_...`)

## Step 5: Update Vercel Environment Variables

Remove old development values and set production ones. Use `printf` (not `echo`) to avoid trailing newline issues.

### Backend (`backend-serverless/`)

```bash
cd backend-serverless

# CORS origin — must exactly match frontend domain (no trailing slash)
printf "https://<frontend>.<yourdomain>" | vercel env add CORS_ORIGIN production

# Clerk production keys
printf "pk_live_..." | vercel env add CLERK_PUBLISHABLE_KEY production
printf "sk_live_..." | vercel env add CLERK_SECRET_KEY production

# Agent server URL — agents connect to the backend domain
printf "https://<backend>.<yourdomain>" | vercel env add AGENT_SERVER_URL production
```

### Frontend (`frontend/`)

```bash
cd frontend

# Clerk publishable key (must have VITE_ prefix for Vite)
printf "pk_live_..." | vercel env add VITE_CLERK_PUBLISHABLE_KEY production

# API URL — frontend calls the backend domain
printf "https://<backend>.<yourdomain>" | vercel env add VITE_API_URL production
```

> **Important**: `echo` adds a trailing `\n` which breaks header values and URL parsing. Always use `printf`.

## Step 6: Redeploy Both Projects

Vercel bakes env vars into the build, so both projects must be redeployed after changing env vars:

```bash
cd backend-serverless && vercel --prod
cd frontend && vercel --prod
```

## Step 7: Configure OAuth Providers

Production Clerk instances require custom OAuth credentials (Clerk's shared dev credentials are not available).

### GitHub OAuth

1. Go to [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: `<your-app-name>`
   - **Homepage URL**: `https://<frontend>.<yourdomain>`
   - **Authorization callback URL**: `https://clerk.<frontend>.<yourdomain>/v1/oauth_callback`
4. Click **Register application**
5. Copy the **Client ID** and generate a **Client Secret**
6. In Clerk Dashboard → **Configure → SSO connections → GitHub**:
   - Paste Client ID and Client Secret
   - Save

### Google OAuth

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Select or create a project
3. If prompted, configure the **OAuth consent screen**:
   - User type: **External**
   - App name: `<your-app-name>`
   - Authorized domains: `<yourdomain>`
4. Create credentials → **OAuth client ID**:
   - Application type: **Web application**
   - Name: `<your-app-name> - Vercel`
   - **Authorized redirect URIs**: `https://clerk.<frontend>.<yourdomain>/v1/oauth_callback`
   - Leave "Authorized JavaScript origins" **empty**
5. Copy the **Client ID** and **Client Secret**
6. In Clerk Dashboard → **Configure → SSO connections → Google**:
   - Paste Client ID and Client Secret
   - Save

> **Gotcha**: Do not paste the callback URL in "Authorized JavaScript origins" — that field does not accept paths. Only use "Authorized redirect URIs".

## Step 8: Verify

1. Navigate to `https://<frontend>.<yourdomain>`
2. Sign in with GitHub — should redirect through `clerk.<frontend>.<yourdomain>` and return
3. Sign in with Google — same flow
4. Verify the backend responds: `curl https://<backend>.<yourdomain>/api/health`

## Summary of URLs

| Service | URL |
|---------|-----|
| Frontend | `https://<frontend>.<yourdomain>` |
| Backend API | `https://<backend>.<yourdomain>` |
| Clerk Frontend API | `https://clerk.<frontend>.<yourdomain>` |
| Clerk Account Portal | `https://accounts.<frontend>.<yourdomain>` |
| Health Check | `https://<backend>.<yourdomain>/api/health` |

## Troubleshooting

### "Invalid character in header content" (500 error)
The `CORS_ORIGIN` env var has a trailing newline. Re-set it with `printf` (not `echo`):
```bash
printf "https://<frontend>.<yourdomain>" | vercel env add CORS_ORIGIN production
```

### Clerk sign-in redirects to wrong domain
Check that `VITE_CLERK_PUBLISHABLE_KEY` uses the `pk_live_` key, not `pk_test_`. The publishable key encodes the domain — using a dev key will redirect to `*.clerk.accounts.dev`.

### OAuth callback fails
- Verify the callback URL in both the OAuth provider (GitHub/Google) and Clerk match exactly: `https://clerk.<frontend>.<yourdomain>/v1/oauth_callback`
- For Google: ensure the URL is in "Authorized redirect URIs", **not** "Authorized JavaScript origins"

### DNS not resolving
- CNAME records can take up to 5 minutes to propagate
- Use `dig CNAME clerk.<frontend>.<yourdomain>` to check propagation
- All 5 Clerk CNAMEs must verify before SSL certificates are issued
