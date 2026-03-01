# Notification Bell Dropdown — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the TopBar bell icon to a dropdown showing recent threshold alerts with an unseen-indicator red dot.

**Architecture:** Self-contained `NotificationBell` component fetches alert settings on mount (configuration check + initial unseen detection) and alert history on dropdown open. Uses existing Radix `DropdownMenu` components. Tracks "last seen" timestamp in `localStorage`. Replaces the placeholder bell button in `TopBar.tsx`.

**Tech Stack:** React 19, Radix UI DropdownMenu, Lucide icons, existing `alertsApi` client, `localStorage`

---

### Task 1: Create NotificationBell component with tests

**Files:**
- Create: `frontend/src/components/layout/NotificationBell.tsx`
- Create: `frontend/src/components/layout/__tests__/NotificationBell.test.tsx`

**Step 1: Write the failing tests**

Create `frontend/src/components/layout/__tests__/NotificationBell.test.tsx`:

```tsx
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

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockGetAlertSettings.mockResolvedValue({ configured: false });
  mockGetAlertHistory.mockResolvedValue([]);
});

describe('NotificationBell', () => {
  it('renders a button with Notifications label', async () => {
    renderBell();
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
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
```

**Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest src/components/layout/__tests__/NotificationBell.test.tsx --run`
Expected: FAIL — `NotificationBell` module not found

**Step 3: Write the NotificationBell component**

Create `frontend/src/components/layout/NotificationBell.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { alertsApi } from '@/services/api/alerts';
import type { AlertHistoryItem } from '@/services/api/alerts';

const LAST_SEEN_KEY = 'achilles:lastSeenAlert';
const MAX_DISPLAY = 5;

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [alerts, setAlerts] = useState<AlertHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);

  // On mount: check if alerting is configured + seed hasUnseen
  useEffect(() => {
    let cancelled = false;
    alertsApi.getAlertSettings().then((settings) => {
      if (cancelled) return;
      setConfigured(settings.configured);
      if (settings.last_alert_at) {
        const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
        if (!lastSeen || new Date(settings.last_alert_at) > new Date(lastSeen)) {
          setHasUnseen(true);
        }
      }
    });
    return () => { cancelled = true; };
  }, []);

  // On dropdown open: fetch history, clear unseen
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open || !configured) return;

    setLoading(true);
    alertsApi.getAlertHistory().then((items) => {
      setAlerts(items.slice(0, MAX_DISPLAY));
      setLoading(false);

      // Update last seen
      if (items.length > 0) {
        localStorage.setItem(LAST_SEEN_KEY, items[0].timestamp);
      }
      setHasUnseen(false);
    });
  }, [configured]);

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="sr-only">Notifications</span>
          {hasUnseen && (
            <span
              data-testid="unseen-dot"
              className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive"
            />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Not configured state */}
        {configured === false && (
          <div className="px-3 py-4 text-center">
            <Bell className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Alerts not configured</p>
            <p className="text-xs text-muted-foreground mt-1">
              Set up in Settings → Integrations
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => navigate('/settings')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open Settings
            </Button>
          </div>
        )}

        {/* Loading state */}
        {configured && loading && (
          <div className="px-3 py-6 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* No alerts state */}
        {configured && !loading && alerts.length === 0 && (
          <div className="px-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">No recent alerts — all clear</p>
          </div>
        )}

        {/* Alert items */}
        {configured && !loading && alerts.map((alert, idx) => (
          <DropdownMenuItem key={`${alert.timestamp}-${idx}`} className="flex-col items-start gap-1 py-2 cursor-default">
            {alert.breaches.map((b) => (
              <div key={b.metric} className="w-full">
                <div className="flex items-center gap-1.5 text-sm font-medium text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {b.metric} {b.direction} {b.threshold}{b.unit}
                </div>
                <div className="text-xs text-muted-foreground ml-5">
                  {b.current}{b.unit} (threshold: {b.threshold}{b.unit})
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between w-full mt-1 ml-5">
              <div className="flex gap-2 text-xs">
                {alert.channels.slack && (
                  <span className="text-green-500">Slack ✓</span>
                )}
                {alert.channels.slack === false && (
                  <span className="text-muted-foreground">Slack ✗</span>
                )}
                {alert.channels.email && (
                  <span className="text-green-500">Email ✓</span>
                )}
                {alert.channels.email === false && (
                  <span className="text-muted-foreground">Email ✗</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(alert.timestamp)}
              </span>
            </div>
          </DropdownMenuItem>
        ))}

        {/* Footer */}
        {configured && !loading && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="justify-center text-xs text-muted-foreground cursor-pointer"
              onClick={() => navigate('/settings')}
            >
              View all alerts →
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest src/components/layout/__tests__/NotificationBell.test.tsx --run`
Expected: 7 tests PASS

**Step 5: Commit**

```bash
git add frontend/src/components/layout/NotificationBell.tsx frontend/src/components/layout/__tests__/NotificationBell.test.tsx
git commit -m "feat(frontend): add NotificationBell component with alert dropdown"
```

---

### Task 2: Wire NotificationBell into TopBar

**Files:**
- Modify: `frontend/src/components/layout/TopBar.tsx:6-10` (imports), `124-128` (bell button)

**Step 1: Update TopBar imports**

In `frontend/src/components/layout/TopBar.tsx`, add the import and remove `Bell` from lucide imports:

Replace lines 6-18:
```tsx
import {
  Menu,
  Moon,
  Sun,
  Bell,
  Search,
  RefreshCw,
  Settings,
  ChevronRight,
  Palette,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
```

With:
```tsx
import {
  Menu,
  Moon,
  Sun,
  Search,
  RefreshCw,
  Settings,
  ChevronRight,
  Palette,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/components/layout/NotificationBell';
```

**Step 2: Replace the bell button placeholder**

Replace lines 124-128:
```tsx
        {/* Notifications */}
        <Button variant="ghost" size="icon">
          <Bell className="h-4 w-4" />
          <span className="sr-only">Notifications</span>
        </Button>
```

With:
```tsx
        {/* Notifications */}
        <NotificationBell />
```

**Step 3: Run full frontend test suite**

Run: `cd frontend && npm test`
Expected: All tests pass (119 existing + 7 new = 126 tests)

**Step 4: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Clean build, no TypeScript errors

**Step 5: Commit**

```bash
git add frontend/src/components/layout/TopBar.tsx
git commit -m "feat(frontend): wire NotificationBell into TopBar, replacing placeholder"
```

---

### Task 3: Visual smoke test

**Step 1: Start the dev server**

Run: `./start.sh -k --daemon`

**Step 2: Open browser and verify**

Navigate to `http://localhost:5173`. Verify:
1. Bell icon visible in top-right navbar area
2. Clicking bell opens dropdown with "Alerts not configured" message (assuming no alerting set up)
3. "Open Settings" button navigates to `/settings`
4. Dropdown closes on click outside
5. No console errors

**Step 3: Verify build is clean**

Run: `cd frontend && npm run build && npm test`
Expected: Clean build, all 126 tests pass
