# Roadmap

This document outlines the planned direction for ProjectAchilles. Features are organized by quarter with status indicators.

**Status key:** &check; Shipped · &cir; In progress · &empty; Planned

Want to influence the roadmap? Open a [GitHub Discussion](https://github.com/projectachilles/ProjectAchilles/discussions) or upvote existing feature requests.

---

## Completed (Jan–Mar 2026)

These features shipped since the v1.0.0 release:

- &check; **Custom Go Agent** — Enrollment, heartbeat, task execution, self-updating
- &check; **Build From Source** — Go cross-compilation for Windows/Linux (amd64/arm64)
- &check; **Code Signing** — Windows Authenticode via osslsigncode with multi-cert management
- &check; **Task Scheduling** — Recurring execution with randomized timing
- &check; **30+ Analytics Endpoints** — Defense scores, heatmaps, treemaps, trends, coverage
- &check; **Docker Compose Deployment** — Multi-service with optional local Elasticsearch
- &check; **Setup Wizard** — Interactive TUI for first-time configuration
- &check; **Git-Synced Test Library** — Automatic repository sync with GitHub
- &check; **Multi-Index Management** — Per-task ES index targeting (manual index creation later superseded by write-index rollover)
- &check; **Favorites & Recent Views** — Browser module localStorage persistence
- &check; **ngrok Tunnel Support** — Configurable domains for remote agent communication
- &check; **LimaCharlie Removal** — Replaced with custom agent system
- &check; **macOS Agent Support** — darwin/amd64 + darwin/arm64 with launchd and rcodesign
- &check; **Microsoft Defender Integration** — Secure Score, alerts, control profiles, cross-correlation
- &check; **Trend Alerting** — Slack + email notifications with threshold configuration
- &check; **Notification Bell** — In-app alert dropdown in top bar
- &check; **MITRE ATT&CK Coverage Matrix** — Visual technique heatmap on browse page
- &check; **Visual Themes** — Neobrutalism + Hacker Terminal with phosphor variants
- &check; **Browse Overview Dashboard** — 3-tab layout with category metrics
- &check; **Remote Agent Uninstall** — Two-phase cleanup from admin UI
- &check; **Risk Acceptance** — Accept risk on individual security controls
- &check; **5 Deployment Targets** — Docker Compose, Railway, Render, Fly.io, Vercel
- &check; **Execution Drawer** — Run tests directly from browse page
- &check; **Bundle Results Fan-out** — Per-control ES documents for cyber-hygiene and intel-driven tests

---

## Completed (Apr–Jul 2026)

- &check; **CLI (`achilles`) + AI Chat Agent** — 18 command modules, Clerk device-flow login, conversational agent mode
- &check; **API Keys v1** — `pa_` bearer tokens with scoped permissions for programmatic access
- &check; **Defender Tab Redesign** — Alert drill-down drawer, correlation timeline, per-execution detection rate with MITRE roll-up, control ↔ alert linking
- &check; **Defender Auto-Resolve** — Programmatic resolution of Achilles-correlated alerts with dry-run mode and receipts
- &check; **Public + On-Prem Server Targets** — Single-server installs behind Caddy with four TLS modes (now 7 deployment targets)
- &check; **DigitalOcean Tenant Deployer** — Phased, resumable droplet provisioning (`scripts/deploy-do/`)
- &check; **`achilles deploy` TUI** — Unified guided deployment across targets, interactive or headless
- &check; **Write-Index Rollover** — Dated `achilles-results-<date>` write indices with daily/monthly/static rollover
- &check; **Per-Machine Schedule Randomization** — Independent randomized next-run per agent
- &check; **Azure/Entra Certificate Auth** — JWT client assertion as an alternative to client secrets for Defender/Azure integrations
- &check; **Rate-Limiter Recalibration** — Budgets re-keyed from IP to principal (agent ID / Clerk user)
- &check; **Blog** — Next.js + MDX blog at [blog.projectachilles.io](https://blog.projectachilles.io) with Spanish/English auto-translation
- &check; **Chart Color Governance** — Semantic chart tokens with WCAG AA contrast enforcement and drift-guard tests
- &check; **Honest Task Status** — Completed-but-failed tasks surfaced truthfully across all task tables

---

## Near-Term (Q3 2026)

### Agent Enhancements
- &empty; Agent groups with bulk command execution
- &empty; Agent health alerting (offline threshold notifications)
- &empty; Agent configuration profiles (poll interval, update policy per group)

### Analytics & Reporting
- &empty; Custom analytics dashboards with saved queries
- &empty; CSV/JSON export for all visualizations
- &empty; Blue team response metrics (Time to Detect, Time to Respond)
- &empty; Scheduled report delivery (email/webhook)

### Test Management
- &empty; Test campaigns — grouped multi-test execution with aggregate results
- &empty; Test result comparison across time periods
- &empty; Test tagging and custom metadata

---

## Medium-Term (Q3 2026)

### Platform
- &empty; Multi-tenancy with role-based access control (RBAC)
- &cir; Public API — API keys v1 shipped (`pa_` tokens, scoped permissions); OpenAPI specification pending
- &empty; Kubernetes deployment (Helm charts)
- &empty; Executive PDF report generation

### Integrations
- &empty; SIEM connectors (Splunk, Microsoft Sentinel)
- &empty; Microsoft Teams webhook notifications
- &empty; Ticketing system integration (Jira, ServiceNow)

---

## Long-Term (Q4 2026+)

- &empty; Test SDK — author security tests in Go or Python with a standard interface
- &empty; Plugin/extension system for custom modules
- &empty; Threat intelligence feed integration (STIX/TAXII)
- &empty; AI-powered test recommendations based on coverage gaps
- &empty; Red team collaboration features (shared campaigns, findings)

---

*This roadmap is a living document and will be updated as priorities evolve. Dates are aspirational, not commitments.*
