---
sidebar_position: 10
title: "CI/CD"
description: "GitHub Actions CI/CD pipeline for ProjectAchilles: testing, security scanning, releases and deployment."
---

# CI/CD

## CI Pipeline

`.github/workflows/ci.yml` runs on every push and pull request to `main`. All workflows use Node 22.

| Job | What it runs |
|-----|--------------|
| `Test backend`, `Test frontend`, `Test backend-serverless` | One matrix job per project: `npm ci`, `npm run build` (type check), `npm test` |
| `Test installer` | `go vet` and `go test` in `installer/` (also with the `appliancetest` build tag), then ShellCheck on the deploy and appliance scripts |

```yaml
# .github/workflows/ci.yml (shortened)
jobs:
  test-job:
    name: Test ${{ matrix.project }}
    strategy:
      matrix:
        project: [backend, frontend, backend-serverless]
    defaults:
      run: { working-directory: "${{ matrix.project }}" }
    steps:
      - uses: actions/checkout@<pinned sha>
      - uses: actions/setup-node@<pinned sha>
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build
      - run: npm test
```

Third-party actions are pinned to a commit SHA. The Go agent's tests (`cd agent && go test ./...`) are not part of `ci.yml`; they run in the agent release workflow, so run them locally when you change the agent.

## Other Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `codeql.yml` | Push and PR to `main`, weekly | CodeQL (advanced setup) for `actions`, `go`, `javascript-typescript`, `python` |
| `security-review.yml` | PRs touching source, scripts, Dockerfiles or workflows | Semgrep SAST and the Claude security review |
| `claude-code-review.yml` | PRs | Claude code review |
| `dependency-audit.yml` | Lockfile changes, pushes to `main`, weekly | `npm audit --omit=dev` for backend, backend-serverless, frontend, blog and wiki |
| `review-scripts.yml` | Changes to `.github/scripts/` or the two review workflows | Unit tests and guards for the review helper script |
| `wiki.yml`, `blog-ci.yml` | Changes under `wiki/` or `blog/` | Build the documentation site and the blog |
| `windows-installer.yml` | Changes to the Windows installer scripts | Runs `scripts/Install-ProjectAchilles.ps1` and the appliance import script under Windows PowerShell 5.1 and PowerShell 7, with external commands stubbed |
| `appliance.yml` | PRs touching the appliance, `v*.*.*` tags, manual | Builds the Hyper-V appliance image and boot-tests it; on a release tag it publishes the image |
| `release.yml` | `v*.*.*` tags | Platform release: tests, installer binaries, GitHub Release |
| `release-agent.yml` | `agent-v*.*.*` tags | Agent release: tests, cross-compiled binaries, signing, GitHub Release |
| `deploy-render.yml`, `deploy-flyio.yml` | After CI passes on `main` (Render, opt-in through repository secrets); push to `main` (Fly.io) | Deployments |
| `dependabot-auto-merge.yml` | Dependabot PRs | Queues auto-merge for minor and patch dependency updates |

## Security Scanning

### CodeQL

CodeQL runs from `.github/workflows/codeql.yml` (advanced setup), because GitHub's default setup skips pull requests from forks. It uses the `default` query suite and the `remote` threat model. Keep default setup disabled in the repository settings: GitHub rejects uploads from an advanced workflow while default setup is on.

### Semgrep

The `Semgrep SAST` job in `security-review.yml` scans with 11 registry rulesets (`p/javascript`, `p/typescript`, `p/nodejs`, `p/react`, `p/expressjs`, `p/owasp-top-ten`, `p/security-audit`, `p/secrets`, `p/golang`, `p/dockerfile`, `p/github-actions`) and the project's own rules in `.semgrep/rules/`.

- Findings do not block the PR. They are posted as a PR comment and written to the job summary.
- The job fails when the scan did not really run: a configuration error, or 0 files scanned.
- On fork PRs the report is only in the job summary, because the comment needs a write token.

### Dependency audit

`dependency-audit.yml` fails on high or critical advisories in production dependencies, unless the advisory is accepted in `.github/audit-allowlist.json`. Every allow-list entry needs a `reason` and an `expires` date (about three months out). An expired entry fails the job, so an advisory with no fix gets re-checked. Only allow-list advisories that have no fixed release; otherwise upgrade.

### Claude reviews

Two jobs use Claude: the code review (`claude-code-review.yml`) and the security review (`claude-security-review` in `security-review.yml`).

- **Fork PRs**: `pull_request` runs from forks get no secrets, so both jobs skip them. A maintainer reads the diff and then adds the **`claude-review`** label, which starts the review. The label is removed after the run, so it must be added again after each new push.
- Labelled runs check out only the base branch and read the PR through the API. No PR code is on disk and none runs.
- **A green job does not prove a review happened.** The security review must leave a comment from the current run for the current commit; a "Verify the review posted" step fails the job otherwise. The code review posts nothing on PRs it judges trivial and reviews a PR only once.
- **A PR that edits a review workflow is not reviewed.** The job stays green with a "Not reviewed" warning. Such a change is only proven on the next ordinary PR after it merges.

## Releases

Releases are cut by pushing a tag that points at a commit on `main` (both workflows verify this first):

- **Platform** (`v<version>`): `release.yml` runs the tests, builds the `achilles-installer` binaries and creates the GitHub Release. The same tag triggers `appliance.yml`, which builds and publishes the appliance image.
- **Agent** (`agent-v<version>`): `release-agent.yml` runs the Go tests, builds all four binaries, signs the Windows binary with `osslsigncode` when the `WINDOWS_CERT_PFX` / `WINDOWS_CERT_PASSWORD` secrets are set, signs the macOS binaries ad-hoc with `codesign` on a macOS runner, regenerates `SHA256SUMS` and creates the GitHub Release. Set the repository variable `REQUIRE_SIGNED_AGENT_RELEASE` to `true` to fail the release when the Windows binary is unsigned.

## Commit Convention

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
Scopes: `frontend`, `backend`, `backend-serverless`, `agent`, `analytics`, `browser`, `docker`, `render`, `vercel`, `fly`, `settings`, `certs`, `deps`, `ci`, `release`, `wiki`, `installer`
