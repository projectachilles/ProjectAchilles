# ProjectAchilles Production Deployment Checklist

**Target:** projectachilles.io | **Platform:** Railway | **Date:** __________

---

## Pre-Deployment

- [ ] Code committed and pushed to GitHub main branch
- [ ] Backend builds successfully (`npm run build`)
- [ ] Development environment working
- [ ] Clerk development keys working
- [ ] Domain name registered (projectachilles.io)

---

## Phase 1: Clerk Production Setup (30 min)

### Clerk Dashboard Setup
- [ ] Logged into https://dashboard.clerk.com
- [ ] Switched "Project Achilles" to production mode
- [ ] Added authorized domains: `projectachilles.io`, `api.projectachilles.io`
- [ ] Added redirect URLs: `https://projectachilles.io/*`

### Google OAuth Production
- [ ] Created OAuth client at Google Cloud Console
- [ ] Added Clerk redirect URI to Google
- [ ] Copied Client ID: `_______________`
- [ ] Copied Client Secret: `_______________`
- [ ] Added credentials to Clerk
- [ ] Enabled Google OAuth in Clerk

### Microsoft OAuth Production
- [ ] Registered app in Azure Portal
- [ ] Added Clerk redirect URI to Azure
- [ ] Created client secret
- [ ] Copied Application ID: `_______________`
- [ ] Copied Client Secret: `_______________`
- [ ] Added credentials to Clerk
- [ ] Enabled Microsoft OAuth in Clerk

### GitHub OAuth Production
- [ ] Created OAuth app in GitHub
- [ ] Added Clerk callback URL
- [ ] Copied Client ID: `_______________`
- [ ] Copied Client Secret: `_______________`
- [ ] Added credentials to Clerk
- [ ] Enabled GitHub OAuth in Clerk

### Production API Keys
- [ ] Copied Clerk Publishable Key: `pk_live_...`
- [ ] Copied Clerk Secret Key: `sk_live_...`
- [ ] Stored keys securely for Railway setup

---

## Phase 2: Railway Setup (30 min)

### Railway Project
- [ ] Created account at https://railway.app
- [ ] Created new project
- [ ] Connected GitHub repo: `ubercylon8/ProjectAchilles`
- [ ] Railway detected monorepo structure

### Backend Service
- [ ] Service name: `projectachilles-backend`
- [ ] Root directory set to: `/backend`
- [ ] Build command: `npm run build`
- [ ] Start command: `npm run start`

### Backend Environment Variables
- [ ] `CLERK_PUBLISHABLE_KEY=pk_live_...`
- [ ] `CLERK_SECRET_KEY=sk_live_...`
- [ ] `PORT=${{PORT}}`
- [ ] `NODE_ENV=production`
- [ ] `SESSION_SECRET=_______________` (32+ chars)
- [ ] `CORS_ORIGIN=https://projectachilles.io`
- [ ] `TESTS_SOURCE_PATH=../tests_source`

### Frontend Service
- [ ] Service name: `projectachilles-frontend`
- [ ] Root directory set to: `/frontend`
- [ ] Build command: `npm run build`
- [ ] Start command: `npm run preview -- --port $PORT --host 0.0.0.0`

### Frontend Environment Variables
- [ ] `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...`
- [ ] `VITE_API_URL=https://api.projectachilles.io`
- [ ] `VITE_BACKEND_PORT=3000`

### Initial Deployment
- [ ] Backend deployed successfully
- [ ] Frontend deployed successfully
- [ ] Temporary URLs working:
  - Backend: `_______________`
  - Frontend: `_______________`

---

## Phase 3: Domain Configuration (20 min)

### Railway Domain Setup
- [ ] Frontend: Added custom domain `projectachilles.io`
- [ ] Backend: Added custom domain `api.projectachilles.io`
- [ ] Railway provided DNS values:
  - Frontend CNAME: `_______________`
  - Backend CNAME: `_______________`

### DNS Configuration
- [ ] Logged into domain registrar: `_______________`
- [ ] Added CNAME for root/@ → Frontend Railway value
- [ ] Added CNAME for `api` → Backend Railway value
- [ ] TTL set to 3600 seconds
- [ ] DNS changes saved

### Propagation
- [ ] Checked DNS propagation: https://dnschecker.org
- [ ] `projectachilles.io` resolving (wait: ______ min)
- [ ] `api.projectachilles.io` resolving (wait: ______ min)

### SSL Certificates
- [ ] Railway provisioned SSL for `projectachilles.io`
- [ ] Railway provisioned SSL for `api.projectachilles.io`
- [ ] HTTPS working for both domains

---

## Phase 4: Testing (30 min)

### Basic Access
- [ ] https://projectachilles.io loads
- [ ] Redirects to Clerk sign-in page
- [ ] No SSL certificate warnings
- [ ] Padlock icon shows in browser

### OAuth Testing
- [ ] Google sign-in works
- [ ] Microsoft sign-in works
- [ ] GitHub sign-in works
- [ ] Sign-out works
- [ ] Re-authentication works

### Module Testing
- [ ] Browser module: View test list
- [ ] Browser module: View test details
- [ ] Browser module: View test files
- [ ] Analytics module: Access setup page
- [ ] Endpoints module: Access login page

### API Testing
```bash
curl https://api.projectachilles.io/api/health
# Should return: {"status":"ok"...}
```
- [ ] Health endpoint responds
- [ ] API returns proper JSON
- [ ] CORS headers present

### Browser Console
- [ ] No errors in console
- [ ] No CORS errors
- [ ] No mixed content warnings
- [ ] No SSL errors
- [ ] Auth headers present in network tab

---

## Phase 5: Final Verification

### Security Checklist
- [ ] HTTPS enforced (no HTTP access)
- [ ] Session cookies marked as secure
- [ ] CORS restricted to production domain
- [ ] No secrets in GitHub repository
- [ ] Strong SESSION_SECRET (32+ characters)
- [ ] Rate limiting active on auth endpoints

### Performance
- [ ] Page load time < 3 seconds
- [ ] No 500 errors
- [ ] API responses < 1 second
- [ ] Railway metrics showing normal CPU/memory

### Documentation
- [ ] Production URLs documented
- [ ] API keys stored securely
- [ ] Emergency contacts listed
- [ ] Rollback procedure understood

---

## Post-Deployment

### Monitoring Setup
- [ ] Set up Railway alerts for downtime
- [ ] Monitor Clerk MAU usage
- [ ] Track error rates
- [ ] Monitor costs (Railway + Clerk)

### Team Communication
- [ ] Notify team of production deployment
- [ ] Share production URL
- [ ] Document any issues encountered
- [ ] Schedule post-deployment review

---

## Troubleshooting Record

### Issues Encountered:
1. _______________________________________________________________________________
2. _______________________________________________________________________________
3. _______________________________________________________________________________

### Solutions Applied:
1. _______________________________________________________________________________
2. _______________________________________________________________________________
3. _______________________________________________________________________________

---

## Sign-Off

**Deployment Completed:** □ Yes  □ No

**Date:** _______________

**Time:** _______________

**Deployed By:** _______________

**Production URL:** https://projectachilles.io

**Overall Status:** □ Success  □ Issues  □ Rollback Required

**Notes:**
_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________

---

## Quick Reference

**Clerk Dashboard:** https://dashboard.clerk.com
**Railway Dashboard:** https://railway.app
**Google Console:** https://console.cloud.google.com/apis/credentials
**Azure Portal:** https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps
**GitHub OAuth:** https://github.com/settings/developers
**DNS Checker:** https://dnschecker.org

**Support:**
- Railway Docs: https://docs.railway.app
- Clerk Docs: https://clerk.com/docs
- Project Repo: https://github.com/ubercylon8/ProjectAchilles
