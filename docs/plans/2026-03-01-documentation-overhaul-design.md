# Documentation Overhaul Design

**Date:** 2026-03-01
**Scope:** README.md, CHANGELOG.md, ROADMAP.md, CONTRIBUTING.md, SECURITY.md, CLAUDE.md

## Problem

The last ~50 commits shipped major features (Defender integration, trend alerting, 3 visual themes, MITRE ATT&CK matrix, 5 deployment targets, macOS agent, remote uninstall, etc.) but documentation was not updated to reflect them.

## Approach

Incremental in-place updates to each document, preserving existing structure and writing style. No full rewrites.

## Changes by Document

### README.md
- **Key Highlights**: Add Defender integration, trend alerting, ATT&CK matrix, 3 themes, 5 deployment targets, remote uninstall, risk acceptance
- **Features section**: Add "Microsoft Defender Integration" and "Alerting & Notifications" subsections; update Test Browser with ATT&CK matrix and execution drawer; update Analytics with risk acceptance and dual Defense Score
- **Architecture diagram**: Add Microsoft Graph API connection
- **Deployment section**: Restructure to show all 5 targets (Docker, Railway, Render, Fly.io, Vercel) in a table
- **API Reference**: Add Defender, alert, and integration endpoints
- **Documentation section**: Add Fly.io and Render deployment guides

### CHANGELOG.md
- Add ~20 features under `[Unreleased] > Added` (Defender, alerting, themes, ATT&CK matrix, macOS, remote uninstall, etc.)
- Add ~10 fixes under `[Unreleased] > Fixed`
- Add deployment targets (Fly.io, Render) under Docker & Deployment

### ROADMAP.md
- Move to "Completed": macOS agent, Slack/email notifications, MITRE ATT&CK coverage matrix, Defender integration, visual themes
- Update "Near-Term" to remove shipped items
- Keep planned: agent groups, CSV export, PDF reports, campaigns, multi-tenancy, Kubernetes

### CONTRIBUTING.md
- Update Node.js prerequisite from 18.x to 22.x
- Add Vitest test commands section
- Add `backend-serverless/` to project structure
- Add `backend-serverless` to commit scopes

### SECURITY.md
- Add Defender integration credentials to Authentication Models
- Add alerting service (Slack webhook, SMTP) to Data Protection
- Add Semgrep SAST CI to Built-in Protections table

### CLAUDE.md
- Add Alerting service section (types, routes, dispatch)
- Add Defender routes to API Routes table
- Add theme system, notification bell, risk acceptance mentions
- Update test suite counts
- Add `backend-serverless` scope to commit convention (if missing)

## Non-Goals
- Deployment guide updates (Fly.md, Render.md, etc.) — already well-maintained
- ROADMAP_SUGGESTIONS.md — informational doc, not user-facing
- Design plan docs in docs/plans/ — historical records, no updates needed
