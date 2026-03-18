---
sidebar_position: 10
title: "CI/CD"
description: "GitHub Actions CI/CD pipeline for ProjectAchilles — testing, security review, and deployment."
---

# CI/CD

## CI Pipeline

GitHub Actions runs on push/PR to main:

```yaml
# .github/workflows/ci.yml
jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build
      - run: npm test
    defaults:
      run: { working-directory: backend }

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build
      - run: npm test
    defaults:
      run: { working-directory: frontend }
```

## Security Review

The security review workflow runs on PRs touching source/config files:

- **Semgrep SAST** — 11 community rulesets + 5 custom rules
- **npm audit** — Dependency vulnerability scanning
- **Claude Security Review** — AI-powered security analysis (skipped for Dependabot PRs)

## Commit Convention

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
Scopes: `frontend`, `backend`, `backend-serverless`, `agent`, `analytics`, `browser`, `docker`, `settings`, `certs`, `deps`
