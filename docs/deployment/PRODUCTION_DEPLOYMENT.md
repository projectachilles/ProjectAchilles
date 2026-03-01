# ProjectAchilles - Production Deployment Guide

**Target Domain:** projectachilles.io
**Platform:** Railway
**Date:** 2025-12-13

---

## Phase 1: Clerk Production Configuration

### 1.1 Access Clerk Dashboard

1. Go to: https://dashboard.clerk.com
2. Sign in with your account
3. You should see your "Project Achilles" application

### 1.2 Switch to Production Mode

**Option A: Enable Production Mode (Recommended)**
1. Click on "Project Achilles" application
2. Go to **Configure** → **Settings** → **General**
3. Look for "Instance" or "Environment" section
4. Click "Enable Production" or "Switch to Production"
5. Confirm the switch

**Option B: Create New Production Application**
1. Click "Create Application"
2. Name: "ProjectAchilles Production"
3. Select "Use production instance from the start"
4. Choose the same authentication options (Email, Google, Microsoft, GitHub)

### 1.3 Configure Production Domains

1. In Clerk Dashboard, go to **Configure** → **Domains**
2. Add authorized domains:
   ```
   projectachilles.io
   api.projectachilles.io
   ```

3. Configure authorized redirect URLs:
   ```
   https://projectachilles.io
   https://projectachilles.io/*
   https://api.projectachilles.io/*
   ```

4. Save changes

### 1.4 Configure Social OAuth Providers

You need to create **production** OAuth applications for each provider. Development OAuth apps won't work in production.

---

#### 1.4.1 Google OAuth 2.0 Production Setup

**Step 1: Create OAuth Client**
1. Go to: https://console.cloud.google.com/apis/credentials
2. Select your project (or create a new one: "ProjectAchilles Production")
3. Click **Create Credentials** → **OAuth client ID**
4. Application type: **Web application**
5. Name: `ProjectAchilles Production`

**Step 2: Configure Authorized Origins**
```
https://projectachilles.io
```

**Step 3: Get Redirect URIs from Clerk**
1. In Clerk Dashboard, go to **Configure** → **SSO Connections** → **Google**
2. Click **"Use custom credentials"**
3. Copy the **Authorized redirect URI** (will look like):
   ```
   https://accounts.clerk.dev/v1/oauth_callback
   ```
   Or
   ```
   https://clerk.projectachilles.io/v1/oauth_callback
   ```

**Step 4: Add to Google Console**
1. Paste the Clerk redirect URI into Google's "Authorized redirect URIs"
2. Click **Create**
3. Copy the **Client ID** and **Client Secret**

**Step 5: Add to Clerk**
1. Return to Clerk Dashboard → Google settings
2. Paste Client ID and Client Secret
3. Enable Google OAuth
4. Save

---

#### 1.4.2 Microsoft OAuth Production Setup

**Step 1: Register Application**
1. Go to: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps
2. Click **New registration**
3. Name: `ProjectAchilles Production`
4. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
5. Click **Register**

**Step 2: Get Redirect URI from Clerk**
1. In Clerk Dashboard, go to **Configure** → **SSO Connections** → **Microsoft**
2. Click **"Use custom credentials"**
3. Copy the **Redirect URI** provided by Clerk

**Step 3: Configure in Azure**
1. In your app registration, go to **Authentication**
2. Click **Add a platform** → **Web**
3. Paste the Clerk redirect URI
4. Under "Implicit grant and hybrid flows": Check **ID tokens**
5. Click **Configure**

**Step 4: Create Client Secret**
1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Description: `ProjectAchilles Production Secret`
4. Expires: Choose appropriate duration (24 months recommended)
5. Click **Add**
6. **IMPORTANT:** Copy the secret value immediately (you won't see it again)

**Step 5: Get Application IDs**
1. Go to **Overview** page
2. Copy **Application (client) ID**
3. Copy **Directory (tenant) ID** (if needed)

**Step 6: Add to Clerk**
1. Return to Clerk Dashboard → Microsoft settings
2. Paste Client ID
3. Paste Client Secret
4. Enable Microsoft OAuth
5. Save

---

#### 1.4.3 GitHub OAuth Production Setup

**Step 1: Create OAuth App**
1. Go to: https://github.com/settings/developers
2. Click **OAuth Apps** → **New OAuth App**

**Step 2: Configure Application**
1. Application name: `ProjectAchilles Production`
2. Homepage URL: `https://projectachilles.io`
3. Application description: `ProjectAchilles Security Testing Platform`

**Step 3: Get Redirect URI from Clerk**
1. In Clerk Dashboard, go to **Configure** → **SSO Connections** → **GitHub**
2. Click **"Use custom credentials"**
3. Copy the **Authorization callback URL** provided by Clerk

**Step 4: Complete GitHub Setup**
1. Paste the Clerk callback URL into "Authorization callback URL"
2. Click **Register application**
3. Copy the **Client ID**
4. Click **Generate a new client secret**
5. Copy the **Client Secret**

**Step 5: Add to Clerk**
1. Return to Clerk Dashboard → GitHub settings
2. Paste Client ID
3. Paste Client Secret
4. Enable GitHub OAuth
5. Save

---

### 1.5 Copy Production API Keys

1. In Clerk Dashboard, go to **Configure** → **API Keys**
2. Copy the following keys:
   ```
   Publishable key: pk_live_...
   Secret key: sk_live_...
   ```

3. **SAVE THESE SECURELY** - You'll need them for Railway environment variables

---

## Phase 2: Railway Setup

### 2.1 Create Railway Account & Project

1. Go to: https://railway.app
2. Sign up or sign in (recommend using GitHub for easy repo connection)
3. Click **New Project**
4. Select **Deploy from GitHub repo**
5. Connect your GitHub account if not already connected
6. Search for and select: `projectachilles/ProjectAchilles`
7. Click **Deploy**

Railway will detect the monorepo structure automatically.

### 2.2 Configure Backend Service

**Step 1: Create Backend Service**
1. In Railway project dashboard, click **+ New**
2. Select **GitHub Repo** → Choose `ProjectAchilles` again
3. Or Railway may auto-detect both services

**Step 2: Configure Backend Settings**
1. Click on the backend service
2. Go to **Settings**
3. Configure:
   - **Name:** `projectachilles-backend`
   - **Root Directory:** `/backend`
   - **Build Command:** (leave default or set to `npm run build`)
   - **Start Command:** (leave default or set to `npm run start`)

**Step 3: Set Environment Variables**
1. Click **Variables** tab
2. Click **Raw Editor**
3. Paste the following (replace values with your actual keys):

```env
# Clerk Authentication (PRODUCTION KEYS)
CLERK_PUBLISHABLE_KEY=pk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXX
CLERK_SECRET_KEY=sk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Server (Railway auto-injects PORT)
PORT=${{PORT}}
NODE_ENV=production

# Session Secret (CRITICAL - generate strong secret)
SESSION_SECRET=REPLACE_WITH_32_CHAR_RANDOM_STRING_FROM_BELOW

# CORS (will update after domain setup)
CORS_ORIGIN=https://projectachilles.io

# Test Sources Path
TESTS_SOURCE_PATH=../tests_source
```

**Step 4: Generate SESSION_SECRET**

Choose one method:

**Option 1 - Online (Quick):**
```bash
# Run this in your local terminal:
openssl rand -base64 32
```

**Option 2 - Node.js:**
```bash
# Run this in your local terminal:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Option 3 - Railway Generator:**
- In Variables tab, there might be a "Generate" button for secrets

Copy the generated value and replace `REPLACE_WITH_32_CHAR_RANDOM_STRING_FROM_BELOW` in SESSION_SECRET.

4. Click **Add** or **Save**

### 2.3 Configure Frontend Service

**Step 1: Create Frontend Service** (if not auto-created)
1. Click **+ New** → **GitHub Repo** → `ProjectAchilles`

**Step 2: Configure Frontend Settings**
1. Click on the frontend service
2. Go to **Settings**
3. Configure:
   - **Name:** `projectachilles-frontend`
   - **Root Directory:** `/frontend`
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run preview -- --port $PORT --host 0.0.0.0`

**Step 3: Set Environment Variables**
1. Click **Variables** tab
2. Click **Raw Editor**
3. Paste the following:

```env
# Clerk Authentication (PRODUCTION KEYS - same as backend)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# API Configuration (will update after domain setup)
VITE_API_URL=https://api.projectachilles.io

# Backend Port (not critical in production)
VITE_BACKEND_PORT=3000
```

4. Click **Add** or **Save**

### 2.4 Get Temporary Railway URLs

After deployment completes (watch the logs):

1. Backend URL will be something like:
   ```
   https://projectachilles-backend.up.railway.app
   ```

2. Frontend URL will be something like:
   ```
   https://projectachilles-frontend.up.railway.app
   ```

**Test these URLs to ensure deployment worked!**

---

## Phase 3: Custom Domain Configuration

### 3.1 Configure Domains in Railway

**Frontend Domain Setup:**
1. Select frontend service
2. Go to **Settings** → **Networking** → **Public Networking**
3. Click **Generate Domain** (if not already done)
4. Click **Custom Domain**
5. Enter: `projectachilles.io`
6. Railway will provide DNS configuration instructions

**Backend Domain Setup:**
1. Select backend service
2. Go to **Settings** → **Networking** → **Public Networking**
3. Click **Generate Domain** (if not already done)
4. Click **Custom Domain**
5. Enter: `api.projectachilles.io`
6. Railway will provide DNS configuration instructions

Railway will show you something like:
```
Add a CNAME record:
Name: @
Value: proxy.railway.app

OR

Name: projectachilles.io
Value: [specific-value].proxy.railway.app
```

### 3.2 Configure DNS at Domain Registrar

**Where to go:**
- Go to your domain registrar (where you bought projectachilles.io)
- Examples: Namecheap, GoDaddy, Cloudflare, Google Domains, etc.
- Find DNS settings / DNS management

**Add CNAME Records:**

**Record 1: Frontend (Root Domain)**
```
Type: CNAME
Name: @ (or leave blank, or "projectachilles.io")
Value: [value provided by Railway]
TTL: 3600
```

**Record 2: Backend (API Subdomain)**
```
Type: CNAME
Name: api
Value: [value provided by Railway for backend]
TTL: 3600
```

**Note:** Some registrars don't allow CNAME for root domain. If this is the case:
- Use ALIAS record if available (Cloudflare, DNSimple)
- Or use A record pointing to Railway's IP (check Railway docs)

**Save DNS changes**

### 3.3 Wait for DNS Propagation

- DNS changes can take 5 minutes to 48 hours
- Usually propagates in 15-60 minutes
- Check status: https://dnschecker.org

### 3.4 Update Environment Variables with Final Domains

**Backend Service:**
1. Go to Variables
2. Update `CORS_ORIGIN`:
   ```
   CORS_ORIGIN=https://projectachilles.io
   ```

**Frontend Service:**
1. Go to Variables
2. Update `VITE_API_URL`:
   ```
   VITE_API_URL=https://api.projectachilles.io
   ```

**Important:** Railway will auto-redeploy when you change variables.

### 3.5 Update Clerk Authorized Domains

1. Go back to Clerk Dashboard
2. **Configure** → **Domains**
3. Ensure these are added:
   ```
   projectachilles.io
   api.projectachilles.io
   ```
4. Update OAuth redirect URLs in Google, Microsoft, GitHub if they use the domain (usually Clerk handles this)

---

## Phase 4: Testing & Verification

### 4.1 SSL Certificate Check
1. Visit: https://projectachilles.io
2. Look for padlock icon in browser
3. Click padlock → verify certificate is valid
4. Certificate should be issued by Let's Encrypt (Railway's provider)

### 4.2 Authentication Flow Testing

**Test Each OAuth Provider:**

1. **Google OAuth:**
   - Go to https://projectachilles.io
   - Should redirect to Clerk sign-in
   - Click "Sign in with Google"
   - Complete Google authentication
   - Should redirect back to app and be signed in
   - Check browser console for errors (F12)

2. **Microsoft OAuth:**
   - Sign out
   - Click "Sign in with Microsoft"
   - Complete Microsoft authentication
   - Verify successful sign-in

3. **GitHub OAuth:**
   - Sign out
   - Click "Sign in with GitHub"
   - Complete GitHub authentication
   - Verify successful sign-in

### 4.3 Module Testing

**Browser Module:**
- ✅ Can view test list
- ✅ Can view test details
- ✅ Can view test files

**Analytics Module:**
- ✅ Can access setup page
- ✅ Can save Elasticsearch configuration (if you have ES)
- ✅ Settings persist across sessions

**Endpoints Module:**
- ✅ Can access login page
- ✅ Can enter LimaCharlie credentials (if you have LC)
- ✅ Session works correctly

### 4.4 API Testing

Test backend API:
```bash
# Should return 401 (no auth)
curl https://api.projectachilles.io/api/browser/tests

# Check health endpoint
curl https://api.projectachilles.io/api/health
```

Expected health response:
```json
{
  "status": "ok",
  "service": "ProjectAchilles",
  "version": "1.0.0",
  "timestamp": "2025-12-13T..."
}
```

### 4.5 Browser DevTools Check

1. Open browser DevTools (F12)
2. Go to **Console** tab
3. Visit https://projectachilles.io
4. Should see NO errors related to:
   - Clerk authentication
   - CORS
   - Mixed content (HTTP/HTTPS)
   - SSL certificate issues

5. Go to **Network** tab
6. Refresh page
7. Check API calls:
   - Should all use HTTPS
   - Should have proper Authorization headers
   - Should return 200/401 (not 500)

---

## Phase 5: Post-Deployment Checklist

### Production Configuration
- [ ] Clerk production instance enabled
- [ ] All OAuth providers configured for production domains
- [ ] Production API keys set in Railway
- [ ] SESSION_SECRET is strong and secure
- [ ] CORS_ORIGIN set to production domain
- [ ] Custom domains configured in Railway
- [ ] DNS records added at registrar
- [ ] DNS propagation complete
- [ ] SSL certificate active and valid

### Testing Complete
- [ ] https://projectachilles.io loads
- [ ] Redirects to Clerk sign-in
- [ ] Google OAuth works
- [ ] Microsoft OAuth works
- [ ] GitHub OAuth works
- [ ] Can access Browser module
- [ ] Can access Analytics setup
- [ ] Can access Endpoints login
- [ ] No console errors
- [ ] API calls succeed
- [ ] Sessions work correctly

### Security
- [ ] HTTPS enabled and enforced
- [ ] Session cookies are secure
- [ ] CORS properly configured
- [ ] No secrets in repository
- [ ] Rate limiting active

---

## Troubleshooting

### Issue: DNS not resolving

**Check:**
```bash
dig projectachilles.io
dig api.projectachilles.io
```

**Solution:**
- Wait longer (up to 48 hours)
- Verify CNAME records are correct
- Check TTL values
- Use https://dnschecker.org to see propagation status

### Issue: OAuth failing

**Check:**
1. Clerk authorized domains include production domain
2. OAuth apps use production redirect URIs
3. OAuth client IDs and secrets are correct
4. Browser console for specific error messages

**Solution:**
- Verify each OAuth provider configuration
- Check Clerk Dashboard → Sessions → Recent attempts for errors
- Ensure production keys (pk_live_, sk_live_) are used

### Issue: CORS errors

**Check:**
```
Access-Control-Allow-Origin errors in console
```

**Solution:**
1. Verify `CORS_ORIGIN=https://projectachilles.io` in backend variables
2. Ensure no trailing slashes
3. Redeploy backend after changing variable
4. Check Railway logs for CORS middleware messages

### Issue: "Invalid session" errors

**Check:**
- Backend logs in Railway
- Browser cookies

**Solution:**
1. Clear browser cookies for projectachilles.io
2. Verify SESSION_SECRET is set in backend
3. Check `trust proxy` is set in server.ts (should be from our commit)
4. Ensure secure cookies work (HTTPS enabled)

### Issue: 502 Bad Gateway

**Check:**
- Railway deployment logs
- Railway service status

**Solution:**
1. Check if backend is actually running in Railway
2. Verify START_COMMAND is correct
3. Check for build errors in logs
4. Verify PORT environment variable is used

### Issue: Build failures

**Check Railway logs for:**
```
npm ERR!
Error: Cannot find module
TypeScript errors
```

**Solution:**
1. Verify root directories are correct (/backend, /frontend)
2. Check package.json scripts
3. Ensure dependencies are in package.json (not just devDependencies for production deps)
4. Try redeploying

---

## Monitoring & Maintenance

### Railway Monitoring

1. **Deployment Logs:**
   - Click on service → **Deployments**
   - View build and runtime logs
   - Check for errors

2. **Metrics:**
   - Click on service → **Metrics**
   - Monitor CPU, Memory, Network
   - Set up alerts for high usage

3. **Costs:**
   - Railway Starter: $5/month per service
   - Monitor usage in **Account** → **Usage**

### Clerk Monitoring

1. **Dashboard:**
   - Monitor Monthly Active Users (MAU)
   - Free tier: 0-10k MAU
   - View authentication analytics

2. **Sessions:**
   - Check recent sign-ins
   - Monitor failure rates
   - Review suspicious activity

---

## Rollback Procedure

If production deployment fails:

### 1. Revert in Railway
1. Go to **Deployments**
2. Find previous working deployment
3. Click **⋮** menu → **Redeploy**

### 2. DNS Rollback (if needed)
1. Update DNS CNAME records to previous hosting
2. Wait for propagation

### 3. Code Rollback
```bash
git log --oneline  # Find commit to revert to
git revert HEAD
git push origin main
# Railway will auto-deploy
```

---

## Next Steps After Production

1. **Set up monitoring:** Consider Sentry, LogRocket, or Railway's built-in monitoring
2. **Configure backups:** If using databases, ensure backups are enabled
3. **Set up CI/CD:** Consider GitHub Actions for automated testing
4. **Add error tracking:** Implement error logging and alerting
5. **Performance monitoring:** Track page load times, API response times
6. **Security scanning:** Regular dependency updates, security audits

---

## Support Resources

- **Railway Docs:** https://docs.railway.app
- **Clerk Docs:** https://clerk.com/docs
- **Project Issues:** https://github.com/projectachilles/ProjectAchilles/issues

---

**Deployment Date:** _______________
**Deployed By:** _______________
**Production URL:** https://projectachilles.io
**Status:** □ Success  □ Issues (describe below)

**Notes:**
_______________________________________________________________________________
_______________________________________________________________________________
_______________________________________________________________________________
