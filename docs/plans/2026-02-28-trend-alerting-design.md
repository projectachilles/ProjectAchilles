# Trend Alerting — Design Document

**Date:** 2026-02-28
**Roadmap Item:** #3 — Trend Alerting (Phase 3: Slack + Email notifications)

---

## Overview

Add threshold-based alerting to ProjectAchilles that sends Slack and email notifications when security posture metrics breach configured thresholds. Alerts fire after test result ingestion into Elasticsearch — tied to real test execution, not periodic polling.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger | Post-ingestion hook | `processSchedules()` is fire-and-forget; results arrive async. The ingestion path is the natural convergence point |
| Email transport | SMTP via Nodemailer | Zero vendor lock-in, works with any mail server, 13M+ weekly npm downloads |
| Slack integration | Incoming Webhooks + Block Kit | Simple, no bot token needed, rich formatting |
| Alertable metrics | Defense Score, Error Rate, Secure Score (if Defender configured) | Covers security posture + infrastructure health + compliance |
| Configuration UI | Settings → Integrations tab, new card | Follows existing IntegrationCard pattern |
| Alert history | In-memory ring buffer (last 50) | Low-volume operational data; avoids SQLite migration or ES index |
| Cooldown | Configurable (default 15 min) | Prevents alert storms from batch result ingestion |

## Data Model

### Types (`backend/src/types/integrations.ts`)

```typescript
interface AlertThresholds {
  defense_score_min?: number;    // Alert if Defense Score < this (e.g., 70)
  error_rate_max?: number;       // Alert if Error Rate > this (e.g., 20)
  secure_score_min?: number;     // Alert if Secure Score < this (e.g., 60)
  enabled: boolean;
}

interface SlackAlertSettings {
  webhook_url: string;           // Encrypted
  configured: boolean;
  enabled: boolean;
}

interface EmailAlertSettings {
  smtp_host: string;
  smtp_port: number;             // 587 (STARTTLS) or 465 (SSL)
  smtp_secure: boolean;
  smtp_user: string;             // Encrypted
  smtp_pass: string;             // Encrypted
  from_address: string;
  recipients: string[];
  configured: boolean;
  enabled: boolean;
}

interface AlertSettings {
  thresholds: AlertThresholds;
  slack?: SlackAlertSettings;
  email?: EmailAlertSettings;
  cooldown_minutes: number;      // Default 15
  last_alert_at?: string;        // ISO timestamp
}

// Extends existing IntegrationsSettings
interface IntegrationsSettings {
  azure?: AzureIntegrationSettings;
  defender?: DefenderIntegrationSettings;
  alerts?: AlertSettings;        // NEW
}
```

## Architecture

### Alert Flow

```
Agent reports result
  → POST /tasks/:id/result
  → ingestResult(task, result)
  → ES document created
  → alertsService.evaluateAndNotify(task, result)   ← async, fire-and-forget
      1. Is alerting enabled? (thresholds.enabled === true)
      2. Is cooldown elapsed? (now - last_alert_at > cooldown_minutes)
      3. Query ES for current Defense Score + Error Rate
      4. Query Defender Secure Score (if configured)
      5. Compare against thresholds
      6. If any threshold breached:
         a. Build alert payload
         b. Dispatch to Slack (if configured + enabled)
         c. Dispatch to email (if configured + enabled)
         d. Update last_alert_at + push to history ring buffer
```

### Backend File Structure

```
backend/src/services/alerts/
├── alerts.service.ts        # Threshold evaluation, cooldown, dispatch
├── slack.service.ts         # Block Kit formatting + webhook POST
├── email.service.ts         # Nodemailer SMTP + HTML template
└── __tests__/
    ├── alerts.service.test.ts
    ├── slack.service.test.ts
    └── email.service.test.ts
```

### API Routes (`/api/integrations/alerts/`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/integrations/alerts` | Get alert config (masked secrets) |
| POST | `/api/integrations/alerts` | Save alert config (partial update, encrypts secrets) |
| POST | `/api/integrations/alerts/test` | Send test notification to all configured channels |
| GET | `/api/integrations/alerts/history` | Last 50 alert events (in-memory) |

### Slack Message (Block Kit)

```
┌─────────────────────────────────────────┐
│ ⚠️  ProjectAchilles Alert              │
├─────────────────────────────────────────┤
│ Defense Score dropped below threshold   │
│                                         │
│ Defense Score:  45% (threshold: 70%)  ✗ │
│ Error Rate:     12% (threshold: 20%)  ✓ │
│ Secure Score:   58  (threshold: 60)   ✗ │
│                                         │
│ Triggered by: T1059 - Command Line      │
│ Agent: WORKSTATION-01                   │
│                                         │
│ [View Dashboard]                        │
└─────────────────────────────────────────┘
```

### Email

HTML email with inline CSS. Subject: `[ProjectAchilles] Alert: Defense Score below 70%`. Same content as Slack: metric table, trigger context, dashboard link.

## Frontend

### New Files

```
frontend/src/pages/settings/components/AlertsConfig.tsx
frontend/src/services/api/alerts.ts
```

### UI Layout

New `IntegrationCard` in `IntegrationsTab.tsx` after the Defender card, with three collapsible sections:

1. **Thresholds** — Enable toggle, Defense Score min, Error Rate max, Secure Score min (conditional on Defender), cooldown minutes
2. **Slack** — Enable toggle, webhook URL, test/save buttons
3. **Email (SMTP)** — Enable toggle, host, port, TLS toggle, username, password, from address, recipients, test/save buttons
4. **Recent Alerts** — Fetched from `/api/integrations/alerts/history`, shows last few with channel delivery status

Follows the exact `IntegrationCard` + `onStatusChange` callback pattern used by `DefenderConfig.tsx`.

## Dependencies

- `nodemailer` — SMTP email transport (new backend dependency)
- No new frontend dependencies

## Serverless Parity

Not in scope for this iteration. The Docker backend (`backend/`) is the target. The `backend-serverless/` fork would need:
- Async alert settings via Vercel Blob
- Nodemailer works in serverless (stateless SMTP)
- Slack webhook works unchanged
- Alert history would need blob or Turso storage instead of in-memory

## Testing

- `alerts.service.test.ts` — threshold evaluation, cooldown logic, dispatch routing
- `slack.service.test.ts` — Block Kit payload formatting, webhook POST (mocked fetch)
- `email.service.test.ts` — Nodemailer transport creation, HTML rendering (mocked transport)
- Integration in existing result ingestion tests (verify `evaluateAndNotify` is called)

## Research Sources

- [Slack Incoming Webhooks SDK](https://tools.slack.dev/node-slack-sdk/webhook/)
- [Slack Block Kit reference](https://api.slack.com/block-kit)
- [Block Kit formatting](https://docs.slack.dev/block-kit/formatting-with-rich-text/)
- [Slack webhook best practices](https://hookdeck.com/webhooks/platforms/guide-to-slack-webhooks-features-and-best-practices)
- [Nodemailer](https://nodemailer.com/)
- [Node.js email API comparison 2026](https://mailtrap.io/blog/best-email-api-for-nodejs-developers/)
