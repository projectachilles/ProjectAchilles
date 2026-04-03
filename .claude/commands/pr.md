# Create Pull Request

Create a well-formatted PR following ProjectAchilles conventions.

## Steps

### 1. Validate Branch

Check the current branch name:
```bash
git branch --show-current
```

Validate it follows the naming convention:
- `feature/*` — New feature
- `fix/*` — Bug fix
- `docs/*` — Documentation
- `refactor/*` — Refactoring
- `chore/*` — Maintenance
- `perf/*` — Performance improvement
- `test/*` — Test changes

If the branch doesn't follow convention, warn but continue.

### 2. Analyze Changes

Gather information about what changed:

```bash
# Commits on this branch
git log main..HEAD --oneline --no-merges

# Files changed (with stats)
git diff --stat main..HEAD

# Full diff for understanding changes
git diff main..HEAD --name-only
```

Map changed files to modules:
| Path prefix | Module |
|-------------|--------|
| `frontend/src/pages/browser/` | Browser |
| `frontend/src/pages/analytics/` | Analytics |
| `frontend/src/pages/endpoints/` | Agents |
| `frontend/src/components/` | Core/Infrastructure |
| `backend/src/services/agent/` | Agents |
| `backend/src/services/analytics/` | Analytics |
| `backend/src/services/browser/` | Browser |
| `backend/src/services/tests/` | Build & Settings |
| `backend/src/services/alerting/` | Alerting |
| `backend/src/services/defender/` | Defender |
| `backend-serverless/` | Core/Infrastructure |
| `agent/` | Agents |
| `docs/` | Documentation |
| `.github/` | Core/Infrastructure |

### 3. Extract Issue References

Scan commit messages for issue references:
- `#123`, `closes #123`, `fixes #123`, `resolves #123`

### 4. Run Pre-PR Checks

Run build and test in affected modules:

```bash
# If frontend/ changed
cd frontend && npm run build && npm test

# If backend/ changed
cd backend && npm run build && npm test

# If backend-serverless/ changed
cd backend-serverless && npm run build && npm test

# If agent/ changed
cd agent && go build ./... && go test ./...
```

Report results. If any fail, warn the user before proceeding.

### 5. Generate PR Body

Fill out the PR template matching `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Summary
<!-- Generated from commit messages -->

## Type of Change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing functionality)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] Performance improvement
- [ ] Security fix

## Module(s) Affected
- [ ] Browser (test library, MITRE matrix)
- [ ] Analytics (Elasticsearch, dashboards, Defender)
- [ ] Agents (enrollment, tasks, scheduling, heartbeat)
- [ ] Build & Settings (compilation, certificates, config)
- [ ] Core/Infrastructure (auth, middleware, deployment)
- [ ] Documentation

## Related Issues
<!-- Auto-linked from commits -->

## Changes Made
<!-- Bullet list from commit messages -->

## Build Verification
- [ ] Frontend: `npm run build` passes
- [ ] Backend: `npm run build` passes
- [ ] Frontend tests pass
- [ ] Backend tests pass
- [ ] Go agent builds (if changed)
- [ ] Docker Compose builds (if infrastructure changed)
```

Check the appropriate boxes based on analysis in steps 1-4.

### 6. Create PR

Determine the PR title (under 70 characters, derived from branch name or commits):

```bash
# Push branch if not already pushed
git push -u origin $(git branch --show-current)

# Create PR
gh pr create \
  --title "<title>" \
  --body "<generated body>"
```

### 7. Output

Show:
- The PR URL
- A reminder to request reviewers if needed
- Any pre-PR check failures that should be addressed
