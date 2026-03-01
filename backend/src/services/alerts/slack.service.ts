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

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
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
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'ProjectAchilles alert test \u2014 Slack integration is working!',
      }),
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
