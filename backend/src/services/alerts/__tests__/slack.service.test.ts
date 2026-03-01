import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AlertData, MetricStatus } from '../slack.service.js';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  text: () => Promise.resolve('ok'),
});
vi.stubGlobal('fetch', mockFetch);

// Dynamic import AFTER mock setup (required by vitest)
const { buildSlackBlocks, sendSlackAlert, testSlackWebhook } = await import(
  '../slack.service.js'
);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const breachMetric: MetricStatus = {
  metric: 'Defense Score',
  current: 45,
  threshold: 70,
  unit: '%',
  direction: 'below',
};

const passingMetric: MetricStatus = {
  metric: 'Error Rate',
  current: 12,
  threshold: 20,
  unit: '%',
  direction: 'above',
};

const baseAlertData: AlertData = {
  breaches: [breachMetric],
  triggerTest: 'T1059.001 - PowerShell',
  triggerAgent: 'WORKSTATION-42',
  dashboardUrl: 'https://app.example.com/analytics',
};

const webhookUrl = 'https://hooks.slack.com/services/T000/B000/XXXX';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('slack.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    });
  });

  // ---- buildSlackBlocks ----------------------------------------------------

  describe('buildSlackBlocks', () => {
    it('returns array with header block containing "ProjectAchilles Alert"', () => {
      const blocks = buildSlackBlocks(baseAlertData) as { type: string; text?: { type: string; text: string } }[];

      expect(Array.isArray(blocks)).toBe(true);
      const header = blocks.find((b) => b.type === 'header');
      expect(header).toBeDefined();
      expect(header!.text!.text).toBe('ProjectAchilles Alert');
    });

    it('includes breach details (metric name, current value with unit, threshold)', () => {
      const blocks = buildSlackBlocks(baseAlertData);
      const json = JSON.stringify(blocks);

      expect(json).toContain('Defense Score');
      expect(json).toContain('45%');
      expect(json).toContain('70%');
      // Cross mark for breached
      expect(json).toContain('\u2717');
    });

    it('includes passing metrics when provided', () => {
      const blocks = buildSlackBlocks({
        ...baseAlertData,
        passing: [passingMetric],
      });
      const json = JSON.stringify(blocks);

      expect(json).toContain('Error Rate');
      expect(json).toContain('12%');
      expect(json).toContain('20%');
      // Check mark for passing
      expect(json).toContain('\u2713');
    });

    it('includes trigger test and agent in context block', () => {
      const blocks = buildSlackBlocks(baseAlertData) as { type: string; elements?: { type: string; text: string }[] }[];

      const context = blocks.find((b) => b.type === 'context');
      expect(context).toBeDefined();

      const contextText = context!.elements!.map((e) => e.text).join(' ');
      expect(contextText).toContain('T1059.001 - PowerShell');
      expect(contextText).toContain('WORKSTATION-42');
    });

    it('includes dashboard URL in actions button', () => {
      const blocks = buildSlackBlocks(baseAlertData) as {
        type: string;
        elements?: { type: string; text: { text: string }; url: string; style: string }[];
      }[];

      const actions = blocks.find((b) => b.type === 'actions');
      expect(actions).toBeDefined();

      const button = actions!.elements![0];
      expect(button.url).toBe('https://app.example.com/analytics');
      expect(button.text.text).toBe('View Dashboard');
      expect(button.style).toBe('primary');
    });
  });

  // ---- sendSlackAlert ------------------------------------------------------

  describe('sendSlackAlert', () => {
    it('POSTs to webhook URL with correct method, headers, and JSON body containing blocks', async () => {
      await sendSlackAlert(webhookUrl, baseAlertData);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(webhookUrl);
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(options.body as string);
      expect(body.blocks).toBeDefined();
      expect(Array.isArray(body.blocks)).toBe(true);
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('channel_not_found'),
      });

      await expect(sendSlackAlert(webhookUrl, baseAlertData)).rejects.toThrow(
        /404/,
      );
    });

    it('includes fallback text field in payload', async () => {
      await sendSlackAlert(webhookUrl, baseAlertData);

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);

      expect(body.text).toBeDefined();
      expect(body.text).toContain('ProjectAchilles Alert');
      expect(body.text).toContain('Defense Score');
    });
  });

  // ---- testSlackWebhook ----------------------------------------------------

  describe('testSlackWebhook', () => {
    it('returns success when webhook responds ok', async () => {
      const result = await testSlackWebhook(webhookUrl);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Test message sent to Slack successfully');
    });

    it('returns failure with message when webhook fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('invalid_token'),
      });

      const result = await testSlackWebhook(webhookUrl);

      expect(result.success).toBe(false);
      expect(result.message).toContain('403');
    });
  });
});
