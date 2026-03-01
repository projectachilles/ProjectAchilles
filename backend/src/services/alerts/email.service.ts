import nodemailer from 'nodemailer';
import type { EmailAlertSettings } from '../../types/integrations.js';

// ---------------------------------------------------------------------------
// Local types (self-contained — no cross-imports from other alert services)
// ---------------------------------------------------------------------------

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

export type { MetricStatus, AlertEmailData };

// ---------------------------------------------------------------------------
// HTML email builder
// ---------------------------------------------------------------------------

function metricRow(m: MetricStatus, breached: boolean): string {
  const color = breached ? '#dc2626' : '#16a34a';
  const icon = breached ? '\u2717' : '\u2713';
  const status = breached ? 'Breached' : 'Passing';
  return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${m.metric}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${m.current}${m.unit}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${m.direction === 'below' ? '&ge; ' : '&le; '}${m.threshold}${m.unit}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${color};font-weight:600;">${icon} ${status}</td>
    </tr>`;
}

export function buildAlertEmailHtml(data: AlertEmailData): string {
  const breachCount = data.breaches.length;
  const totalMetrics = breachCount + (data.passing?.length ?? 0);
  const summary = `${breachCount} of ${totalMetrics} metric${totalMetrics !== 1 ? 's' : ''} breached`;

  const breachRows = data.breaches.map((m) => metricRow(m, true)).join('');
  const passingRows = (data.passing ?? []).map((m) => metricRow(m, false)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- Red banner -->
        <tr>
          <td style="background:#dc2626;padding:20px 24px;color:#ffffff;">
            <h1 style="margin:0;font-size:20px;font-weight:700;">ProjectAchilles Alert</h1>
            <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">${summary}</p>
          </td>
        </tr>

        <!-- Metrics table -->
        <tr>
          <td style="padding:24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse;">
              <thead>
                <tr style="background:#f9fafb;">
                  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Metric</th>
                  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Current</th>
                  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Threshold</th>
                  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${breachRows}${passingRows}
              </tbody>
            </table>
          </td>
        </tr>

        <!-- Context block -->
        <tr>
          <td style="padding:0 24px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:6px;padding:16px;">
              <tr>
                <td style="padding:4px 16px;font-size:14px;color:#374151;">
                  <strong>Triggered by:</strong> ${data.triggerTest}
                </td>
              </tr>
              <tr>
                <td style="padding:4px 16px;font-size:14px;color:#374151;">
                  <strong>Agent:</strong> ${data.triggerAgent}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Dashboard button -->
        <tr>
          <td style="padding:0 24px 24px;" align="center">
            <a href="${data.dashboardUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">View Dashboard</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
            Configure alert thresholds in Settings &rarr; Integrations &rarr; Alerts
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Send email via SMTP
// ---------------------------------------------------------------------------

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

export async function sendEmailAlert(
  settings: EmailAlertSettings,
  payload: { subject: string; html: string },
): Promise<void> {
  const transport = createTransport(settings);
  await transport.sendMail({
    from: settings.from_address,
    to: settings.recipients.join(', '),
    subject: payload.subject,
    html: payload.html,
  });
}

// ---------------------------------------------------------------------------
// Test SMTP connection
// ---------------------------------------------------------------------------

export async function testEmailConnection(
  settings: EmailAlertSettings,
): Promise<{ success: boolean; message: string }> {
  try {
    const transport = createTransport(settings);
    await transport.verify();
    return { success: true, message: 'SMTP connection verified successfully' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message: `SMTP connection failed: ${message}` };
  }
}
