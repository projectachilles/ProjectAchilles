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

interface AlertData {
  breaches: MetricStatus[];
  passing?: MetricStatus[];
  triggerTest: string;
  triggerAgent: string;
  dashboardUrl: string;
}

export type { MetricStatus, AlertData };

/** A hung webhook must not stall the caller (the notice pass runs on the scheduler tick). */
const SLACK_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Webhook URL validation
// ---------------------------------------------------------------------------

/** `/services/...` (incoming webhooks) or `/workflows/...`, plain path segments only. */
const SLACK_WEBHOOK_PATH = /^\/(services|workflows)\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+)$/;

/**
 * The request URL for a Slack webhook, or null when `url` isn't one.
 *
 * The saved webhook is admin-supplied and every alert and notice POSTs to it,
 * so the request URL is rebuilt from the constant `https://hooks.slack.com/`
 * plus the validated path: no value can send the request to another host.
 */
export function slackWebhookEndpoint(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'hooks.slack.com' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return null;
  }
  const match = SLACK_WEBHOOK_PATH.exec(parsed.pathname);
  if (!match) return null;
  // Encode each segment: a no-op for the characters the regex allows, but it
  // is what static analysis (CodeQL js/request-forgery) recognises as making
  // the path safe to put in a request URL.
  const path = match[2].split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return match[1] === 'services'
    ? `https://hooks.slack.com/services/${path}`
    : `https://hooks.slack.com/workflows/${path}`;
}

export const INVALID_SLACK_WEBHOOK_MESSAGE =
  'Invalid Slack webhook URL. Must be https://hooks.slack.com/services/... or https://hooks.slack.com/workflows/...';

function requireSlackEndpoint(url: string): string {
  const endpoint = slackWebhookEndpoint(url);
  if (!endpoint) throw new Error(INVALID_SLACK_WEBHOOK_MESSAGE);
  return endpoint;
}

// ---------------------------------------------------------------------------
// Slack Block Kit builder
// ---------------------------------------------------------------------------

function formatMetricLine(m: MetricStatus, breached: boolean): string {
  const icon = breached ? '\u2717' : '\u2713';
  const dirLabel = m.direction === 'below' ? '<' : '>';
  return `${icon}  *${m.metric}:*  ${m.current}${m.unit}  (threshold: ${dirLabel} ${m.threshold}${m.unit})`;
}

function buildSummaryText(data: AlertData): string {
  return data.breaches.map((b) => `${b.metric} ${b.direction} threshold`).join(', ');
}

export function buildSlackBlocks(data: AlertData): object[] {
  const summary = buildSummaryText(data);

  const metricLines = [
    ...data.breaches.map((m) => formatMetricLine(m, true)),
    ...(data.passing ?? []).map((m) => formatMetricLine(m, false)),
  ].join('\n');

  return [
    // 1. Header
    {
      type: 'header',
      text: { type: 'plain_text', text: 'ProjectAchilles Alert', emoji: true },
    },
    // 2. Summary section
    {
      type: 'section',
      text: { type: 'mrkdwn', text: summary },
    },
    // 3. Divider
    { type: 'divider' },
    // 4. Metrics section
    {
      type: 'section',
      text: { type: 'mrkdwn', text: metricLines },
    },
    // 5. Divider
    { type: 'divider' },
    // 6. Context block
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `*Triggered by:* ${data.triggerTest}` },
        { type: 'mrkdwn', text: `*Agent:* ${data.triggerAgent}` },
      ],
    },
    // 7. Actions block
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Dashboard', emoji: true },
          url: data.dashboardUrl,
          style: 'primary',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Send Slack alert via webhook
// ---------------------------------------------------------------------------

export async function sendSlackAlert(
  webhookUrl: string,
  data: AlertData,
): Promise<void> {
  const blocks = buildSlackBlocks(data);
  const summary = buildSummaryText(data);

  const body = JSON.stringify({
    text: `ProjectAchilles Alert: ${summary}`,
    blocks,
  });

  const response = await fetch(requireSlackEndpoint(webhookUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Slack webhook failed with status ${response.status}: ${responseBody}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Send plain text via webhook
// ---------------------------------------------------------------------------

export async function sendSlackText(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(requireSlackEndpoint(webhookUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    redirect: 'error',
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Slack webhook failed with status ${response.status}: ${responseBody}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Test webhook connectivity
// ---------------------------------------------------------------------------

export async function testSlackWebhook(
  webhookUrl: string,
): Promise<{ success: boolean; message: string }> {
  const endpoint = slackWebhookEndpoint(webhookUrl);
  if (!endpoint) return { success: false, message: INVALID_SLACK_WEBHOOK_MESSAGE };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'ProjectAchilles alert test \u2014 Slack integration is working!',
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      return {
        success: false,
        message: `Slack webhook returned status ${response.status}: ${responseBody}`,
      };
    }

    return { success: true, message: 'Test message sent to Slack successfully' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message: `Slack webhook failed: ${message}` };
  }
}
