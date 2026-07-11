---
sidebar_position: 3
title: "Roadmap"
description: "ProjectAchilles product roadmap — planned features and development direction."
---

# Roadmap

## Q1 2026 (Completed)

- Agent system (enrollment, heartbeat, task execution, self-update)
- Code signing (Windows Authenticode, macOS ad-hoc)
- Task scheduling (daily/weekly/monthly, randomized timing)
- 30+ analytics endpoints (Defense Score, heatmaps, treemaps, trends)
- Microsoft Defender integration (Secure Score, alerts, cross-correlation)
- Trend alerting (Slack Block Kit, email via Nodemailer)
- MITRE ATT&CK coverage matrix
- 5 deployment targets (Docker, Railway, Render, Fly.io, Vercel)
- macOS agent support (launchd, sysctl, rcodesign)
- Remote agent uninstall
- Risk acceptance tracking
- 3 visual themes

## Q2 2026 (Shipped)

- CLI tool for headless operations (`achilles`, with AI chat agent and unified `deploy` TUI)
- Documentation wiki (this site)
- API keys for programmatic access (`pa_` bearer tokens with scoped permissions)
- Write-index rollover (dated `achilles-results-<date>` write indices)
- Public + on-prem single-server deployment targets (Caddy TLS)
- Azure/Entra certificate authentication for the Defender integration
- Defender tab redesign (alert drill-down, correlation timeline, detection rate)
- Per-machine schedule randomization
- Blog at [blog.projectachilles.io](https://blog.projectachilles.io) with Spanish/English auto-translation

Carried over to Q3: agent groups and tagging, custom dashboard builder, enhanced reporting (PDF/CSV export).

## Q3 2026 (Planned)

- Multi-tenancy support
- SIEM connectors (Splunk, Sentinel)
- Compliance reporting templates (DORA, TIBER-EU)
- Advanced scheduling (event-triggered execution)

## Q4 2026 (Planned)

- AI-powered test recommendations
- Automated gap analysis
- Threat actor emulation profiles
- Community test marketplace

## Contributing to the Roadmap

Have ideas for features? Open a [GitHub Discussion](https://github.com/projectachilles/ProjectAchilles/discussions) with the "feature-request" label.
