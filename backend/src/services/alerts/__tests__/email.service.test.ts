import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmailAlertSettings } from '../../../types/integrations.js';
import type { AlertEmailData, MetricStatus } from '../email.service.js';

// ---------------------------------------------------------------------------
// Mock nodemailer
// ---------------------------------------------------------------------------

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
const mockVerify = vi.fn().mockResolvedValue(true);

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      verify: mockVerify,
    })),
  },
}));

// Dynamic import AFTER mock setup (required by vitest)
const { buildAlertEmailHtml, sendEmailAlert, testEmailConnection } = await import(
  '../email.service.js'
);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<EmailAlertSettings> = {}): EmailAlertSettings {
  return {
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: 'user@example.com',
    smtp_pass: 's3cret',
    from_address: 'ProjectAchilles <alerts@example.com>',
    recipients: ['admin@example.com'],
    configured: true,
    enabled: true,
    ...overrides,
  };
}

const breachMetric: MetricStatus = {
  metric: 'Defense Score',
  current: 55,
  threshold: 70,
  unit: '%',
  direction: 'below',
};

const passingMetric: MetricStatus = {
  metric: 'Error Rate',
  current: 5,
  threshold: 20,
  unit: '%',
  direction: 'above',
};

const baseEmailData: AlertEmailData = {
  breaches: [breachMetric],
  triggerTest: 'T1059.001 - PowerShell',
  triggerAgent: 'WORKSTATION-42',
  dashboardUrl: 'https://app.example.com/analytics',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('email.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- buildAlertEmailHtml ------------------------------------------------

  describe('buildAlertEmailHtml', () => {
    it('includes breached metric name, current value, and threshold in HTML', () => {
      const html = buildAlertEmailHtml(baseEmailData);

      expect(html).toContain('Defense Score');
      expect(html).toContain('55%');
      expect(html).toContain('70%');
      // The red cross icon for breached
      expect(html).toContain('\u2717');
    });

    it('prints what a metric is based on under its name', () => {
      const html = buildAlertEmailHtml({
        ...baseEmailData,
        breaches: [{ ...breachMetric, detail: 'latest result per test and host, last 30 days' }],
      });
      expect(html).toContain('latest result per test and host, last 30 days');
    });

    it('includes passing metrics when provided', () => {
      const html = buildAlertEmailHtml({
        ...baseEmailData,
        passing: [passingMetric],
      });

      expect(html).toContain('Error Rate');
      expect(html).toContain('5%');
      expect(html).toContain('20%');
      // The green check icon for passing
      expect(html).toContain('\u2713');
    });

    it('includes trigger test and agent', () => {
      const html = buildAlertEmailHtml(baseEmailData);

      expect(html).toContain('T1059.001 - PowerShell');
      expect(html).toContain('WORKSTATION-42');
    });

    it('includes dashboard URL in the link', () => {
      const html = buildAlertEmailHtml(baseEmailData);

      expect(html).toContain('https://app.example.com/analytics');
      expect(html).toContain('View Dashboard');
    });
  });

  // ---- sendEmailAlert -----------------------------------------------------

  describe('sendEmailAlert', () => {
    it('calls sendMail with correct from, to (comma-joined), and subject', async () => {
      const settings = makeSettings();
      await sendEmailAlert(settings, {
        subject: 'Alert: Defense Score below threshold',
        html: '<p>test</p>',
      });

      expect(mockSendMail).toHaveBeenCalledOnce();
      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'ProjectAchilles <alerts@example.com>',
        to: 'admin@example.com',
        subject: 'Alert: Defense Score below threshold',
        html: '<p>test</p>',
      });
    });

    it('handles multiple recipients by joining with comma', async () => {
      const settings = makeSettings({
        recipients: ['admin@example.com', 'security@example.com', 'ops@example.com'],
      });
      await sendEmailAlert(settings, {
        subject: 'Multi-recipient alert',
        html: '<p>test</p>',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com, security@example.com, ops@example.com',
        }),
      );
    });
  });

  // ---- testEmailConnection ------------------------------------------------

  describe('testEmailConnection', () => {
    it('returns success when verify passes', async () => {
      mockVerify.mockResolvedValueOnce(true);
      const result = await testEmailConnection(makeSettings());

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified successfully');
    });

    it('returns failure with error message when verify rejects', async () => {
      mockVerify.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await testEmailConnection(makeSettings());

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection refused');
    });
  });
});

describe('sendMail', () => {
  it('normalises accepted/rejected entries to lowercase addresses and passes attachments', async () => {
    const { sendMail } = await import('../email.service.js');
    mockSendMail.mockResolvedValueOnce({
      accepted: [{ address: 'A@x.com', name: '' }],
      rejected: ['B@X.com'],
    });
    const attachments = [{ filename: 'h.csv', content: 'a,b', contentType: 'text/csv' }];
    const res = await sendMail(makeSettings(), {
      to: ['A@x.com', 'B@x.com'],
      subject: 's',
      html: '<p>h</p>',
      attachments,
    });
    expect(res).toEqual({ accepted: ['a@x.com'], rejected: ['b@x.com'] });
    const arg = mockSendMail.mock.calls.at(-1)![0];
    expect(arg.attachments).toEqual(attachments);
    expect(arg.to).toBe('A@x.com, B@x.com');
  });

  it('bounds SMTP time with connection, greeting and socket timeouts', async () => {
    const { sendMail } = await import('../email.service.js');
    const nodemailer = (await import('nodemailer')).default;
    mockSendMail.mockResolvedValueOnce({ accepted: ['a@x.com'], rejected: [] });
    await sendMail(makeSettings(), { to: ['a@x.com'], subject: 's', html: 'h' });
    expect(vi.mocked(nodemailer.createTransport).mock.calls.at(-1)![0]).toMatchObject({
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    });
  });

  it('tolerates missing accepted/rejected lists', async () => {
    const { sendMail } = await import('../email.service.js');
    mockSendMail.mockResolvedValueOnce({ messageId: 'x' });
    const res = await sendMail(makeSettings(), { to: ['a@x.com'], subject: 's', html: 'h' });
    expect(res).toEqual({ accepted: [], rejected: [] });
  });
});
