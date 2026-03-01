# Roadmap

This document outlines the planned direction for ProjectAchilles. Features are organized by quarter with status indicators.

**Status key:** &check; Shipped · &cir; In progress · &empty; Planned

Want to influence the roadmap? Open a [GitHub Discussion](https://github.com/projectachilles/ProjectAchilles/discussions) or upvote existing feature requests.

---

## Completed (Jan–Feb 2026)

These features shipped since the v1.0.0 release:

- &check; **Custom Go Agent** — Enrollment, heartbeat, task execution, self-updating
- &check; **Build From Source** — Go cross-compilation for Windows/Linux (amd64/arm64)
- &check; **Code Signing** — Windows Authenticode via osslsigncode with multi-cert management
- &check; **Task Scheduling** — Recurring execution with randomized timing
- &check; **30+ Analytics Endpoints** — Defense scores, heatmaps, treemaps, trends, coverage
- &check; **Docker Compose Deployment** — Multi-service with optional local Elasticsearch
- &check; **Setup Wizard** — Interactive TUI for first-time configuration
- &check; **Git-Synced Test Library** — Automatic repository sync with GitHub
- &check; **Multi-Index Management** — Per-task ES index targeting, index creation
- &check; **Favorites & Recent Views** — Browser module localStorage persistence
- &check; **ngrok Tunnel Support** — Configurable domains for remote agent communication
- &check; **LimaCharlie Removal** — Replaced with custom agent system

---

## Near-Term (Q1–Q2 2026)

### Agent Enhancements
- &empty; Agent groups with bulk command execution
- &empty; macOS agent support (darwin/amd64, darwin/arm64)
- &empty; Agent health alerting (offline threshold notifications)
- &empty; Agent configuration profiles (poll interval, update policy per group)

### Analytics & Reporting
- &empty; Custom analytics dashboards with saved queries
- &empty; CSV/JSON export for all visualizations
- &empty; Blue team response metrics (Time to Detect, Time to Respond)
- &empty; MITRE ATT&CK coverage report generation
- &empty; Scheduled report delivery (email/webhook)

### Test Management
- &empty; Test campaigns — grouped multi-test execution with aggregate results
- &empty; Test result comparison across time periods
- &empty; Test tagging and custom metadata

---

## Medium-Term (Q3 2026)

### Platform
- &empty; Multi-tenancy with role-based access control (RBAC)
- &empty; Public API with OpenAPI specification
- &empty; Kubernetes deployment (Helm charts)
- &empty; Executive PDF report generation

### Integrations
- &empty; SIEM connectors (Splunk, Microsoft Sentinel)
- &empty; Notification channels (Slack, Teams, email)
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
