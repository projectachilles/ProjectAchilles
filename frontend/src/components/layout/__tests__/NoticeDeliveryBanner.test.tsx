import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const caps = vi.hoisted(() => ({ preExecutionNotices: true }));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ preExecutionNotices: caps.preExecutionNotices }),
}));
vi.mock('@/services/api/notices', () => ({
  noticesApi: { getStatus: vi.fn() },
}));

import { noticesApi } from '@/services/api/notices';
import { NoticeDeliveryBanner } from '../NoticeDeliveryBanner';

const getStatus = vi.mocked(noticesApi.getStatus);
const status = (over: Record<string, unknown> = {}) => ({
  pendingOverdue: 0,
  notDeliveredLast7d: 0,
  smtpCheck: { ok: true, at: null, message: null },
  digests: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  caps.preExecutionNotices = true;
  try { sessionStorage.clear(); } catch { /* ignore */ }
});

describe('NoticeDeliveryBanner', () => {
  it('does not poll or render when the capability is false', async () => {
    caps.preExecutionNotices = false;
    render(<NoticeDeliveryBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(getStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is hidden when everything is healthy', async () => {
    getStatus.mockResolvedValue(status());
    render(<NoticeDeliveryBanner />);
    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('describes a failed daily SMTP check when that is the only problem', async () => {
    getStatus.mockResolvedValue(status({ smtpCheck: { ok: false, at: 'x', message: 'bad' } }));
    render(<NoticeDeliveryBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The daily notice email check failed. Check Settings → Integrations → Pre-execution notices.',
    );
  });

  it.each([
    ['pendingOverdue', { pendingOverdue: 2 }],
    ['notDeliveredLast7d', { notDeliveredLast7d: 1 }],
    ['notDelivered and smtp failing', { notDeliveredLast7d: 1, smtpCheck: { ok: false, at: 'x', message: 'bad' } }],
  ])('shows when %s', async (_n, over) => {
    getStatus.mockResolvedValue(status(over));
    render(<NoticeDeliveryBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Test runs are waiting on, or were skipped for, notice email delivery. Check Settings → Integrations → Pre-execution notices.',
    );
  });

  it('hides after dismiss', async () => {
    getStatus.mockResolvedValue(status({ pendingOverdue: 1 }));
    render(<NoticeDeliveryBanner />);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays hidden on remount once dismissed this session', async () => {
    getStatus.mockResolvedValue(status({ pendingOverdue: 1 }));
    const { unmount } = render(<NoticeDeliveryBanner />);
    await userEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
    unmount();
    render(<NoticeDeliveryBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
