---
sidebar_position: 8
title: Production Checklist
description: Pre-flight checklist for deploying ProjectAchilles to production — security, configuration, testing, and verification.
---

# Production Checklist

Use this checklist before going live with any deployment target.

## Pre-Deployment

- [ ] Code committed and pushed to GitHub main branch
- [ ] Backend builds successfully (`npm run build`)
- [ ] Frontend builds successfully (`npm run build`)
- [ ] All tests pass (`npm test` in backend and frontend)
- [ ] Development environment working with current code

## Phase 1: Authentication (30 min)

### Clerk Setup

- [ ] Created Clerk production instance
- [ ] Added authorized domains (frontend + backend URLs)
- [ ] Added redirect URLs: `https://<your-domain>/*`
- [ ] Copied production API keys (`pk_live_...`, `sk_live_...`)

### OAuth Providers (Production Requires Custom Credentials)

:::danger OAuth Configuration Required
Clerk development instances use shared OAuth credentials. **Production instances require your own.** Without them, social login buttons redirect with an empty `client_id`, resulting in a 404 error.
:::

**Google OAuth:**
- [ ] Created OAuth client at [Google Cloud Console](https://console.cloud.google.com)
- [ ] Added Clerk redirect URI: `https://clerk.<your-domain>/v1/oauth_callback`
- [ ] Entered Client ID and Client Secret in Clerk Dashboard

**GitHub OAuth:**
- [ ] Created OAuth app at [GitHub Developer Settings](https://github.com/settings/developers)
- [ ] Set callback URL to Clerk callback URL
- [ ] Entered Client ID and Client Secret in Clerk Dashboard

**Microsoft OAuth (if enabled):**
- [ ] Registered app in [Azure Portal](https://portal.azure.com)
- [ ] Added Clerk redirect URI
- [ ] Entered Application ID and Client Secret in Clerk Dashboard

## Phase 2: Infrastructure Setup (30 min)

### Backend

- [ ] Service deployed and running
- [ ] Persistent storage configured (volume/disk/Blob)
- [ ] All environment variables set (see [Environment Variables](./environment-variables))
- [ ] `ENCRYPTION_SECRET` set to a stable random value
- [ ] `SESSION_SECRET` set to a strong random value
- [ ] `CORS_ORIGIN` set to frontend URL (with `https://`)
- [ ] `AGENT_SERVER_URL` set to backend URL (with `https://`)

### Frontend

- [ ] Service deployed and running
- [ ] `VITE_CLERK_PUBLISHABLE_KEY` set (with `VITE_` prefix)
- [ ] API URL configured (via `VITE_API_URL` or nginx proxy)

### Elasticsearch

- [ ] Elastic Cloud deployment active
- [ ] `ELASTICSEARCH_CLOUD_ID` and `ELASTICSEARCH_API_KEY` configured
- [ ] Connection verified via Analytics → Setup

## Phase 3: Domain Configuration (20 min)

- [ ] Custom domains added to hosting provider
- [ ] DNS records created (CNAME for Render/Vercel, A/AAAA for Fly.io)
- [ ] DNS propagation verified: `dig <your-domain> +short`
- [ ] TLS certificates provisioned (auto via Let's Encrypt)
- [ ] HTTPS working for both frontend and backend
- [ ] Clerk DNS records added (`clerk.<domain>` CNAME)
- [ ] Environment variables updated with custom domain URLs

## Phase 4: Testing (30 min)

### Basic Access

- [ ] Frontend loads at production URL
- [ ] Redirects to Clerk sign-in page
- [ ] No SSL certificate warnings
- [ ] HTTPS enforced (HTTP redirects to HTTPS)

### Authentication

- [ ] Google sign-in works
- [ ] GitHub sign-in works
- [ ] Microsoft sign-in works (if enabled)
- [ ] Sign-out works
- [ ] Re-authentication works after session expiry

### Module Testing

- [ ] Browser: View test list
- [ ] Browser: View test details and files
- [ ] Analytics: Setup page accessible
- [ ] Analytics: Dashboard renders with ES data
- [ ] Agent: Enrollment token creation
- [ ] Agent: Agent management page loads

### API Verification

```bash
curl https://<backend-domain>/api/health
# Expected: {"status":"ok","service":"ProjectAchilles",...}
```

- [ ] Health endpoint responds
- [ ] CORS headers present on cross-origin requests
- [ ] Rate limiting active (enrollment: 5/15min)

### Browser Console

- [ ] No JavaScript errors
- [ ] No CORS errors
- [ ] No mixed content warnings
- [ ] Auth headers present in network requests

## Phase 5: Security

- [ ] HTTPS enforced on all endpoints
- [ ] Session cookies marked as Secure and HttpOnly
- [ ] CORS restricted to production domain only
- [ ] No secrets committed to the repository
- [ ] Strong SESSION_SECRET (32+ characters)
- [ ] Strong ENCRYPTION_SECRET (32+ characters)
- [ ] Rate limiting active on auth and enrollment endpoints
- [ ] Elasticsearch credentials stored encrypted

## Post-Deployment

- [ ] Set up monitoring/alerting for downtime
- [ ] Document production URLs and configuration
- [ ] Store API keys securely (password manager or vault)
- [ ] Schedule post-deployment review
- [ ] Test agent enrollment and task execution end-to-end
