import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api/notices', () => ({
  noticesApi: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    sendTest: vi.fn(),
    listPending: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn(),
  },
}));

import { noticesApi } from '@/services/api/notices';
import { PreExecutionNoticesConfig } from '../PreExecutionNoticesConfig';

const base = {
  enabled: false,
  recipients: [] as string[],
  lead_minutes: 5,
  max_wait_minutes: 60,
  pickup_window_minutes: 120,
  send_finished: true,
  advance_digest_enabled: false,
  digest_timezone: 'UTC',
  smtp_configured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(noticesApi.getStatus).mockResolvedValue({
    pendingOverdue: 0,
    notDeliveredLast7d: 0,
    smtpCheck: { ok: null, at: null, message: null },
    digests: [],
  });
});

describe('PreExecutionNoticesConfig', () => {
  it('disables the toggle with a hint when SMTP is not configured', async () => {
    vi.mocked(noticesApi.getSettings).mockResolvedValue({ ...base, smtp_configured: false });
    render(<PreExecutionNoticesConfig />);
    expect(await screen.findByText('Configure SMTP email in Alerts first')).toBeInTheDocument();
    expect(screen.getByLabelText(/enable pre-execution notices/i)).toBeDisabled();
  });

  it('enables the toggle when SMTP is configured', async () => {
    vi.mocked(noticesApi.getSettings).mockResolvedValue(base);
    render(<PreExecutionNoticesConfig />);
    await screen.findByLabelText(/enable pre-execution notices/i);
    expect(screen.getByLabelText(/enable pre-execution notices/i)).toBeEnabled();
    expect(screen.queryByText('Configure SMTP email in Alerts first')).not.toBeInTheDocument();
  });

  it('saves parsed recipients and shows server 400 messages', async () => {
    vi.mocked(noticesApi.getSettings).mockResolvedValue(base);
    vi.mocked(noticesApi.saveSettings).mockRejectedValue(new Error('At least one recipient is required'));
    render(<PreExecutionNoticesConfig />);
    const box = await screen.findByLabelText(/recipients/i);
    await userEvent.type(box, 'a@x.io, b@x.io{Enter}c@x.io');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(noticesApi.saveSettings).toHaveBeenCalled());
    expect(vi.mocked(noticesApi.saveSettings).mock.calls[0][0].recipients).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
    expect(await screen.findByText('At least one recipient is required')).toBeInTheDocument();
  });

  it('omits a cleared numeric field from the save instead of sending 0', async () => {
    vi.mocked(noticesApi.getSettings).mockResolvedValue({ ...base, recipients: ['a@x.io'] });
    vi.mocked(noticesApi.saveSettings).mockResolvedValue({ ...base, recipients: ['a@x.io'] });
    render(<PreExecutionNoticesConfig />);
    await userEvent.clear(await screen.findByLabelText(/lead time/i));
    await userEvent.clear(screen.getByLabelText(/pickup window/i));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(noticesApi.saveSettings).toHaveBeenCalled());
    const body = vi.mocked(noticesApi.saveSettings).mock.calls[0][0];
    expect(body).not.toHaveProperty('lead_minutes');
    expect(body).not.toHaveProperty('pickup_window_minutes');
    expect(body.max_wait_minutes).toBe(60);
  });

  it('shows accepted/rejected after sending a test notice', async () => {
    vi.mocked(noticesApi.getSettings).mockResolvedValue({ ...base, recipients: ['a@x.io'] });
    vi.mocked(noticesApi.sendTest).mockResolvedValue({
      accepted: ['a@x.io'],
      rejected: ['b@x.io'],
      fully_accepted: false,
    });
    render(<PreExecutionNoticesConfig />);
    await userEvent.click(await screen.findByRole('button', { name: /send test notice/i }));
    expect(await screen.findByText(/accepted: a@x\.io/i)).toBeInTheDocument();
    expect(screen.getByText(/rejected: b@x\.io/i)).toBeInTheDocument();
  });

  it('shows the last SMTP check line', async () => {
    vi.mocked(noticesApi.getSettings).mockResolvedValue({
      ...base,
      last_smtp_check_at: '2026-10-23T10:00:00.000Z',
      last_smtp_check_ok: false,
      last_smtp_check_message: 'connection refused',
    });
    render(<PreExecutionNoticesConfig />);
    expect(await screen.findByText(/connection refused/)).toBeInTheDocument();
  });

  describe('advance digest', () => {
    const digestLabel = /send a daily advance digest/i;

    it('is unchecked from settings and disabled while notices are off', async () => {
      vi.mocked(noticesApi.getSettings).mockResolvedValue(base);
      render(<PreExecutionNoticesConfig />);
      const box = await screen.findByLabelText(digestLabel);
      expect(box).not.toBeChecked();
      expect(box).toBeDisabled();
      expect(screen.getByText('Turn on pre-execution notices to use the digest.')).toBeInTheDocument();
    });

    it('pre-fills the browser timezone on first enable and saves it', async () => {
      const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
        () => ({ resolvedOptions: () => ({ timeZone: 'America/Santo_Domingo' }) }) as unknown as Intl.DateTimeFormat,
      );
      vi.mocked(noticesApi.getSettings).mockResolvedValue({ ...base, enabled: true, recipients: ['a@x.io'] });
      vi.mocked(noticesApi.saveSettings).mockResolvedValue({ ...base, enabled: true, recipients: ['a@x.io'] });
      render(<PreExecutionNoticesConfig />);
      await userEvent.click(await screen.findByLabelText(digestLabel));
      expect(screen.getByLabelText(/digest timezone/i)).toHaveValue('America/Santo_Domingo');
      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(noticesApi.saveSettings).toHaveBeenCalled());
      const body = vi.mocked(noticesApi.saveSettings).mock.calls[0][0];
      expect(body.advance_digest_enabled).toBe(true);
      expect(body.digest_timezone).toBe('America/Santo_Domingo');
      spy.mockRestore();
    });

    it('shows the failed digest line', async () => {
      vi.mocked(noticesApi.getSettings).mockResolvedValue(base);
      vi.mocked(noticesApi.getStatus).mockResolvedValue({
        pendingOverdue: 0,
        notDeliveredLast7d: 0,
        smtpCheck: { ok: null, at: null, message: null },
        digests: [
          {
            orgId: 'org_1', digestDate: '2026-10-27', runDate: '2026-10-28', state: 'failed',
            occurrenceCount: 0, hostCount: 0, recipientCount: 0, sentAt: null,
            lastError: 'SMTP email is not configured',
          },
        ],
      });
      render(<PreExecutionNoticesConfig />);
      expect(
        await screen.findByText('Last digest 2026-10-27: not sent (SMTP email is not configured)'),
      ).toBeInTheDocument();
    });

    it('shows the rejected recipients on a sent digest line, with singular counts', async () => {
      vi.mocked(noticesApi.getSettings).mockResolvedValue({ ...base, enabled: true, advance_digest_enabled: true });
      vi.mocked(noticesApi.getStatus).mockResolvedValue({
        pendingOverdue: 0,
        notDeliveredLast7d: 0,
        smtpCheck: { ok: null, at: null, message: null },
        digests: [
          {
            orgId: 'org_1', digestDate: '2026-10-27', runDate: '2026-10-28', state: 'sent',
            occurrenceCount: 1, hostCount: 1, recipientCount: 1, sentAt: '2026-10-27T13:00:00.000Z',
            lastError: 'rejected: b@x.com',
          },
        ],
      });
      render(<PreExecutionNoticesConfig />);
      expect(
        await screen.findByText(
          'Last digest 2026-10-27: sent to 1 recipient (1 run on 1 host) — rejected: b@x.com',
        ),
      ).toBeInTheDocument();
    });

    it('offers the browser timezone after a different zone was saved, and keeps a deliberate pick', async () => {
      const original = Object.getOwnPropertyDescriptor(Intl, 'supportedValuesOf');
      const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
        () => ({ resolvedOptions: () => ({ timeZone: 'America/Santo_Domingo' }) }) as unknown as Intl.DateTimeFormat,
      );
      Object.defineProperty(Intl, 'supportedValuesOf', { value: undefined, configurable: true, writable: true });
      try {
        vi.mocked(noticesApi.getSettings).mockResolvedValue({
          ...base, enabled: true, advance_digest_enabled: false, digest_timezone: 'UTC',
        });
        render(<PreExecutionNoticesConfig />);
        const box = await screen.findByLabelText(digestLabel);
        await userEvent.click(box); // prefill the browser zone
        const select = screen.getByLabelText(/digest timezone/i);
        expect(select).toHaveValue('America/Santo_Domingo');
        await userEvent.selectOptions(select, 'Europe/Berlin');
        await userEvent.click(box); // off
        await userEvent.click(box); // on again
        expect(screen.getByLabelText(/digest timezone/i)).toHaveValue('Europe/Berlin');
        // browser zone is still selectable while another zone is current
        await userEvent.selectOptions(screen.getByLabelText(/digest timezone/i), 'America/Santo_Domingo');
        expect(screen.getByLabelText(/digest timezone/i)).toHaveValue('America/Santo_Domingo');
      } finally {
        spy.mockRestore();
        if (original) Object.defineProperty(Intl, 'supportedValuesOf', original);
        else delete (Intl as { supportedValuesOf?: unknown }).supportedValuesOf;
      }
    });
  });
});
