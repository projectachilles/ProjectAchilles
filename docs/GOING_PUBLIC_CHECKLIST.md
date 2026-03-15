# Going Public Checklist: f0_library

Instructions for transitioning f0_library from private to public. Follow these steps when the repo visibility is switched on GitHub.

**Pre-requisite:** The f0_library repo has been made public at `https://github.com/ubercylon8/f0_library`.

---

## 1. Verify zero-config auto-clone works

Before touching any code, confirm the auto-bootstrap works without a token:

```bash
# Remove all test-related env vars from backend/.env
# (comment out or delete these lines)
# TESTS_REPO_URL=...
# GITHUB_TOKEN=...

# Delete the cached clone
rm -rf backend/data/f0_library

# Start backend
cd backend && npm run dev
```

Expected: the server logs `Initializing test repository sync...` and clones from the default URL without authentication. Tests appear in the Browser module.

---

## 2. Code changes (single PR)

### 2a. Remove GITHUB_TOKEN from backend/.env

Delete or comment out `GITHUB_TOKEN` from `backend/.env`. It's no longer needed for the default f0_library sync.

### 2b. Remove GITHUB_TOKEN from .env.example / setup docs

Search for `GITHUB_TOKEN` references in documentation:

```bash
grep -rn 'GITHUB_TOKEN' \
  backend/.env.example \
  docs/ \
  scripts/ \
  docker-compose.yml \
  README.md \
  CLAUDE.md
```

Remove or mark as optional with a note: *"Only needed for private test repositories."*

### 2c. Update vercel-build for tokenless cloning

The `backend-serverless/package.json` `vercel-build` script already handles this -- it conditionally injects the token only when `GITHUB_TOKEN` is set. **No code change needed** (this was done in the hybrid test library PR).

Verify by reading the script:
```bash
grep 'vercel-build' backend-serverless/package.json
```

It should show the conditional: `if [ -n "$GITHUB_TOKEN" ]; then CLONE_URL=...; else CLONE_URL="$REPO_URL"; fi`

### 2d. Consider GitHubMetadataService without token

The `GitHubMetadataService` (last-modified dates for tests) is currently gated on both `repoUrl && process.env.GITHUB_TOKEN` in `server.ts` (around line 155).

**Decision point:** Public repos allow 60 unauthenticated GitHub API requests/hour. With 44+ tests, each needing a separate API call, this limit is hit quickly. Two options:

- **Option A (recommended):** Leave gated. Document that `GITHUB_TOKEN` is optional but improves metadata freshness. Users who want last-modified dates can set a token.
- **Option B:** Remove the gate, add rate-limit handling. More complex, marginal benefit.

If choosing Option A, no code change needed.

---

## 3. Remove GITHUB_TOKEN from deployment targets

### Vercel
```bash
cd backend-serverless
vercel env rm GITHUB_TOKEN production
vercel env rm GITHUB_TOKEN preview
```
Redeploy to pick up the change:
```bash
npx vercel --prod
```

### Fly.io
```bash
flyctl secrets unset GITHUB_TOKEN -a achilles-backend
```
The app restarts automatically.

### Railway
Remove `GITHUB_TOKEN` from the service's environment variables in the Railway Dashboard.

### Render
Remove `GITHUB_TOKEN` from the service's environment variables in the Render Dashboard.

---

## 4. Update deployment guides

Remove `GITHUB_TOKEN` from the "required secrets" / "environment variables" sections in:

- [ ] `docs/deployment/VERCEL.md`
- [ ] `docs/deployment/FLY.md`
- [ ] `docs/deployment/RAILWAY.md`
- [ ] `docs/deployment/RENDER.md`

In each guide, the `GITHUB_TOKEN` row in the env var table should either be removed or moved to an "Optional" section with the note: *"Only needed for private test repositories or to enable last-modified date metadata."*

---

## 5. Update CLAUDE.md

In the root `CLAUDE.md`, the "Common Workflow" and env var sections reference `GITHUB_TOKEN`. Update to reflect it's optional.

In `backend-serverless/CLAUDE.md`, the "Environment Variables" section lists `TESTS_REPO_URL` / `GITHUB_TOKEN`. Update similarly.

---

## 6. Verification matrix

Run each of these scenarios to confirm everything works:

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Fresh `docker compose up` with no `.env` overrides | Tests auto-clone from public URL, appear in Browser |
| 2 | `docker compose up` with `GITHUB_TOKEN` still set | Same as #1 (token is harmless, just unused for public repos) |
| 3 | `TESTS_REPO_URL=` (empty string) | No auto-clone, local-only mode, zero tests unless custom tests exist |
| 4 | `./scripts/start.sh -k --daemon` with no token | Backend starts, clones f0_library, tests available |
| 5 | Click Sync in Browser | Pulls latest from public repo, custom tests unaffected |
| 6 | Vercel redeploy without `GITHUB_TOKEN` | Build-time clone succeeds, tests available |
| 7 | Fly.io deploy without `GITHUB_TOKEN` | Runtime clone succeeds on first start |
| 8 | Custom test at `~/.projectachilles/custom-tests/mitre-top10/<uuid>/` | Shows with CUSTOM badge alongside upstream tests |

---

## 7. Announce

Once verified:

1. Update the main `README.md` to highlight zero-config test library setup
2. Remove any "Private repo setup" instructions that referenced token generation
3. Consider adding a "Quick Start" section: `docker compose up` and tests just work

---

## Timeline

- **Code PR:** Can be prepared before the repo goes public (all changes are backward-compatible)
- **Deploy:** Immediately after the GitHub visibility switch
- **Cleanup:** Deployment guides and CLAUDE.md updates can follow within the same day
