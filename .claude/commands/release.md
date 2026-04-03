# Release

Interactive release flow for ProjectAchilles. Supports two version streams:
- **Platform** (frontend + backend + backend-serverless): tagged as `vX.Y.Z`
- **Agent** (Go binary): tagged as `agent-vX.Y.Z`

## Pre-release Checklist

Before proceeding, verify ALL of these:

1. You are on the `main` branch: `git branch --show-current`
2. No uncommitted changes: `git status --porcelain`
3. All tests pass:
   - `cd backend && npm test`
   - `cd frontend && npm test`
   - For agent releases: `cd agent && go test ./...`
4. Pull latest: `git pull origin main`

If any check fails, stop and report to the user.

## Steps

### 1. Determine Release Type

Ask the user: **"Platform release or Agent release?"**

- **Platform** = frontend + backend + backend-serverless share one version
- **Agent** = Go binary with independent version

### 2. Find Current Version

**Platform:**
```bash
git tag -l 'v*' --sort=-v:refname | head -1
```
If no tags, read version from `frontend/package.json`.

**Agent:**
```bash
git tag -l 'agent-v*' --sort=-v:refname | head -1
```
If no tags, read `VERSION :=` from `agent/Makefile`.

### 3. Analyze Commits Since Last Tag

```bash
git log <last-tag>..HEAD --oneline --no-merges
```

Suggest a version bump based on conventional commit types:
- Any commit with `BREAKING CHANGE` in body or `!` after type → **major**
- Any `feat` commit → **minor**
- Only `fix`, `perf`, `refactor`, `docs`, `style`, `test`, `chore` → **patch**

Show the commits and suggestion. Let the user confirm or override the bump.

### 4. Update Version Files

**Platform release** — update `"version"` in all three:
- `frontend/package.json`
- `backend/package.json`
- `backend-serverless/package.json`

**Agent release** — update both:
- `VERSION :=` line in `agent/Makefile`
- `var version =` line in `agent/main.go`

### 5. Generate Changelog

Parse commits since the last tag into Keep a Changelog sections:

| Commit type | Changelog section |
|-------------|-------------------|
| `feat` | `### Added` |
| `fix` | `### Fixed` |
| `perf` | `### Changed` |
| `refactor` | `### Changed` |
| `BREAKING` | `### Changed` with **BREAKING** prefix |
| Security/CVE | `### Security` |

**Skip:** `chore(deps)` (Dependabot noise), `docs`, `test`, `style`, `chore` (unless notable).

Group entries by scope within each section.

### 6. Update docs/CHANGELOG.md

**Platform release:** Insert `## [X.Y.Z] - YYYY-MM-DD` section. Move relevant items from `[Unreleased]`.

**Agent release:** Insert `## Agent [X.Y.Z] - YYYY-MM-DD` section.

Update the comparison links at the bottom:
```markdown
[Unreleased]: https://github.com/F0RT1KA/ProjectAchilles/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/F0RT1KA/ProjectAchilles/releases/tag/vX.Y.Z
```

Show the changelog to the user for review before writing.

### 7. Commit

```bash
# Platform
git add frontend/package.json backend/package.json backend-serverless/package.json docs/CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"

# Agent
git add agent/Makefile agent/main.go docs/CHANGELOG.md
git commit -m "chore(release): agent-vX.Y.Z"
```

### 8. Create Tag

```bash
# Platform
git tag vX.Y.Z

# Agent
git tag agent-vX.Y.Z
```

### 9. Push

**Ask the user for explicit confirmation before pushing.**

```bash
git push origin main --tags
```

This triggers the GitHub Actions release workflow:
- **Platform** (`release.yml`): runs tests, creates GitHub Release with changelog
- **Agent** (`release-agent.yml`): builds binaries for all platforms, signs them, creates GitHub Release with binaries attached

### 10. Post-Release Reminders

- **Agent releases**: After the GitHub Release is created, register the new binaries in each deployment instance (Docker, Fly.io, etc.) via the admin UI or API endpoint
- **Platform releases**: Verify the Fly.io deployment completed successfully (`flyctl status -a achilles-backend`)
- Ensure `docs/CHANGELOG.md` has an `[Unreleased]` section for future changes
