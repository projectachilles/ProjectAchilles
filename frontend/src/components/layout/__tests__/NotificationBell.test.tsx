import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from '../NotificationBell';

// Mock the alerts API
vi.mock('@/services/api/alerts', () => ({
  alertsApi: {
    getAlertSettings: vi.fn(),
    getAlertHistory: vi.fn(),
  },
}));

import { alertsApi } from '@/services/api/alerts';
const mockGetAlertSettings = vi.mocked(alertsApi.getAlertSettings);
const mockGetAlertHistory = vi.mocked(alertsApi.getAlertHistory);

// Stub localStorage (jsdom may not provide a fully functional one)
const localStorageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(localStorageStore)) delete localStorageStore[k]; }),
  get length() { return Object.keys(localStorageStore).length; },
  key: vi.fn((i: number) => Object.keys(localStorageStore)[i] ?? null),
};
vi.stubGlobal('localStorage', mockLocalStorage);

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(localStorageStore)) delete localStorageStore[k];
  mockGetAlertSettings.mockResolvedValue({ configured: false });
  mockGetAlertHistory.mockResolvedValue([]);
});

describe('NotificationBell', () => {
  it('renders a button with Notifications label', async () => {
    renderBell();
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    // Wait for mount effect to settle to avoid act() warning
    await waitFor(() => {
      expect(mockGetAlertSettings).toHaveBeenCalled();
    });
  });

  it('shows "not configured" message when alerting is not configured', async () => {
    mockGetAlertSettings.mockResolvedValue({ configured: false });
    renderBell();

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => {
      expect(screen.getByText(/alerts not configured/i)).toBeInTheDocument();
    });
  });

  it('shows "no recent alerts" when configured but no history', async () => {
    mockGetAlertSettings.mockResolvedValue({
      configured: true,
      thresholds: { enabled: true },
    });
    mockGetAlertHistory.mockResolvedValue([]);
    renderBell();

    // Wait for mount fetch
    await waitFor(() => {
      expect(mockGetAlertSettings).toHaveBeenCalled();
    });

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => {
      expect(screen.getByText(/no recent alerts/i)).toBeInTheDocument();
    });
  });

  it('displays alert items when history exists', async () => {
    mockGetAlertSettings.mockResolvedValue({
      configured: true,
      thresholds: { enabled: true },
      last_alert_at: '2026-02-28T10:00:00Z',
    });
    mockGetAlertHistory.mockResolvedValue([
      {
        timestamp: '2026-02-28T10:00:00Z',
        breaches: [
          { metric: 'Defense Score', current: 45, threshold: 70, unit: '%', direction: 'below' as const },
        ],
        channels: { slack: true, email: false },
        triggerTest: 'T1059',
        triggerAgent: 'WORKSTATION-01',
      },
    ]);
    renderBell();

    await waitFor(() => {
      expect(mockGetAlertSettings).toHaveBeenCalled();
    });

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => {
      expect(screen.getByText(/defense score/i)).toBeInTheDocument();
      expect(screen.getByText(/45%/)).toBeInTheDocument();
    });
  });

  it('shows red dot when unseen alerts exist', async () => {
    // No lastSeen in localStorage, but server has last_alert_at
    mockGetAlertSettings.mockResolvedValue({
      configured: true,
      thresholds: { enabled: true },
      last_alert_at: '2026-02-28T10:00:00Z',
    });
    renderBell();

    await waitFor(() => {
      expect(document.querySelector('[data-testid="unseen-dot"]')).toBeInTheDocument();
    });
  });

  it('clears red dot after opening dropdown', async () => {
    mockGetAlertSettings.mockResolvedValue({
      configured: true,
      thresholds: { enabled: true },
      last_alert_at: '2026-02-28T10:00:00Z',
    });
    mockGetAlertHistory.mockResolvedValue([
      {
        timestamp: '2026-02-28T10:00:00Z',
        breaches: [
          { metric: 'Defense Score', current: 45, threshold: 70, unit: '%', direction: 'below' as const },
        ],
        channels: { slack: true, email: false },
        triggerTest: 'T1059',
        triggerAgent: 'WORKSTATION-01',
      },
    ]);
    renderBell();

    await waitFor(() => {
      expect(document.querySelector('[data-testid="unseen-dot"]')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => {
      expect(document.querySelector('[data-testid="unseen-dot"]')).not.toBeInTheDocument();
    });
  });

  it('shows link to settings when not configured', async () => {
    mockGetAlertSettings.mockResolvedValue({ configured: false });
    renderBell();

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => {
      expect(screen.getByText(/set up in settings/i)).toBeInTheDocument();
    });
  });

  it('fetches history only on dropdown open, not on mount', async () => {
    mockGetAlertSettings.mockResolvedValue({
      configured: true,
      thresholds: { enabled: true },
    });
    renderBell();

    await waitFor(() => {
      expect(mockGetAlertSettings).toHaveBeenCalled();
    });

    // History should NOT have been called yet
    expect(mockGetAlertHistory).not.toHaveBeenCalled();

    // Open dropdown
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => {
      expect(mockGetAlertHistory).toHaveBeenCalledOnce();
    });
  });
});
