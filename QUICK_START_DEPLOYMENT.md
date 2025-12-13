# ProjectAchilles - Quick Start Deployment

**5-Step Production Deployment Guide**

---

## Step 1: Clerk Production (10 min)

```
1. Go to: https://dashboard.clerk.com
2. Enable production mode on "Project Achilles"
3. Add domains: projectachilles.io, api.projectachilles.io
4. Configure OAuth (Google, Microsoft, GitHub) for production
5. Copy: pk_live_... and sk_live_...
```

**OAuth Setup Summary:**
- **Google:** console.cloud.google.com → Create OAuth client → Add Clerk redirect URI
- **Microsoft:** portal.azure.com → Register app → Add Clerk redirect URI → Create secret
- **GitHub:** github.com/settings/developers → New OAuth app → Add Clerk callback URL

---

## Step 2: Railway Backend (10 min)

```
1. Go to: https://railway.app → New Project → From GitHub
2. Select: ubercylon8/ProjectAchilles
3. Configure backend service:
   - Name: projectachilles-backend
   - Root: /backend

4. Add Variables (Raw Editor):
```

```env
CLERK_PUBLISHABLE_KEY=pk_live_YOUR_KEY_HERE
CLERK_SECRET_KEY=sk_live_YOUR_KEY_HERE
PORT=${{PORT}}
NODE_ENV=production
SESSION_SECRET=GENERATE_32_CHAR_RANDOM_STRING
CORS_ORIGIN=https://projectachilles.io
TESTS_SOURCE_PATH=../tests_source
```

**Generate SESSION_SECRET:**
```bash
openssl rand -base64 32
```

---

## Step 3: Railway Frontend (10 min)

```
1. Configure frontend service:
   - Name: projectachilles-frontend
   - Root: /frontend
   - Start Command: npm run preview -- --port $PORT --host 0.0.0.0

2. Add Variables (Raw Editor):
```

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_live_YOUR_KEY_HERE
VITE_API_URL=https://api.projectachilles.io
VITE_BACKEND_PORT=3000
```

---

## Step 4: Custom Domains (15 min)

### In Railway:
```
Frontend Service → Settings → Custom Domain:
  Add: projectachilles.io

Backend Service → Settings → Custom Domain:
  Add: api.projectachilles.io
```

Railway will show CNAME values like:
- `specific-value.up.railway.app` or `proxy.railway.app`

### At Domain Registrar:
```
CNAME Record 1:
  Name: @ (or projectachilles.io)
  Value: [Railway provided value for frontend]
  TTL: 3600

CNAME Record 2:
  Name: api
  Value: [Railway provided value for backend]
  TTL: 3600
```

**Wait 15-60 minutes for DNS propagation**

Check: https://dnschecker.org

---

## Step 5: Test (5 min)

```bash
# 1. Visit production URL
https://projectachilles.io

# 2. Test OAuth
- Sign in with Google
- Sign in with Microsoft
- Sign in with GitHub

# 3. Test API
curl https://api.projectachilles.io/api/health

# 4. Check browser console (F12)
- No errors?
- HTTPS working?
- Auth working?
```

---

## Troubleshooting

**DNS not working?**
→ Wait longer (up to 48 hours)
→ Check CNAME records are correct

**OAuth failing?**
→ Check production OAuth apps have correct redirect URIs
→ Verify pk_live_ and sk_live_ keys in Railway

**CORS errors?**
→ Check CORS_ORIGIN in backend variables
→ Redeploy backend after changing

**502 errors?**
→ Check Railway logs for build/startup errors
→ Verify environment variables are set

---

## Quick Commands

**Check DNS:**
```bash
dig projectachilles.io
dig api.projectachilles.io
```

**Test API:**
```bash
curl https://api.projectachilles.io/api/health
```

**Generate SESSION_SECRET:**
```bash
openssl rand -base64 32
# OR
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## URLs

- **Clerk:** https://dashboard.clerk.com
- **Railway:** https://railway.app
- **Google OAuth:** https://console.cloud.google.com/apis/credentials
- **Microsoft OAuth:** https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps
- **GitHub OAuth:** https://github.com/settings/developers
- **DNS Checker:** https://dnschecker.org

---

## Success Criteria

✅ https://projectachilles.io loads
✅ SSL certificate valid (padlock icon)
✅ Redirects to Clerk sign-in
✅ All 3 OAuth providers work
✅ Can access browser module
✅ No console errors
✅ API health check returns 200

---

**Total Time:** ~50 minutes (+ DNS propagation wait)

**For detailed instructions, see:** `PRODUCTION_DEPLOYMENT.md`
