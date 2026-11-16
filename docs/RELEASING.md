# Releasing ProjectAchilles

This guide covers the release process for ProjectAchilles's two version streams.

## Version Streams

| Stream | Components | Tag format | Workflow |
|--------|-----------|-----------|----------|
| **Platform** | frontend, backend, backend-serverless, `achilles-installer`, Windows Hyper-V appliance | `vX.Y.Z` | `release.yml`, `appliance.yml` |
| **Agent** | Go binary (achilles-agent) | `agent-vX.Y.Z` | `release-agent.yml` |

The platform and agent version independently. Platform `v2.11.0` shipped alongside agent `v0.7.4`.

Both release workflows refuse a tag that does not point to a commit on `main`.

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

`/release`, `/changelog` and `/pr` are maintainer tooling: `.claude/` is gitignored, so the commands are not in a fresh clone. Without them, follow the manual process below.

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

4. **Commit on a release branch and open a PR** (releases reach `main` through a pull request, like every other change):
   ```bash
   git checkout -b chore/release-vX.Y.Z
   git add frontend/package.json backend/package.json backend-serverless/package.json docs/CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git push origin chore/release-vX.Y.Z
   ```

5. **Tag the merge commit** once the PR is merged, and push only the tag:
   ```bash
   git checkout main && git pull origin main
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

6. **Verify**: the tag starts two workflows.
   - `release.yml`: checks the tag is on `main`, builds and tests `backend` and `frontend`, builds `achilles-installer` for linux amd64 and arm64 (stamped with the tag), and creates the GitHub Release with the changelog excerpt, both installer binaries and their `SHA256SUMS`. `scripts/install-onprem.sh` downloads the installer from this release and verifies it against that file.
   - `appliance.yml`: builds the Windows Hyper-V appliance image from the tag, runs the full boot test (install, backup, restore), uploads the Hyper-V zip to the R2 bucket, and attaches `appliance-SHA256SUMS` and `Import-Achilles.ps1` to the GitHub Release. It waits up to 20 minutes for the release to exist, and fails if the R2 configuration is missing (see [GitHub Actions Secrets](#github-actions-secrets)).

   Deployments are separate from the tag: `deploy-flyio.yml` runs on every push to `main`, and `deploy-render.yml` after CI passes on `main` (only when its deploy-hook secrets are set).

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

4. **Commit on a release branch and open a PR**:
   ```bash
   git checkout -b chore/release-agent-X.Y.Z
   git add agent/Makefile agent/main.go docs/CHANGELOG.md
   git commit -m "chore(release): agent-vX.Y.Z"
   git push origin chore/release-agent-X.Y.Z
   ```

5. **Tag the merge commit** once the PR is merged, and push only the tag:
   ```bash
   git checkout main && git pull origin main
   git tag agent-vX.Y.Z
   git push origin agent-vX.Y.Z
   ```

6. **Verify**: The `release-agent.yml` workflow runs automatically:
   - Checks the tag is on `main`; `go test ./...` and `go vet ./...` pass
   - Binaries built with `make build-all VERSION=X.Y.Z`: Windows amd64, Linux amd64, macOS amd64 + arm64
   - Windows binary signed when `WINDOWS_CERT_PFX` is configured. If it is not, or signing fails, the release still goes out and its notes open with a warning that the `.exe` is unsigned. Set the repository variable `REQUIRE_SIGNED_AGENT_RELEASE=true` to fail the release instead
   - macOS binaries signed ad-hoc on a macOS runner, then `SHA256SUMS` regenerated
   - GitHub Release created with the binaries attached (not marked "latest"; that stays on the platform release)

7. **Post-release**: Register the new agent version in each deployment:
   - Settings → Agent → **Build Agent Binary** (builds from source on the install), or download the binaries from the GitHub Release and use **Upload Agent Binary** / `POST /api/agent/admin/versions/upload`
   - The registered version must equal the version compiled into the binary; a mismatch or an unstamped binary is rejected with 422
   - Connected agents update on their next version check. See [Agent Binary: Build, Register & Distribute](agent-binary-release.md)

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
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Platform release | Upload of the appliance zip to the R2 bucket (`appliance.yml`) |

Repository variables:

| Variable | Required | Purpose |
|----------|----------|---------|
| `R2_PUBLIC_BASE_URL` | Platform release | Public base URL of the R2 bucket; the appliance download link is built from it |
| `REQUIRE_SIGNED_AGENT_RELEASE` | Optional | `true` makes an unsigned Windows agent binary fail the agent release |

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
git push origin vX.Y.Z
```

### CI fails after tag push
The release workflow runs tests as a gate. If tests fail:
1. The GitHub Release is NOT created
2. Delete the tag: `git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z`
3. Fix the issue through a PR to main
4. Tag the new merge commit and push the tag

### Version mismatch detected
The `/release` command and the `validate-tag-push.sh` hook validate version consistency. If you see a mismatch:
1. Check all package.json files match (platform) or Makefile + main.go match (agent)
2. Ensure `docs/CHANGELOG.md` has the version section
3. Use `/release` to handle this automatically

### Rolling back a release
GitHub Releases can be deleted via the GitHub UI. To unpublish:
1. Go to the release on GitHub
2. Click "Delete release"
3. Optionally delete the tag: `git push origin :refs/tags/vX.Y.Z`

Note: this does NOT roll back deployed code. Use `flyctl releases` for deployment rollbacks. The appliance zip of a deleted release stays in the R2 bucket until it is removed there.

## Claude Code Tooling

The hook scripts live in `scripts/hooks/`. The commands are maintainer-local (see above).

| Tool | Type | Purpose |
|------|------|---------|
| `/release` | Command | Interactive release flow |
| `/changelog` | Command | Generate changelog from commits |
| `/pr` | Command | Create PR with conventions |
| `validate-commit-msg.sh` | PreToolUse hook | Enforce conventional commits |
| `validate-branch-name.sh` | PreToolUse hook | Warn on bad branch names |
| `changelog-reminder.sh` | PostToolUse hook | Remind about CHANGELOG on feat/fix |
| `validate-tag-push.sh` | PreToolUse hook | Block tag push with version mismatch |
