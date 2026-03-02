# Documentation Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update all project documentation (README, CHANGELOG, ROADMAP, CONTRIBUTING, SECURITY, CLAUDE.md) to reflect ~50 commits of new features shipped since last doc update.

**Architecture:** Incremental in-place edits to 6 documents. No new files created. Each task updates one document completely, with a commit after each.

**Tech Stack:** Markdown only — no code changes.

---

### Task 1: Update README.md

**Files:**
- Modify: `README.md`

**Step 1: Update Key Highlights section (line ~33)**

Add these bullets after the existing list:

```markdown
- **Microsoft Defender Integration** — Sync Secure Score, alerts, and control profiles from Microsoft 365 Defender with MITRE cross-correlation
- **Trend Alerting** — Threshold-based Slack and email notifications with in-app notification bell
- **MITRE ATT&CK Coverage Matrix** — Visual technique coverage heatmap on the browse page
- **3 Visual Themes** — Default, Neobrutalism, and Hacker Terminal (with green/amber phosphor variants)
- **5 Deployment Targets** — Docker Compose, Railway, Render, Fly.io, and Vercel (serverless)
- **Remote Agent Uninstall** — Two-phase uninstall with service removal and cleanup verification
- **Risk Acceptance** — Accept risk for individual security controls with tracking
- **macOS Agent Support** — Native launchd service with ad-hoc code signing via rcodesign
```

**Step 2: Update Test Browser features (line ~86)**

Add these bullets to the Test Browser subsection:

```markdown
- MITRE ATT&CK coverage matrix with visual technique heatmap
- Overview dashboard with 3-tab layout (overview, matrix, list) and category legend
- Execution drawer — run tests directly from the browse page
```

**Step 3: Update Analytics Dashboard features (line ~98)**

Add these bullets to the Analytics Dashboard subsection:

```markdown
- **Microsoft Defender Integration** — Sync Secure Score, alerts, and control profiles with cross-correlation analytics
- **Dual Defense Score** — Real score and trend line overlay for tracking trajectory
- **Risk Acceptance** — Accept risk on individual controls with audit tracking
- **Trend Alerting** — Threshold-based Slack (Block Kit) and email (Nodemailer) notifications
- **Notification Bell** — In-app alert dropdown showing recent threshold breaches
- **Archive Executions** — Archive old execution results to declutter active views
- **Shared FilterBar** — Unified filter bar across Analytics dashboard tabs
```

**Step 4: Update Agent System features (line ~107)**

Add these bullets to the Agent System subsection:

```markdown
- **Remote Uninstall** — Two-phase agent removal (stop service + cleanup) initiated from admin UI
- **Agent Diagnostics** — Enhanced `--status` flag showing service state, connection health, and config validation
- **macOS Support** — Native launchd plist at `/Library/LaunchDaemons/`, sysinfo via sysctl/vm_stat, ad-hoc code signing via rcodesign
- **Stale Task Detection** — Tasks auto-fail when agent goes offline during execution
- **Windows Job Objects** — Orphan process cleanup for async task execution
```

**Step 5: Update Architecture diagram (line ~158)**

Replace the architecture diagram with an updated version that includes Microsoft Graph API:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React SPA)                        │
│   Browser  │  Analytics  │  Agents  │  Settings  │  Scheduling     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST API
┌──────────────────────────────┴──────────────────────────────────────┐
│                      Backend (Express + TS)                        │
│                                                                    │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Browser  │  │ Analytics │  │  Agent   │  │     Build        │  │
│  │ Service  │  │  Service  │  │ Service  │  │    Service       │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └───────┬──────────┘  │
│       │              │             │                │              │
│  ┌────┴─────┐  ┌─────┴─────┐  ┌───┴──────┐  ┌──────┴──────────┐  │
│  │ Git Repo │  │Elastic-   │  │ SQLite   │  │ Go Toolchain    │  │
│  │ (Tests)  │  │search     │  │ (Agents, │  │ + osslsigncode  │  │
│  └──────────┘  └───────────┘  │  Tasks)  │  └─────────────────┘  │
│                               └──────────┘                        │
│  ┌────────────────────────┐  ┌───────────────────────────────┐    │
│  │ Alerting Service       │  │ Defender Service              │    │
│  │ (Slack + Email)        │  │ (Graph API client)            │    │
│  └────────────────────────┘  └──────────┬────────────────────┘    │
└──────────────────────────────────────────┼────────────────────────┘
                               │           │
                    ┌──────────┴──────┐  ┌─┴──────────────────┐
                    │  Achilles Agent │  │ Microsoft Graph API │
                    │  (Go binary)   │  │ (Secure Score,      │
                    │  ┌───────────┐ │  │  Alerts, Controls)  │
                    │  │ Heartbeat │ │  └─────────────────────┘
                    │  │ Executor  │ │
                    │  │ Updater   │ │
                    │  └───────────┘ │
                    └────────────────┘
                         Endpoints
```

**Step 6: Update Deployment section (line ~59 area and line ~353 area)**

Replace the Quick Start Path B Docker section and add a new "Deployment Targets" section after Quick Start:

```markdown
### Deployment Targets

| Target | Backend | Database | Agent Builds | Guide |
|--------|---------|----------|-------------|-------|
| **Docker Compose** | `backend/` | SQLite (volume) | Yes | [docker-compose.yml](docker-compose.yml) |
| **Railway** | `backend/` | SQLite (volume) | Partial | [Railway Guide](docs/deployment/RAILWAY.md) |
| **Render** | `backend/` | SQLite (persistent disk) | Partial | [Render Guide](docs/deployment/RENDER.md) |
| **Fly.io** | `backend/` | SQLite (volume) | Yes | [Fly.io Guide](docs/deployment/FLY.md) |
| **Vercel** | `backend-serverless/` | Turso (libSQL) | No | [Vercel Guide](docs/deployment/VERCEL.md) |
```

**Step 7: Update API Reference (line ~297)**

Add these endpoint groups to the API Reference:

```markdown
### Defender Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/analytics/defender/secure-score` | Current Secure Score with category breakdown |
| `GET` | `/api/analytics/defender/secure-score/trend` | Secure Score trend over time |
| `GET` | `/api/analytics/defender/alerts` | Defender alerts with filtering |
| `GET` | `/api/analytics/defender/controls` | Control profiles with compliance status |
| `GET` | `/api/analytics/defender/cross-correlation` | Defense Score vs Secure Score correlation |
| `GET` | `/api/integrations/defender/config` | Defender configuration status |
| `POST` | `/api/integrations/defender/config` | Save Defender credentials |
| `POST` | `/api/integrations/defender/sync` | Trigger manual sync |

### Alerting

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/integrations/alerts/config` | Get alert threshold configuration |
| `POST` | `/api/integrations/alerts/config` | Save alert thresholds and channels |
```

**Step 8: Update Documentation links section (line ~353)**

Add these links:

```markdown
- [Fly.io Deployment](docs/deployment/FLY.md) — Fly.io with custom domains and volumes
- [Render Deployment](docs/deployment/RENDER.md) — Render with persistent disk and Blueprint
- [Railway Deployment](docs/deployment/RAILWAY.md) — Railway with private networking
- [Vercel Deployment](docs/deployment/VERCEL.md) — Serverless with Turso and Vercel Blob
```

**Step 9: Commit**

```bash
git add README.md
git commit -m "docs: update README with Defender, alerting, themes, macOS, 5 deployment targets"
```

---

### Task 2: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add new features under `[Unreleased] > Added`**

After the existing "#### Frontend" subsection (line ~96), add new subsections. Also add missing items to existing subsections.

Add to **#### Agent System** (after existing bullets):

```markdown
- macOS support (darwin/amd64, darwin/arm64) with launchd service and ad-hoc code signing via rcodesign
- Remote uninstall with two-phase cleanup (stop service + remove files)
- Enhanced `--status` diagnostics: service state, connection health, config validation
- Async task execution with Windows Job Objects for orphan process cleanup
- Azure/Entra ID credential flow for identity-tenant tests
- Bundle results fan-out for cyber-hygiene and intel-driven multi-stage controls
```

Add to **#### Analytics**:

```markdown
- Microsoft Defender integration — Secure Score, Alerts v2, Control Profiles via Graph API
- 9 Defender analytics endpoints (secure-score, alerts, controls, cross-correlation)
- Test-alert detection correlation between F0RTIKA results and Defender alerts
- Dual Defense Score display with real score trend line overlay
- Risk acceptance for individual security controls
- Archive executions feature
- Shared FilterBar across Analytics Dashboard tabs
```

Add new **#### Alerting & Notifications**:

```markdown
#### Alerting & Notifications
- Threshold-based trend alerting with configurable score drop/absolute thresholds
- Slack alerting via Block Kit formatted messages
- Email alerting via Nodemailer with HTML templates
- Alert settings UI with Slack webhook and SMTP configuration
- NotificationBell component with alert dropdown in top bar
- Alert dispatch hooked into result ingestion pipeline
```

Add to **#### Browser**:

```markdown
- MITRE ATT&CK coverage matrix with visual technique heatmap
- Browse overview dashboard with 3-tab layout (overview, matrix, list)
- Execution drawer for running tests directly from browse page
- Category legend and metric card subtitles on overview
```

Add new **#### Visual Themes**:

```markdown
#### Visual Themes
- Neobrutalism visual theme with hot pink/magenta accent
- Hacker Terminal visual theme with phosphor scanline effects
- Green/amber phosphor variant toggle for Hacker Terminal
- Theme selector in settings
```

Add to **#### Docker & Deployment**:

```markdown
- Fly.io deployment with custom domains, volumes, and documentation
- Render.com deployment with Blueprint and persistent disk
- Railway deployment with private networking and AGENT_REPO_URL git sync
- Vercel serverless deployment with Turso, Vercel Blob, and Crons
- Backend-serverless (`backend-serverless/`) — independent fork for Vercel
- Pure-JS certificate generation via node-forge for serverless environments
- Client-side Blob upload for large binaries on Vercel
- Upload pre-built binary support for all deployment targets
```

Add to **#### Frontend** (existing section):

```markdown
- Endpoints dashboard redesign with donut charts, task activity, and version metrics
- Fullscreen expand dialog for task output
- Collapsible Scheduled Tasks section on Tasks page
- Rich test info modal in Executions detail panel
```

**Step 2: Add new fixes under `[Unreleased] > Fixed`**

```markdown
- Stale task detection — tasks auto-fail when agent goes offline during execution
- Group-aware pagination for Executions table (replace ES collapse with terms agg)
- Exclude cyber-hygiene from detection rate calculation
- Cap Secure Score category percentages at 100%
- Exclude deprecated controls from Secure Score category maxScore
- Async task execution with Windows Job Objects for orphan process cleanup
- Action buttons column moved to left side of table for discoverability
- Agent update tasks patched to executing status before running
- nginx host-not-found crash on PaaS without Docker Compose DNS
```

**Step 3: Add to `[Unreleased] > Security`**

```markdown
- Semgrep SAST in CI with 11 community rulesets + 5 custom rules
- Microsoft Defender integration credentials encrypted at rest (AES-256-GCM)
- Alert service credentials (Slack webhook, SMTP password) encrypted at rest
```

**Step 4: Update Version History table**

Keep as-is — these are all unreleased changes.

**Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG with 50+ features shipped since last update"
```

---

### Task 3: Update ROADMAP.md

**Files:**
- Modify: `docs/ROADMAP.md`

**Step 1: Move shipped items to Completed section**

Add these to the "Completed (Jan–Feb 2026)" section, and rename it to "Completed (Jan–Mar 2026)":

```markdown
- ✓ **macOS Agent Support** — darwin/amd64 + darwin/arm64 with launchd and rcodesign
- ✓ **Microsoft Defender Integration** — Secure Score, alerts, control profiles, cross-correlation
- ✓ **Trend Alerting** — Slack + email notifications with threshold configuration
- ✓ **Notification Bell** — In-app alert dropdown in top bar
- ✓ **MITRE ATT&CK Coverage Matrix** — Visual technique heatmap on browse page
- ✓ **Visual Themes** — Neobrutalism + Hacker Terminal with phosphor variants
- ✓ **Browse Overview Dashboard** — 3-tab layout with category metrics
- ✓ **Remote Agent Uninstall** — Two-phase cleanup from admin UI
- ✓ **Risk Acceptance** — Accept risk on individual security controls
- ✓ **5 Deployment Targets** — Docker Compose, Railway, Render, Fly.io, Vercel
- ✓ **Execution Drawer** — Run tests directly from browse page
- ✓ **Bundle Results Fan-out** — Per-control ES documents for cyber-hygiene and intel-driven tests
```

**Step 2: Update Near-Term section**

Remove shipped items from Near-Term. Remove "macOS agent support" from Agent Enhancements. Move "Notification channels (Slack, Teams, email)" from Integrations (Q3) to Completed. Remove "MITRE ATT&CK coverage report generation" from Analytics (already shipped as matrix).

Update remaining Near-Term items:

```markdown
## Near-Term (Q2 2026)

### Agent Enhancements
- ○ Agent groups with bulk command execution
- ○ Agent health alerting (offline threshold notifications)
- ○ Agent configuration profiles (poll interval, update policy per group)

### Analytics & Reporting
- ○ Custom analytics dashboards with saved queries
- ○ CSV/JSON export for all visualizations
- ○ Blue team response metrics (Time to Detect, Time to Respond)
- ○ Scheduled report delivery (email/webhook)

### Test Management
- ○ Test campaigns — grouped multi-test execution with aggregate results
- ○ Test result comparison across time periods
- ○ Test tagging and custom metadata
```

**Step 3: Update Medium-Term section**

Remove "Notification channels" from Integrations (shipped). Add Teams webhook as remaining item:

```markdown
### Integrations
- ○ SIEM connectors (Splunk, Microsoft Sentinel)
- ○ Microsoft Teams webhook notifications
- ○ Ticketing system integration (Jira, ServiceNow)
```

**Step 4: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: update ROADMAP — move 12 shipped features to Completed"
```

---

### Task 4: Update CONTRIBUTING.md

**Files:**
- Modify: `CONTRIBUTING.md`

**Step 1: Update Prerequisites (line ~24)**

Change Node.js from 18.x to 22.x and npm from 9.x to 10.x:

```markdown
- **Node.js** 22.x or higher
- **npm** 10.x or higher
```

**Step 2: Update Project Structure (line ~52)**

Add `backend-serverless/` to the structure:

```markdown
ProjectAchilles/
├── frontend/              # React 19 + TypeScript + Vite
├── backend/               # Express + TypeScript (ES modules)
├── backend-serverless/    # Vercel serverless fork (Turso + Vercel Blob)
├── agent/                 # Go agent source (cross-platform)
├── scripts/               # Shell scripts (start.sh, setup.sh, etc.)
├── docs/                  # Documentation (deployment, security, plans)
├── docker-compose.yml     # Multi-service deployment
└── CLAUDE.md              # Development guidance
```

**Step 3: Add Testing section with Vitest commands (after line ~285)**

Replace the existing "### Go Validation" section content and add proper Vitest section:

```markdown
### Automated Tests (Vitest)

```bash
# Backend (912 tests)
cd backend && npm test

# Frontend (127 tests)
cd frontend && npm test

# Backend Serverless (626 tests)
cd backend-serverless && npm test

# Single test file
cd backend && npx vitest src/services/agent/__tests__/enrollment.service.test.ts

# Filter by test name
cd backend && npx vitest -t "creates a token"

# Watch mode
cd backend && npm run test:watch
```

Test file pattern: `src/**/__tests__/**/*.test.{ts,tsx}`
```

**Step 4: Update commit scopes (line ~251)**

Add `backend-serverless` to scopes:

```markdown
Common scopes: `frontend`, `backend`, `backend-serverless`, `agent`, `analytics`, `browser`, `docker`, `settings`, `certs`, `deps`
```

**Step 5: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: update CONTRIBUTING — Node 22, Vitest, backend-serverless"
```

---

### Task 5: Update SECURITY.md

**Files:**
- Modify: `SECURITY.md`

**Step 1: Add Defender credentials to Authentication Models (after line ~76)**

Add a new item after "Enrollment Tokens":

```markdown
4. **Integration Credentials** — Third-party service credentials stored encrypted
   - Microsoft Defender: `DEFENDER_TENANT_ID`, `DEFENDER_CLIENT_ID`, `DEFENDER_CLIENT_SECRET`
   - Slack webhook URL for alerting
   - SMTP credentials for email alerting
   - All encrypted at rest with AES-256-GCM in `~/.projectachilles/integrations.json`
```

**Step 2: Update Built-in Protections table (line ~170)**

Add these rows:

```markdown
| Semgrep SAST | 11 community rulesets + 5 custom rules in CI; Claude security review on PRs |
| Integration Credential Encryption | Defender, Slack, SMTP credentials AES-256-GCM encrypted at rest |
```

**Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs: update SECURITY — Defender credentials, alerting, Semgrep CI"
```

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update test counts (line ~34)**

```markdown
cd backend && npm test           # 912 tests across 40 files (~12s)
cd frontend && npm test          # 127 tests across 8 files (~2s)
cd backend-serverless && npm test  # 626 tests across 25 files (~11s)
```

**Step 2: Add Alerting routes to API Routes table (line ~112)**

Add after the Defender rows:

```markdown
| `/api/integrations/alerts/*` | Clerk | Alert thresholds, Slack/email config |
```

**Step 3: Add Alerting Service section (after Microsoft Defender section, ~line 353)**

```markdown
### Alerting Service
Threshold-based alerting dispatched when test results cross configured score thresholds. Hooked into the result ingestion pipeline.

- **Channels**: Slack (Block Kit via webhook URL), Email (Nodemailer with SMTP)
- **Thresholds**: Score drop % (relative) and absolute score floor, configurable per metric
- **Settings**: Stored in `~/.projectachilles/integrations.json` (AES-256-GCM encrypted)
- **Backend service**: `services/alerting/` — `alerting.service.ts` (threshold evaluation), `slack.service.ts`, `email.service.ts`
- **Frontend**: `AlertsConfig` settings component, `NotificationBell` in TopBar
- **Dispatch trigger**: Called from `results.service.ts` after successful ES ingestion
```

**Step 4: Add Visual Themes note to Frontend section (after line ~65)**

Add to the Frontend architecture description:

```markdown
- **Visual Themes**: 3 selectable themes — Default (light/dark), Neobrutalism (hot pink accent, bold borders), Hacker Terminal (phosphor green/amber scanlines). Theme selector in settings. CSS variables drive all theme-specific styling.
```

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — test counts, alerting service, themes, alert routes"
```

---

### Task 7: Update ROADMAP_SUGGESTIONS.md

**Files:**
- Modify: `docs/ROADMAP_SUGGESTIONS.md`

**Step 1: Mark Trend Alerting as shipped (section 3)**

Add a note at the top of section 3:

```markdown
> **Status: SHIPPED** — Trend alerting with Slack and email was implemented in Feb 2026. See the Alerting Service in CLAUDE.md. Dashboard banner alerts (Phase 1), score thresholds (Phase 2), and Slack/email dispatch (Phase 3) are all live.
```

**Step 2: Commit**

```bash
git add docs/ROADMAP_SUGGESTIONS.md
git commit -m "docs: mark trend alerting as shipped in ROADMAP_SUGGESTIONS"
```
