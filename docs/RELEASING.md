# Releasing ProjectAchilles

This guide covers the release process for ProjectAchilles's two version streams.

## Version Streams

| Stream | Components | Tag format | Workflow |
|--------|-----------|-----------|----------|
| **Platform** | frontend, backend, backend-serverless | `vX.Y.Z` | `release.yml` |
| **Agent** | Go binary (achilles-agent) | `agent-vX.Y.Z` | `release-agent.yml` |

The platform and agent version independently. A platform `v2.1.0` might ship alongside agent `v0.8.0`.

## Pre-release Checklist

Before starting any release:

- [ ] You are on the `main` branch
- [ ] No uncommitted changes (`git status`)
- [ ] Latest code pulled (`git pull origin main`)
- [ ] All tests pass:
  - `cd backend && npm test`
  - `cd frontend && npm test`
  - `cd backend-serverless && npm test` (if platform release)
  - `cd agent && go test ./...` (if agent release)
- [ ] `docs/CHANGELOG.md` has entries for this release

## Using the `/release` Command

The easiest way to release is the Claude Code `/release` command:

```
/release
```

It walks you through the entire process interactively:
1. Choose platform or agent
2. Analyze commits and suggest version bump
3. Update version files
4. Generate and insert changelog
5. Commit, tag, and push

## Manual Release Process

### Platform Release

1. **Determine the version** following [Semantic Versioning](https://semver.org/):
   - Breaking changes → major bump
   - New features → minor bump
   - Bug fixes only → patch bump

2. **Update version files** — all three must match:
   ```bash
   # Update "version" field in each:
   # - frontend/package.json
   # - backend/package.json
   # - backend-serverless/package.json
   ```

3. **Update the changelog** in `docs/CHANGELOG.md`:
   - Move items from `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`
   - Update comparison links at the bottom
   - Or use `/changelog` in Claude Code to generate entries

4. **Commit and tag**:
   ```bash
   git add frontend/package.json backend/package.json backend-serverless/package.json docs/CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```

5. **Verify**: The `release.yml` workflow runs automatically:
   - Tests pass
   - GitHub Release is created with changelog excerpt
   - Fly.io deployment happens via the separate `deploy-flyio.yml` (triggered by the push to main)

### Agent Release

1. **Determine the version** (same semver rules).

2. **Update version files** — both must match:
   ```bash
   # agent/Makefile — update VERSION :=
   # agent/main.go  — update var version =
   ```

3. **Update the changelog** in `docs/CHANGELOG.md`:
   - Add `## Agent [X.Y.Z] - YYYY-MM-DD` section
   - Update comparison links at the bottom

4. **Commit and tag**:
   ```bash
   git add agent/Makefile agent/main.go docs/CHANGELOG.md
   git commit -m "chore(release): agent-vX.Y.Z"
   git tag agent-vX.Y.Z
   git push origin main --tags
   ```

5. **Verify**: The `release-agent.yml` workflow runs automatically:
   - Go tests pass
   - Binaries built for all platforms (Windows, Linux, macOS)
   - Windows binary signed (if certificate configured)
   - macOS binaries signed (ad-hoc)
   - SHA256SUMS generated
   - GitHub Release created with binaries attached

6. **Post-release**: Register the new agent version in each deployment:
   - Download binaries from the GitHub Release
   - Upload via the admin UI or `POST /api/agent/admin/versions/upload`
   - Connected agents will auto-update on their next poll

## Changelog Format

The changelog supports both version streams in one file:

```markdown
## [Unreleased]

### Added
- ...

## [2.1.0] - 2026-04-15

### Added
- ...

## Agent [0.8.0] - 2026-04-10

### Added
- ...

## [2.0.0] - 2026-04-03
...
```

Platform sections use `## [X.Y.Z]`. Agent sections use `## Agent [X.Y.Z]`. They interleave chronologically.

## GitHub Actions Secrets

| Secret | Required | Purpose |
|--------|----------|---------|
| `WINDOWS_CERT_PFX` | Optional | Base64-encoded PFX certificate for Authenticode signing |
| `WINDOWS_CERT_PASSWORD` | With PFX | Password for the PFX certificate |
| `GITHUB_TOKEN` | Automatic | Used for creating releases and uploading assets |

To add the Windows signing certificate:
```bash
# Encode PFX as base64
base64 -w 0 cert.pfx | pbcopy  # or xclip

# Add as repository secret in GitHub Settings > Secrets > Actions
```

## Tag Protection

Release tags are protected via GitHub repository rulesets:

- **Pattern**: `v*` and `agent-v*`
- **Who can create**: `@projectachilles/maintainers` only
- **No force-push or deletion** of matching tags

To configure (Settings > Rules > Rulesets):
1. Create a new ruleset targeting tags
2. Add pattern `v*` and `agent-v*`
3. Restrict creation to the maintainers team
4. Enable "Block force push" and "Block deletion"

## Troubleshooting

### Tag already exists
```bash
# Delete local tag and recreate
git tag -d vX.Y.Z
git tag vX.Y.Z
git push origin --tags
```

### CI fails after tag push
The release workflow runs tests as a gate. If tests fail:
1. The GitHub Release is NOT created
2. Delete the tag: `git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z`
3. Fix the issue, push to main
4. Re-tag and push

### Version mismatch detected
The `/release` command and pre-push hook validate version consistency. If you see a mismatch:
1. Check all package.json files match (platform) or Makefile + main.go match (agent)
2. Ensure `docs/CHANGELOG.md` has the version section
3. Use `/release` to handle this automatically

### Rolling back a release
GitHub Releases can be deleted via the GitHub UI. To unpublish:
1. Go to the release on GitHub
2. Click "Delete release"
3. Optionally delete the tag: `git push origin :refs/tags/vX.Y.Z`

Note: this does NOT roll back deployed code. Use `flyctl releases` for deployment rollbacks.

## Claude Code Tooling

| Tool | Type | Purpose |
|------|------|---------|
| `/release` | Command | Interactive release flow |
| `/changelog` | Command | Generate changelog from commits |
| `/pr` | Command | Create PR with conventions |
| `validate-commit-msg.sh` | PreToolUse hook | Enforce conventional commits |
| `validate-branch-name.sh` | PreToolUse hook | Warn on bad branch names |
| `changelog-reminder.sh` | PostToolUse hook | Remind about CHANGELOG on feat/fix |
| `validate-tag-push.sh` | PreToolUse hook | Block tag push with version mismatch |
