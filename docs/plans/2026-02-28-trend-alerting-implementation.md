# Trend Alerting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add threshold-based Slack and email alerting that fires when Defense Score, Error Rate, or Secure Score breach configured thresholds after test result ingestion.

**Architecture:** Post-ingestion hook in the task result route fires an async `evaluateAndNotify()` call. The alerting service queries ES for current scores, compares against thresholds stored in `integrations.json` (encrypted), and dispatches to Slack (webhook + Block Kit) and/or email (Nodemailer SMTP). A cooldown prevents alert storms.

**Tech Stack:** Express, Nodemailer (new dependency), Slack Incoming Webhooks (native fetch), AES-256-GCM encryption, Vitest

---

## Task 1: Add Alert Types to `integrations.ts`

**Files:**
- Modify: `backend/src/types/integrations.ts`
- Test: existing compile check — `cd backend && npm run build`

**Step 1: Add the new type definitions**

Add these interfaces after the existing `DefenderIntegrationSettings` interface in `backend/src/types/integrations.ts`:

```typescript
// ---------------------------------------------------------------------------
// Alert & Notification Settings
// ---------------------------------------------------------------------------

export interface AlertThresholds {
  defense_score_min?: number;    // Alert if Defense Score < this (e.g., 70)
  error_rate_max?: number;       // Alert if Error Rate > this (e.g., 20)
  secure_score_min?: number;     // Alert if Secure Score < this (e.g., 60)
  enabled: boolean;
}

export interface SlackAlertSettings {
  webhook_url: string;           // Incoming webhook URL (encrypted at rest)
  configured: boolean;
  enabled: boolean;
}

export interface EmailAlertSettings {
  smtp_host: string;
  smtp_port: number;             // 587 (STARTTLS) or 465 (SSL)
  smtp_secure: boolean;          // true for port 465
  smtp_user: string;             // encrypted at rest
  smtp_pass: string;             // encrypted at rest
  from_address: string;          // e.g. "ProjectAchilles <alerts@example.com>"
  recipients: string[];          // e.g. ["admin@example.com", "security@example.com"]
  configured: boolean;
  enabled: boolean;
}

export interface AlertSettings {
  thresholds: AlertThresholds;
  slack?: SlackAlertSettings;
  email?: EmailAlertSettings;
  cooldown_minutes: number;      // Default 15
  last_alert_at?: string;        // ISO timestamp of last sent alert (persisted)
}
```

**Step 2: Extend `IntegrationsSettings` to include `alerts`**

Update the existing `IntegrationsSettings` interface:

```typescript
export interface IntegrationsSettings {
  azure?: AzureIntegrationSettings;
  defender?: DefenderIntegrationSettings;
  alerts?: AlertSettings;
}
```

**Step 3: Verify compilation**

Run: `cd backend && npm run build`
Expected: Clean build, no errors

**Step 4: Commit**

```bash
git add backend/src/types/integrations.ts
git commit -m "feat(backend): add alert settings type definitions"
```

---

## Task 2: Add Alert Settings to `IntegrationsSettingsService`

**Files:**
- Modify: `backend/src/services/integrations/settings.ts`
- Test: `backend/src/services/integrations/__tests__/settings.test.ts` (create if doesn't exist, or test via integration)

**Step 1: Write tests for alert settings CRUD**

Create `backend/src/services/integrations/__tests__/alerts-settings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs to avoid writing to real filesystem
vi.mock('fs');
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => '/tmp/test-home',
    hostname: () => 'test-host',
    userInfo: () => ({ username: 'test-user' }),
  };
});

const { IntegrationsSettingsService } = await import('../settings.js');

describe('IntegrationsSettingsService — Alert Settings', () => {
  let service: InstanceType<typeof IntegrationsSettingsService>;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    service = new IntegrationsSettingsService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAlertSettings', () => {
    it('returns null when no settings file exists', () => {
      expect(service.getAlertSettings()).toBeNull();
    });

    it('returns null when file exists but no alerts section', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ azure: {} }));
      expect(service.getAlertSettings()).toBeNull();
    });
  });

  describe('isAlertingConfigured', () => {
    it('returns false when not configured', () => {
      expect(service.isAlertingConfigured()).toBe(false);
    });
  });

  describe('saveAlertSettings', () => {
    it('encrypts sensitive fields and writes file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      service.saveAlertSettings({
        thresholds: { enabled: true, defense_score_min: 70 },
        cooldown_minutes: 15,
        slack: {
          webhook_url: 'https://hooks.slack.com/services/T00/B00/xxx',
          configured: true,
          enabled: true,
        },
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string);

      // Slack webhook URL should be encrypted
      expect(written.alerts.slack.webhook_url).toMatch(/^enc:/);
      // Thresholds are not encrypted (not sensitive)
      expect(written.alerts.thresholds.defense_score_min).toBe(70);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest src/services/integrations/__tests__/alerts-settings.test.ts`
Expected: FAIL — `getAlertSettings` and `saveAlertSettings` do not exist

**Step 3: Implement alert settings methods in `IntegrationsSettingsService`**

Add to `backend/src/services/integrations/settings.ts`, after the Defender methods:

```typescript
  // ---------------------------------------------------------------------------
  // Alert & Notification Settings
  // ---------------------------------------------------------------------------

  private getEnvAlertSettings(): AlertSettings | null {
    // Alerts are UI-configured only — no env var override
    return null;
  }

  /** Returns decrypted alert settings from file. */
  getAlertSettings(): AlertSettings | null {
    const fileSettings = this.getFileSettings();
    if (!fileSettings?.alerts) return null;

    const alerts = fileSettings.alerts;

    // Decrypt sensitive fields
    if (alerts.slack?.webhook_url?.startsWith('enc:')) {
      alerts.slack.webhook_url = this.decrypt(alerts.slack.webhook_url.slice(4));
    }
    if (alerts.email?.smtp_user?.startsWith('enc:')) {
      alerts.email.smtp_user = this.decrypt(alerts.email.smtp_user.slice(4));
    }
    if (alerts.email?.smtp_pass?.startsWith('enc:')) {
      alerts.email.smtp_pass = this.decrypt(alerts.email.smtp_pass.slice(4));
    }

    return alerts;
  }

  /** Save alert settings (encrypts sensitive fields). Supports partial update. */
  saveAlertSettings(settings: Partial<AlertSettings>): void {
    this.ensureSettingsDir();

    const existing = this.getFileSettings() ?? {};
    const current = existing.alerts ?? {
      thresholds: { enabled: false },
      cooldown_minutes: 15,
    };

    // Deep merge
    const merged: AlertSettings = {
      thresholds: { ...current.thresholds, ...settings.thresholds },
      cooldown_minutes: settings.cooldown_minutes ?? current.cooldown_minutes,
      last_alert_at: settings.last_alert_at ?? current.last_alert_at,
    };

    // Merge Slack settings
    if (settings.slack) {
      merged.slack = { ...current.slack, ...settings.slack } as SlackAlertSettings;
    } else if (current.slack) {
      merged.slack = current.slack;
    }

    // Merge email settings
    if (settings.email) {
      merged.email = { ...current.email, ...settings.email } as EmailAlertSettings;
    } else if (current.email) {
      merged.email = current.email;
    }

    // Encrypt sensitive fields for storage
    const toSave: IntegrationsSettings = { ...existing };
    const alertsToSave = { ...merged };

    if (alertsToSave.slack?.webhook_url && !alertsToSave.slack.webhook_url.startsWith('enc:')) {
      alertsToSave.slack = {
        ...alertsToSave.slack,
        webhook_url: 'enc:' + this.encrypt(alertsToSave.slack.webhook_url),
      };
    }
    if (alertsToSave.email?.smtp_user && !alertsToSave.email.smtp_user.startsWith('enc:')) {
      alertsToSave.email = {
        ...alertsToSave.email,
        smtp_user: 'enc:' + this.encrypt(alertsToSave.email.smtp_user),
      };
    }
    if (alertsToSave.email?.smtp_pass && !alertsToSave.email.smtp_pass.startsWith('enc:')) {
      alertsToSave.email = {
        ...alertsToSave.email,
        smtp_pass: 'enc:' + this.encrypt(alertsToSave.email.smtp_pass),
      };
    }

    toSave.alerts = alertsToSave;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
  }

  /** Check if alerting is configured (at least one channel enabled + thresholds on). */
  isAlertingConfigured(): boolean {
    const settings = this.getAlertSettings();
    if (!settings?.thresholds?.enabled) return false;
    const hasSlack = !!(settings.slack?.configured && settings.slack?.enabled);
    const hasEmail = !!(settings.email?.configured && settings.email?.enabled);
    return hasSlack || hasEmail;
  }

  /** Update last_alert_at timestamp (used by cooldown logic). */
  updateLastAlertTimestamp(timestamp: string): void {
    this.saveAlertSettings({ last_alert_at: timestamp });
  }
```

Also add to the import at the top of the file:

```typescript
import type { AzureIntegrationSettings, DefenderIntegrationSettings, IntegrationsSettings, AlertSettings, SlackAlertSettings, EmailAlertSettings } from '../../types/integrations.js';
```

And add decryption of alert fields to the `getFileSettings()` method — but actually, decryption for alerts happens in `getAlertSettings()` to keep the pattern consistent (each getter decrypts its own section). No changes to `getFileSettings()` needed.

**Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest src/services/integrations/__tests__/alerts-settings.test.ts`
Expected: PASS

**Step 5: Verify full build**

Run: `cd backend && npm run build`
Expected: Clean build

**Step 6: Commit**

```bash
git add backend/src/services/integrations/settings.ts backend/src/services/integrations/__tests__/alerts-settings.test.ts
git commit -m "feat(backend): add alert settings to IntegrationsSettingsService"
```

---

## Task 3: Install Nodemailer and Create Email Service

**Files:**
- Modify: `backend/package.json` (add `nodemailer` + `@types/nodemailer`)
- Create: `backend/src/services/alerts/email.service.ts`
- Create: `backend/src/services/alerts/__tests__/email.service.test.ts`

**Step 1: Install nodemailer**

Run: `cd backend && npm install nodemailer && npm install -D @types/nodemailer`

**Step 2: Write failing test for email service**

Create `backend/src/services/alerts/__tests__/email.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nodemailer before import
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      verify: vi.fn().mockResolvedValue(true),
    })),
  },
}));

const { sendEmailAlert, testEmailConnection, buildAlertEmailHtml } = await import('../email.service.js');

describe('email.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildAlertEmailHtml', () => {
    it('includes breached metric in subject-friendly summary', () => {
      const html = buildAlertEmailHtml({
        breaches: [
          { metric: 'Defense Score', current: 45, threshold: 70, unit: '%', direction: 'below' },
        ],
        triggerTest: 'T1059 - Command Line',
        triggerAgent: 'WORKSTATION-01',
        dashboardUrl: 'http://localhost:5173/analytics',
      });

      expect(html).toContain('Defense Score');
      expect(html).toContain('45');
      expect(html).toContain('70');
    });

    it('marks passing metrics with checkmark', () => {
      const html = buildAlertEmailHtml({
        breaches: [
          { metric: 'Defense Score', current: 45, threshold: 70, unit: '%', direction: 'below' },
        ],
        passing: [
          { metric: 'Error Rate', current: 12, threshold: 20, unit: '%', direction: 'below' },
        ],
        triggerTest: 'T1059',
        triggerAgent: 'AGENT-01',
        dashboardUrl: 'http://localhost:5173/analytics',
      });

      expect(html).toContain('Error Rate');
    });
  });

  describe('sendEmailAlert', () => {
    it('calls nodemailer sendMail with correct parameters', async () => {
      await sendEmailAlert(
        {
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'user@example.com',
          smtp_pass: 'password',
          from_address: 'ProjectAchilles <alerts@example.com>',
          recipients: ['admin@example.com'],
          configured: true,
          enabled: true,
        },
        {
          subject: '[ProjectAchilles] Alert: Defense Score below 70%',
          html: '<p>Test</p>',
        }
      );

      expect(mockSendMail).toHaveBeenCalledOnce();
      const call = mockSendMail.mock.calls[0][0];
      expect(call.from).toBe('ProjectAchilles <alerts@example.com>');
      expect(call.to).toBe('admin@example.com');
      expect(call.subject).toContain('Defense Score');
    });
  });

  describe('testEmailConnection', () => {
    it('returns success when verify passes', async () => {
      const result = await testEmailConnection({
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_secure: false,
        smtp_user: 'user@example.com',
        smtp_pass: 'password',
        from_address: 'test@example.com',
        recipients: ['admin@example.com'],
        configured: true,
        enabled: true,
      });

      expect(result.success).toBe(true);
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest src/services/alerts/__tests__/email.service.test.ts`
Expected: FAIL — module not found

**Step 4: Implement email service**

Create `backend/src/services/alerts/email.service.ts`:

```typescript
import nodemailer from 'nodemailer';
import type { EmailAlertSettings } from '../../types/integrations.js';

interface AlertEmailPayload {
  subject: string;
  html: string;
}

interface MetricStatus {
  metric: string;
  current: number;
  threshold: number;
  unit: string;
  direction: 'below' | 'above';
}

interface AlertEmailData {
  breaches: MetricStatus[];
  passing?: MetricStatus[];
  triggerTest: string;
  triggerAgent: string;
  dashboardUrl: string;
}

function createTransport(settings: EmailAlertSettings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_secure,
    auth: {
      user: settings.smtp_user,
      pass: settings.smtp_pass,
    },
  });
}

export function buildAlertEmailHtml(data: AlertEmailData): string {
  const metricRow = (m: MetricStatus, breached: boolean) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${m.metric}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:bold;color:${breached ? '#dc2626' : '#16a34a'};">
        ${m.current}${m.unit}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${m.direction === 'below' ? '<' : '>'} ${m.threshold}${m.unit}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${breached ? '✗' : '✓'}</td>
    </tr>`;

  const breachRows = data.breaches.map(m => metricRow(m, true)).join('');
  const passingRows = (data.passing ?? []).map(m => metricRow(m, false)).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;margin-bottom:24px;border-radius:4px;">
    <h2 style="margin:0 0 4px;color:#dc2626;">ProjectAchilles Alert</h2>
    <p style="margin:0;color:#991b1b;">${data.breaches.map(b => `${b.metric} ${b.direction} threshold`).join(', ')}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Metric</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Current</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Threshold</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${breachRows}
      ${passingRows}
    </tbody>
  </table>

  <div style="background:#f9fafb;padding:12px 16px;border-radius:4px;margin-bottom:24px;">
    <p style="margin:0 0 4px;"><strong>Triggered by:</strong> ${data.triggerTest}</p>
    <p style="margin:0;"><strong>Agent:</strong> ${data.triggerAgent}</p>
  </div>

  <a href="${data.dashboardUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:500;">
    View Dashboard
  </a>

  <p style="margin-top:24px;font-size:12px;color:#9ca3af;">
    This alert was sent by ProjectAchilles. Configure alert thresholds in Settings → Integrations → Alerts.
  </p>
</body>
</html>`;
}

export async function sendEmailAlert(
  settings: EmailAlertSettings,
  payload: AlertEmailPayload
): Promise<void> {
  const transport = createTransport(settings);
  await transport.sendMail({
    from: settings.from_address,
    to: settings.recipients.join(', '),
    subject: payload.subject,
    html: payload.html,
  });
}

export async function testEmailConnection(
  settings: EmailAlertSettings
): Promise<{ success: boolean; message: string }> {
  try {
    const transport = createTransport(settings);
    await transport.verify();
    return { success: true, message: 'SMTP connection verified successfully' };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'SMTP connection failed',
    };
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest src/services/alerts/__tests__/email.service.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/services/alerts/email.service.ts backend/src/services/alerts/__tests__/email.service.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(backend): add email alerting service with Nodemailer"
```

---

## Task 4: Create Slack Service

**Files:**
- Create: `backend/src/services/alerts/slack.service.ts`
- Create: `backend/src/services/alerts/__tests__/slack.service.test.ts`

**Step 1: Write failing test**

Create `backend/src/services/alerts/__tests__/slack.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  text: () => Promise.resolve('ok'),
});
vi.stubGlobal('fetch', mockFetch);

const { sendSlackAlert, testSlackWebhook, buildSlackBlocks } = await import('../slack.service.js');

describe('slack.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSlackBlocks', () => {
    it('includes breach details in blocks', () => {
      const blocks = buildSlackBlocks({
        breaches: [
          { metric: 'Defense Score', current: 45, threshold: 70, unit: '%', direction: 'below' },
        ],
        triggerTest: 'T1059 - Command Line',
        triggerAgent: 'WORKSTATION-01',
        dashboardUrl: 'http://localhost:5173/analytics',
      });

      const text = JSON.stringify(blocks);
      expect(text).toContain('Defense Score');
      expect(text).toContain('45%');
      expect(text).toContain('70%');
    });
  });

  describe('sendSlackAlert', () => {
    it('POSTs Block Kit payload to webhook URL', async () => {
      await sendSlackAlert('https://hooks.slack.com/services/T00/B00/xxx', {
        breaches: [
          { metric: 'Defense Score', current: 45, threshold: 70, unit: '%', direction: 'below' },
        ],
        triggerTest: 'T1059',
        triggerAgent: 'AGENT-01',
        dashboardUrl: 'http://localhost:5173/analytics',
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/T00/B00/xxx');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(opts.body);
      expect(body.blocks).toBeDefined();
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('channel_not_found'),
      });

      await expect(
        sendSlackAlert('https://hooks.slack.com/services/T00/B00/bad', {
          breaches: [{ metric: 'Defense Score', current: 45, threshold: 70, unit: '%', direction: 'below' }],
          triggerTest: 'T1059',
          triggerAgent: 'AGENT-01',
          dashboardUrl: 'http://localhost:5173/analytics',
        })
      ).rejects.toThrow();
    });
  });

  describe('testSlackWebhook', () => {
    it('sends a test message and returns success', async () => {
      const result = await testSlackWebhook('https://hooks.slack.com/services/T00/B00/xxx');
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest src/services/alerts/__tests__/slack.service.test.ts`
Expected: FAIL — module not found

**Step 3: Implement Slack service**

Create `backend/src/services/alerts/slack.service.ts`:

```typescript
interface MetricStatus {
  metric: string;
  current: number;
  threshold: number;
  unit: string;
  direction: 'below' | 'above';
}

interface AlertData {
  breaches: MetricStatus[];
  passing?: MetricStatus[];
  triggerTest: string;
  triggerAgent: string;
  dashboardUrl: string;
}

function metricLine(m: MetricStatus, breached: boolean): string {
  const icon = breached ? '✗' : '✓';
  return `${icon}  *${m.metric}:*  ${m.current}${m.unit}  (threshold: ${m.direction === 'below' ? '<' : '>'} ${m.threshold}${m.unit})`;
}

export function buildSlackBlocks(data: AlertData): object[] {
  const breachLines = data.breaches.map(m => metricLine(m, true));
  const passingLines = (data.passing ?? []).map(m => metricLine(m, false));
  const allLines = [...breachLines, ...passingLines].join('\n');

  const summary = data.breaches.map(b => `${b.metric} ${b.direction} threshold`).join(', ');

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'ProjectAchilles Alert', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: summary },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: allLines },
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `*Triggered by:* ${data.triggerTest}` },
        { type: 'mrkdwn', text: `*Agent:* ${data.triggerAgent}` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Dashboard' },
          url: data.dashboardUrl,
          style: 'primary',
        },
      ],
    },
  ];
}

export async function sendSlackAlert(webhookUrl: string, data: AlertData): Promise<void> {
  const blocks = buildSlackBlocks(data);
  const summary = data.breaches.map(b => `${b.metric} ${b.direction} threshold`).join(', ');

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `ProjectAchilles Alert: ${summary}`,  // Fallback for notifications
      blocks,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${body}`);
  }
}

export async function testSlackWebhook(
  webhookUrl: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'ProjectAchilles alert test — Slack integration is working!',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { success: false, message: `Webhook returned ${response.status}: ${body}` };
    }

    return { success: true, message: 'Test message sent to Slack successfully' };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Slack webhook test failed',
    };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest src/services/alerts/__tests__/slack.service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/alerts/slack.service.ts backend/src/services/alerts/__tests__/slack.service.test.ts
git commit -m "feat(backend): add Slack alerting service with Block Kit"
```

---

## Task 5: Create Core Alerting Service (Threshold Evaluation + Dispatch)

**Files:**
- Create: `backend/src/services/alerts/alerts.service.ts`
- Create: `backend/src/services/alerts/__tests__/alerts.service.test.ts`

This is the central orchestrator: evaluates thresholds, checks cooldown, queries ES, dispatches to channels.

**Step 1: Write failing test**

Create `backend/src/services/alerts/__tests__/alerts.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: vi.fn().mockImplementation(() => ({
    getAlertSettings: vi.fn().mockReturnValue(null),
    isAlertingConfigured: vi.fn().mockReturnValue(false),
    isDefenderConfigured: vi.fn().mockReturnValue(false),
    saveAlertSettings: vi.fn(),
  })),
}));

vi.mock('../../analytics/settings.js', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    isConfigured: vi.fn().mockReturnValue(true),
    getSettings: vi.fn().mockReturnValue({
      node: 'http://localhost:9200',
      indexPattern: 'achilles-results-*',
      configured: true,
    }),
  })),
}));

vi.mock('../../analytics/elasticsearch.js', () => ({
  ElasticsearchService: vi.fn().mockImplementation(() => ({
    getDefenseScore: vi.fn().mockResolvedValue({ score: 80, protectedCount: 80, unprotectedCount: 20, totalExecutions: 100 }),
    getErrorRate: vi.fn().mockResolvedValue({ errorRate: 10, errorCount: 10, conclusiveCount: 90, totalTestActivity: 100 }),
  })),
}));

vi.mock('../../defender/analytics.service.js', () => ({
  DefenderAnalyticsService: vi.fn().mockImplementation(() => ({
    getCurrentSecureScore: vi.fn().mockResolvedValue({ currentScore: 65, maxScore: 100, percentage: 65, averageComparative: null }),
  })),
}));

vi.mock('../slack.service.js', () => ({
  sendSlackAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../email.service.js', () => ({
  sendEmailAlert: vi.fn().mockResolvedValue(undefined),
  buildAlertEmailHtml: vi.fn().mockReturnValue('<p>test</p>'),
}));

const { AlertsService } = await import('../alerts.service.js');
const { IntegrationsSettingsService } = await import('../../integrations/settings.js');
const { sendSlackAlert } = await import('../slack.service.js');
const { sendEmailAlert } = await import('../email.service.js');

describe('AlertsService', () => {
  let service: InstanceType<typeof AlertsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AlertsService();
  });

  describe('evaluateAndNotify', () => {
    it('does nothing when alerting is not configured', async () => {
      await service.evaluateAndNotify('T1059 - Command Line', 'WORKSTATION-01');
      expect(sendSlackAlert).not.toHaveBeenCalled();
      expect(sendEmailAlert).not.toHaveBeenCalled();
    });

    it('sends alerts when defense score breaches threshold', async () => {
      // Configure alerting with defense score threshold
      const mockSettings = {
        getAlertSettings: vi.fn().mockReturnValue({
          thresholds: { enabled: true, defense_score_min: 90 },
          cooldown_minutes: 15,
          slack: { webhook_url: 'https://hooks.slack.com/test', configured: true, enabled: true },
        }),
        isAlertingConfigured: vi.fn().mockReturnValue(true),
        isDefenderConfigured: vi.fn().mockReturnValue(false),
        saveAlertSettings: vi.fn(),
      };
      vi.mocked(IntegrationsSettingsService).mockImplementation(() => mockSettings as any);

      service = new AlertsService();
      await service.evaluateAndNotify('T1059 - Command Line', 'WORKSTATION-01');

      expect(sendSlackAlert).toHaveBeenCalledOnce();
    });

    it('respects cooldown period', async () => {
      const recentTimestamp = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago
      const mockSettings = {
        getAlertSettings: vi.fn().mockReturnValue({
          thresholds: { enabled: true, defense_score_min: 90 },
          cooldown_minutes: 15,
          last_alert_at: recentTimestamp,
          slack: { webhook_url: 'https://hooks.slack.com/test', configured: true, enabled: true },
        }),
        isAlertingConfigured: vi.fn().mockReturnValue(true),
        isDefenderConfigured: vi.fn().mockReturnValue(false),
        saveAlertSettings: vi.fn(),
      };
      vi.mocked(IntegrationsSettingsService).mockImplementation(() => mockSettings as any);

      service = new AlertsService();
      await service.evaluateAndNotify('T1059', 'AGENT-01');

      // Should NOT send due to cooldown
      expect(sendSlackAlert).not.toHaveBeenCalled();
    });

    it('does not alert when all metrics pass thresholds', async () => {
      const mockSettings = {
        getAlertSettings: vi.fn().mockReturnValue({
          thresholds: { enabled: true, defense_score_min: 70 }, // Score is 80, passes
          cooldown_minutes: 15,
          slack: { webhook_url: 'https://hooks.slack.com/test', configured: true, enabled: true },
        }),
        isAlertingConfigured: vi.fn().mockReturnValue(true),
        isDefenderConfigured: vi.fn().mockReturnValue(false),
        saveAlertSettings: vi.fn(),
      };
      vi.mocked(IntegrationsSettingsService).mockImplementation(() => mockSettings as any);

      service = new AlertsService();
      await service.evaluateAndNotify('T1059', 'AGENT-01');

      expect(sendSlackAlert).not.toHaveBeenCalled();
    });
  });

  describe('getAlertHistory', () => {
    it('returns empty array initially', () => {
      expect(service.getAlertHistory()).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest src/services/alerts/__tests__/alerts.service.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the core alerting service**

Create `backend/src/services/alerts/alerts.service.ts`:

```typescript
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { SettingsService } from '../analytics/settings.js';
import { ElasticsearchService } from '../analytics/elasticsearch.js';
import { DefenderAnalyticsService } from '../defender/analytics.service.js';
import { sendSlackAlert } from './slack.service.js';
import { sendEmailAlert, buildAlertEmailHtml } from './email.service.js';

interface MetricStatus {
  metric: string;
  current: number;
  threshold: number;
  unit: string;
  direction: 'below' | 'above';
}

export interface AlertHistoryEntry {
  timestamp: string;
  breaches: MetricStatus[];
  channels: { slack: boolean; email: boolean };
  triggerTest: string;
  triggerAgent: string;
}

const MAX_HISTORY = 50;

export class AlertsService {
  private history: AlertHistoryEntry[] = [];

  async evaluateAndNotify(triggerTest: string, triggerAgent: string): Promise<void> {
    const integrationsSettings = new IntegrationsSettingsService();

    if (!integrationsSettings.isAlertingConfigured()) return;

    const alertSettings = integrationsSettings.getAlertSettings();
    if (!alertSettings?.thresholds?.enabled) return;

    // Check cooldown
    if (alertSettings.last_alert_at) {
      const lastAlert = new Date(alertSettings.last_alert_at).getTime();
      const cooldownMs = (alertSettings.cooldown_minutes ?? 15) * 60_000;
      if (Date.now() - lastAlert < cooldownMs) return;
    }

    // Query current metrics
    const analyticsSettings = new SettingsService();
    if (!analyticsSettings.isConfigured()) return;

    const esService = new ElasticsearchService(analyticsSettings.getSettings());
    const thresholds = alertSettings.thresholds;

    const breaches: MetricStatus[] = [];
    const passing: MetricStatus[] = [];

    // Defense Score
    if (thresholds.defense_score_min !== undefined) {
      const { score } = await esService.getDefenseScore({});
      const status: MetricStatus = {
        metric: 'Defense Score',
        current: Math.round(score),
        threshold: thresholds.defense_score_min,
        unit: '%',
        direction: 'below',
      };
      if (score < thresholds.defense_score_min) {
        breaches.push(status);
      } else {
        passing.push(status);
      }
    }

    // Error Rate
    if (thresholds.error_rate_max !== undefined) {
      const { errorRate } = await esService.getErrorRate({});
      const status: MetricStatus = {
        metric: 'Error Rate',
        current: Math.round(errorRate),
        threshold: thresholds.error_rate_max,
        unit: '%',
        direction: 'above',
      };
      if (errorRate > thresholds.error_rate_max) {
        breaches.push(status);
      } else {
        passing.push(status);
      }
    }

    // Secure Score (only if Defender is configured)
    if (thresholds.secure_score_min !== undefined && integrationsSettings.isDefenderConfigured()) {
      try {
        const defenderService = new DefenderAnalyticsService();
        const { percentage } = await defenderService.getCurrentSecureScore();
        const status: MetricStatus = {
          metric: 'Secure Score',
          current: Math.round(percentage),
          threshold: thresholds.secure_score_min,
          unit: '%',
          direction: 'below',
        };
        if (percentage < thresholds.secure_score_min) {
          breaches.push(status);
        } else {
          passing.push(status);
        }
      } catch {
        // Defender query failed — skip, don't block alerting
      }
    }

    // No breaches — nothing to alert on
    if (breaches.length === 0) return;

    const dashboardUrl = process.env.CORS_ORIGIN
      ? `${process.env.CORS_ORIGIN}/analytics`
      : 'http://localhost:5173/analytics';

    const alertData = { breaches, passing, triggerTest, triggerAgent, dashboardUrl };
    const channels = { slack: false, email: false };

    // Dispatch to Slack
    if (alertSettings.slack?.configured && alertSettings.slack?.enabled) {
      try {
        await sendSlackAlert(alertSettings.slack.webhook_url, alertData);
        channels.slack = true;
      } catch (err) {
        console.error('[Alerts] Slack dispatch failed:', err instanceof Error ? err.message : err);
      }
    }

    // Dispatch to email
    if (alertSettings.email?.configured && alertSettings.email?.enabled) {
      try {
        const subject = `[ProjectAchilles] Alert: ${breaches.map(b => `${b.metric} ${b.direction} ${b.threshold}${b.unit}`).join(', ')}`;
        const html = buildAlertEmailHtml(alertData);
        await sendEmailAlert(alertSettings.email, { subject, html });
        channels.email = true;
      } catch (err) {
        console.error('[Alerts] Email dispatch failed:', err instanceof Error ? err.message : err);
      }
    }

    // Update cooldown timestamp
    integrationsSettings.saveAlertSettings({ last_alert_at: new Date().toISOString() });

    // Push to history
    this.history.unshift({
      timestamp: new Date().toISOString(),
      breaches,
      channels,
      triggerTest,
      triggerAgent,
    });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(0, MAX_HISTORY);
    }
  }

  getAlertHistory(): AlertHistoryEntry[] {
    return this.history;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest src/services/alerts/__tests__/alerts.service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/alerts/alerts.service.ts backend/src/services/alerts/__tests__/alerts.service.test.ts
git commit -m "feat(backend): add core alerting service with threshold evaluation and dispatch"
```

---

## Task 6: Add Alert API Routes

**Files:**
- Modify: `backend/src/api/integrations.routes.ts`

**Step 1: Add alert routes to the existing integrations router**

Add to the bottom of `backend/src/api/integrations.routes.ts`, before the `export default router`:

```typescript
import { AlertsService } from '../services/alerts/alerts.service.js';
import { testSlackWebhook } from '../services/alerts/slack.service.js';
import { testEmailConnection } from '../services/alerts/email.service.js';

const alertsService = new AlertsService();

// Make alertsService accessible for the result ingestion hook
export { alertsService };

// ---------------------------------------------------------------------------
// Alerts & Notifications
// ---------------------------------------------------------------------------

/** GET /api/integrations/alerts — Returns masked alert settings */
router.get('/alerts', requirePermission('integrations:read'), (_req, res) => {
  const settings = settingsService.getAlertSettings();

  if (!settings) {
    res.json({ configured: false });
    return;
  }

  const mask = (val: string) =>
    val.length > 4 ? '****' + val.slice(-4) : '****';

  res.json({
    configured: true,
    thresholds: settings.thresholds,
    cooldown_minutes: settings.cooldown_minutes,
    last_alert_at: settings.last_alert_at,
    slack: settings.slack ? {
      configured: settings.slack.configured,
      enabled: settings.slack.enabled,
      webhook_url_set: !!settings.slack.webhook_url,
    } : undefined,
    email: settings.email ? {
      configured: settings.email.configured,
      enabled: settings.email.enabled,
      smtp_host: settings.email.smtp_host,
      smtp_port: settings.email.smtp_port,
      smtp_secure: settings.email.smtp_secure,
      smtp_user: settings.email.smtp_user ? mask(settings.email.smtp_user) : undefined,
      from_address: settings.email.from_address,
      recipients: settings.email.recipients,
    } : undefined,
  });
});

/** POST /api/integrations/alerts — Save alert settings (partial update) */
router.post('/alerts', requirePermission('integrations:write'),
  asyncHandler(async (req, res) => {
    settingsService.saveAlertSettings(req.body);
    res.json({ success: true });
  })
);

/** POST /api/integrations/alerts/test — Send test notification */
router.post('/alerts/test', requirePermission('integrations:write'),
  asyncHandler(async (req, res) => {
    const settings = settingsService.getAlertSettings();
    const results: { slack?: { success: boolean; message: string }; email?: { success: boolean; message: string } } = {};

    // Test Slack if webhook provided in request or already configured
    const slackUrl = req.body.slack_webhook_url || settings?.slack?.webhook_url;
    if (slackUrl) {
      results.slack = await testSlackWebhook(slackUrl);
    }

    // Test email if SMTP settings provided in request or already configured
    const emailSettings = req.body.email || settings?.email;
    if (emailSettings?.smtp_host) {
      results.email = await testEmailConnection(emailSettings);
    }

    res.json({ success: true, data: results });
  })
);

/** GET /api/integrations/alerts/history — Recent alert events */
router.get('/alerts/history', requirePermission('integrations:read'), (_req, res) => {
  res.json({ success: true, data: alertsService.getAlertHistory() });
});
```

**Step 2: Verify compilation**

Run: `cd backend && npm run build`
Expected: Clean build

**Step 3: Commit**

```bash
git add backend/src/api/integrations.routes.ts
git commit -m "feat(backend): add alert configuration and test API routes"
```

---

## Task 7: Hook Alerting into Result Ingestion Pipeline

**Files:**
- Modify: `backend/src/api/agent/tasks.routes.ts`

**Step 1: Add the alert evaluation call after result ingestion**

In `backend/src/api/agent/tasks.routes.ts`, modify the `POST /tasks/:id/result` handler. After the `ingestResult()` call (line ~106), add the alert evaluation:

```typescript
import { alertsService } from '../integrations.routes.js';
```

Then in the handler, after the existing `ingestResult` call:

```typescript
    // Only ingest security test results into ES (not command results)
    if (task.type === 'execute_test') {
      ingestResult(task, result).then(() => {
        // Evaluate alert thresholds after successful ingestion
        alertsService.evaluateAndNotify(
          task.payload.test_name,
          result.hostname ?? 'unknown',
        ).catch((err) => {
          console.error('[Alerts] Evaluation failed for task %s:', task.id,
            err instanceof Error ? err.message : err);
        });
      }).catch((err) => {
        console.error('[ES Ingestion] Failed for task %s:', task.id,
          err instanceof Error ? err.message : err);
      });
    }
```

Note: The alert evaluation runs `.then()` on the ingestion promise, so it only evaluates after the result is in ES (ensuring the query reflects the latest data).

**Step 2: Verify compilation**

Run: `cd backend && npm run build`
Expected: Clean build

**Step 3: Run existing task route tests to make sure nothing broke**

Run: `cd backend && npx vitest src/services/agent/__tests__/tasks.service.test.ts`
Expected: PASS (existing tests unaffected)

**Step 4: Commit**

```bash
git add backend/src/api/agent/tasks.routes.ts
git commit -m "feat(backend): hook alert evaluation into result ingestion pipeline"
```

---

## Task 8: Create Frontend API Client for Alerts

**Files:**
- Create: `frontend/src/services/api/alerts.ts`

**Step 1: Create the API client module**

Create `frontend/src/services/api/alerts.ts`:

```typescript
import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { AlertHistoryEntry } from './alerts.types';

export interface AlertSettingsMasked {
  configured: boolean;
  thresholds?: {
    defense_score_min?: number;
    error_rate_max?: number;
    secure_score_min?: number;
    enabled: boolean;
  };
  cooldown_minutes?: number;
  last_alert_at?: string;
  slack?: {
    configured: boolean;
    enabled: boolean;
    webhook_url_set: boolean;
  };
  email?: {
    configured: boolean;
    enabled: boolean;
    smtp_host?: string;
    smtp_port?: number;
    smtp_secure?: boolean;
    smtp_user?: string;
    from_address?: string;
    recipients?: string[];
  };
}

export interface SaveAlertSettingsRequest {
  thresholds?: {
    defense_score_min?: number;
    error_rate_max?: number;
    secure_score_min?: number;
    enabled?: boolean;
  };
  cooldown_minutes?: number;
  slack?: {
    webhook_url?: string;
    configured?: boolean;
    enabled?: boolean;
  };
  email?: {
    smtp_host?: string;
    smtp_port?: number;
    smtp_secure?: boolean;
    smtp_user?: string;
    smtp_pass?: string;
    from_address?: string;
    recipients?: string[];
    configured?: boolean;
    enabled?: boolean;
  };
}

export interface TestAlertResult {
  success: boolean;
  data: {
    slack?: { success: boolean; message: string };
    email?: { success: boolean; message: string };
  };
}

export interface AlertHistoryItem {
  timestamp: string;
  breaches: Array<{
    metric: string;
    current: number;
    threshold: number;
    unit: string;
    direction: 'below' | 'above';
  }>;
  channels: { slack: boolean; email: boolean };
  triggerTest: string;
  triggerAgent: string;
}

export const alertsApi = {
  async getAlertSettings(): Promise<AlertSettingsMasked> {
    try {
      const response = await apiClient.get('/integrations/alerts');
      return response.data;
    } catch {
      return { configured: false };
    }
  },

  async saveAlertSettings(settings: SaveAlertSettingsRequest): Promise<{ success: boolean }> {
    const response = await apiClient.post('/integrations/alerts', settings);
    return response.data;
  },

  async testAlertChannels(params?: {
    slack_webhook_url?: string;
    email?: SaveAlertSettingsRequest['email'];
  }): Promise<TestAlertResult> {
    const response = await apiClient.post('/integrations/alerts/test', params ?? {});
    return response.data;
  },

  async getAlertHistory(): Promise<AlertHistoryItem[]> {
    try {
      const response = await apiClient.get('/integrations/alerts/history');
      return response.data.data ?? [];
    } catch {
      return [];
    }
  },
};
```

**Step 2: Verify frontend compiles (remove unused type import if needed)**

Run: `cd frontend && npm run build`
Expected: Clean build (the file is self-contained, no unused imports)

**Step 3: Commit**

```bash
git add frontend/src/services/api/alerts.ts
git commit -m "feat(frontend): add alerts API client module"
```

---

## Task 9: Create `AlertsConfig` Settings Component

**Files:**
- Create: `frontend/src/pages/settings/components/AlertsConfig.tsx`
- Modify: `frontend/src/pages/settings/components/IntegrationsTab.tsx`

This is the largest frontend task. The component has three sections: Thresholds, Slack, and Email (SMTP), plus a Recent Alerts section.

**Step 1: Create the AlertsConfig component**

Create `frontend/src/pages/settings/components/AlertsConfig.tsx`. This follows the exact same pattern as `DefenderConfig.tsx` — load existing settings on mount, form fields, test/save buttons.

The component should:
- Load settings from `alertsApi.getAlertSettings()` on mount
- Have three collapsible sections (Thresholds, Slack, Email) using simple `<details>` or state toggles
- Show Secure Score threshold row only when Defender is configured (fetch from `integrationsApi.getDefenderSettings()`)
- "Test" button calls `alertsApi.testAlertChannels()`
- "Save" button calls `alertsApi.saveAlertSettings()`
- Report status up via `onStatusChange` callback
- Show recent alerts from `alertsApi.getAlertHistory()`

Use the existing UI primitives: `Input`, `Button`, `Alert`, `Spinner` from `@/components/shared/ui/`.

**Step 2: Wire into IntegrationsTab**

In `frontend/src/pages/settings/components/IntegrationsTab.tsx`:

Add import:
```typescript
import { Bell } from 'lucide-react';
import { AlertsConfig } from './AlertsConfig';
import { alertsApi } from '@/services/api/alerts';
```

Add state:
```typescript
const [alertsStatus, setAlertsStatus] = useState<IntegrationStatus>('not-configured');
const [alertsLoaded, setAlertsLoaded] = useState(false);

const handleAlertsStatusChange = useCallback((configured: boolean) => {
  setAlertsStatus(configured ? 'connected' : 'not-configured');
}, []);
```

Add to useEffect (alongside Azure/Defender fetch):
```typescript
alertsApi.getAlertSettings().then((settings) => {
  setAlertsStatus(settings.configured ? 'connected' : 'not-configured');
  setAlertsLoaded(true);
}).catch(() => {
  setAlertsLoaded(true);
});
```

Add the card after the Defender card:
```tsx
<IntegrationCard
  icon={Bell}
  title="Alerts & Notifications"
  description="Threshold-based alerting via Slack and email on score changes"
  status={alertsStatus}
  defaultExpanded={alertsLoaded && alertsStatus === 'not-configured'}
>
  <AlertsConfig onStatusChange={handleAlertsStatusChange} />
</IntegrationCard>
```

**Step 3: Verify frontend compiles**

Run: `cd frontend && npm run build`
Expected: Clean build

**Step 4: Commit**

```bash
git add frontend/src/pages/settings/components/AlertsConfig.tsx frontend/src/pages/settings/components/IntegrationsTab.tsx
git commit -m "feat(frontend): add AlertsConfig settings component with Slack and email"
```

---

## Task 10: Run Full Test Suites and Verify

**Step 1: Run backend tests**

Run: `cd backend && npm test`
Expected: All tests pass (including new alert tests)

**Step 2: Run frontend tests**

Run: `cd frontend && npm test`
Expected: All tests pass

**Step 3: Run backend build**

Run: `cd backend && npm run build`
Expected: Clean build

**Step 4: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Clean build

**Step 5: Manual smoke test**

Start the dev server: `./start.sh -k --daemon`
Navigate to Settings → Integrations. Verify the Alerts & Notifications card appears. Expand and verify all form sections render.

**Step 6: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix(backend): address test/build issues from alerting feature"
```
