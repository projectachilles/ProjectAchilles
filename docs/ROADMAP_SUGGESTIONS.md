# Roadmap Suggestions

Prioritized improvements for ProjectAchilles, evaluated against what already exists and what would deliver the most value.

---

## 1. Agent Reliability & Observability

**Priority: High** — The agent fleet is the data source for everything else. If agents silently fail, all downstream metrics are wrong.

### Current State

- Fleet dashboard shows 4 summary metrics (total, online, offline, pending tasks) and 24h task activity
- Per-agent detail cards show status, version, last heartbeat, OS/arch
- Heartbeat timeout is 180s — agents are marked offline if no heartbeat received

### What's Missing

| Gap | Impact |
|-----|--------|
| No per-agent task history or execution timeline | Can't diagnose why a specific agent stopped reporting results |
| No failure rate tracking by error code | Can't distinguish "test detected malware" (good) from "agent crashed" (bad) |
| No heartbeat uptime trends | Can't identify agents that flap online/offline or have connectivity issues |
| No agent event log (enrolled, updated, went offline, task failed) | No audit trail for fleet operations |

### Suggested Implementation

1. **Agent Detail Page** — click an agent card to see full task history, heartbeat timeline (sparkline over 7d/30d), and event log
2. **Fleet Health Metrics** — aggregate uptime %, task success rate, and mean time between failures across the fleet
3. **Stale Agent Detection** — highlight agents that haven't run any tasks in N days despite being "online" (enrolled but idle)

### Backend Support

Most data already exists in SQLite (`agents`, `tasks` tables). The main work is:
- A new endpoint to query task history per agent with pagination
- Computing uptime from heartbeat timestamps (store last N heartbeats, not just the latest)
- Frontend components for the detail page

---

## 2. Test Scheduling UX

**Priority: High** — The backend has full schedule CRUD with timezone-aware recurrence, but the frontend barely exposes it.

### Current State

- Backend supports 4 schedule types: `once`, `daily`, `weekly`, `monthly`
- Timezone-aware computation with DST handling and randomized office-hours execution
- Frontend shows a collapsible list with pause/resume/delete actions

### What's Missing

| Gap | Impact |
|-----|--------|
| No "Create Schedule" dialog in the UI | Users must use API directly to create schedules |
| No "Edit Schedule" dialog | Can't modify an existing schedule without delete + recreate |
| No timezone picker | Backend supports it, frontend doesn't expose the choice |
| No recurrence rule preview | Users can't see "Every Monday at 2pm CEST" — just raw field values |
| No schedule execution history | Can't see past runs, whether they succeeded, or what was tested |

### Suggested Implementation

1. **Schedule Editor Dialog** — form with test selection (from test library), agent/group targeting, recurrence type, timezone picker, and a human-readable preview ("Runs every Monday at 14:00 Europe/Paris")
2. **Schedule History Tab** — show past executions for a schedule with status, duration, and link to results
3. **Campaign Concept** — group schedules into named campaigns (e.g., "Weekly Ransomware Validation") for easier management

### Backend Support

The schedule service (`schedules.service.ts`) already handles the heavy lifting. Main gaps:
- No endpoint to list past executions for a specific schedule
- Frontend needs a multi-step form component (test picker + agent picker + recurrence config)

---

## 3. Trend Alerting

**Priority: Medium** — Valuable for continuous validation posture, but the analytics dashboard already surfaces trends visually.

### Current State

- TrendChart shows Defense Score, Error Rate, and Secure Score over time
- Toast/Alert UI components exist for ephemeral notifications
- No threshold logic, no persistence, no notification channels

### What's Missing

| Gap | Impact |
|-----|--------|
| No threshold-based alerts | A 20% Defense Score drop goes unnoticed until someone checks the dashboard |
| No alert rules management | Can't configure "alert if score < 70%" |
| No notification channels | No email, webhook, or Slack integration for alerts |
| No alert history | Can't review past threshold breaches |

### Suggested Implementation

Start simple — avoid building a full alerting engine:

1. **Dashboard Banner Alerts** — compute score deltas on page load. If Defense Score dropped >10% in the last 7 days, show a persistent warning banner at the top of the Analytics page. No backend changes needed — purely frontend logic using existing trend data.
2. **Score Thresholds (Phase 2)** — let users set red/yellow/green thresholds for Defense Score and Secure Score. Store in `~/.projectachilles/alert-config.json`. Show color-coded status on the hero metrics cards.
3. **Webhook Notifications (Phase 3)** — on schedule completion, if the resulting score crosses a threshold, POST to a configured webhook URL. This enables Slack/Teams/PagerDuty integration without building channel-specific code.

### Complexity Note

Phase 1 is a few hours of work (frontend only). Phase 3 requires backend changes to the schedule execution pipeline. Phase 2 is in between. Recommend starting with Phase 1 to get immediate value.

---

## 4. Export & Compliance Reporting

**Priority: Medium-High** — ProjectAchilles targets DORA/TIBER-EU compliance. Without exportable deliverables, users must manually compile reports from the dashboard.

### Current State

- 30+ analytics API endpoints return rich JSON data
- ExecutionsDataTable and charts display data but have no download actions
- Phase 11 (Reporting) exists in the pentest skills but not in the product UI
- No CSV, PDF, or JSON export anywhere in the frontend

### What's Missing

| Gap | Impact |
|-----|--------|
| No CSV export for execution data | Auditors and compliance teams need spreadsheet-friendly data |
| No PDF report generation | DORA/TIBER-EU deliverables require formal documentation |
| No "Download Chart" option | Can't include dashboard visuals in external reports |
| No scheduled report delivery | Manual process for recurring compliance reporting |

### Suggested Implementation

1. **CSV Export Button** — add a download button to ExecutionsDataTable. Use the existing paginated API with a high limit (or a new unpaginated endpoint) to fetch all matching rows, convert to CSV client-side, and trigger browser download. Low effort, high utility.
2. **Dashboard Snapshot PDF** — use `html2canvas` + `jsPDF` (or similar) to capture the current dashboard state as a PDF. Include date range, filter state, and a timestamp. This gives users a point-in-time compliance artifact.
3. **Structured Report Generator (Phase 2)** — a dedicated page that compiles a DORA/TIBER-EU report template with:
   - Executive summary (Defense Score, Secure Score, test coverage %)
   - Technique coverage heatmap
   - Top gaps and remediation priorities
   - Test execution history for the reporting period
   - Exportable as PDF and Markdown

### Complexity Note

CSV export is straightforward (1-2 days). Dashboard PDF snapshot requires a rendering library but is well-trodden territory. The structured report generator is a larger feature but is the most differentiated — few competitors offer one-click DORA/TIBER-EU deliverables.

---

## Evaluated and Deferred

### CTID Top Attack Techniques Correlation

**Decision: Deferred** — marginal value given existing infrastructure.

The [CTID Top Attack Techniques](https://github.com/center-for-threat-informed-defense/top-attack-techniques/) calculator ranks ATT&CK techniques by prevalence, choke points, and actionability. Correlation would answer: "Of the industry's top 10 most dangerous techniques, how many does our test library cover?"

**Why deferred:**
- ProjectAchilles already has a `mitre-top10` test category — the test library is organized this way
- Defense Score + Secure Score already provide two independent "how protected am I?" metrics
- Defender cross-correlation already maps technique overlap against real alerts
- The CTID data is static (a pre-computed ranked list), not a live threat feed
- Adding a third metric risks dashboard clutter without proportional insight gain

**Revisit when:** the CTID TAT2 renewal (2026) ships with an API and dynamic scoring. At that point, auto-syncing a threat-informed priority list could add real value.

---

## Suggested Sequence

```
Phase A (quick wins):
  ├── CSV Export on ExecutionsDataTable
  └── Dashboard Score Drop Banner (frontend-only alerting)

Phase B (high-value features):
  ├── Schedule Editor Dialog (unlock the existing backend capability)
  └── Agent Detail Page (task history + heartbeat timeline)

Phase C (differentiators):
  ├── Dashboard Snapshot PDF
  ├── Structured DORA/TIBER-EU Report Generator
  └── Webhook Notifications on threshold breach
```
