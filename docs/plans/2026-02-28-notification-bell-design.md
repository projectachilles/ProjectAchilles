# Notification Bell Dropdown — Design Document

**Date:** 2026-02-28
**Depends on:** Trend Alerting (implemented same day)

---

## Overview

Wire the existing placeholder bell icon in the TopBar to a dropdown that shows recent threshold alerts from the trend alerting system. Fetches alert history on click, shows a red dot badge when unseen alerts exist, and provides a helpful empty state when alerting isn't configured.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component structure | Separate `NotificationBell.tsx` | TopBar already 185 lines; keeps concerns separated and independently testable |
| Data fetch strategy | Fetch on click only | Zero polling overhead; alert history is low-frequency operational data |
| Unseen indicator | Red dot (no count) | Simple, no server-side "read" tracking needed; `localStorage` tracks last seen timestamp |
| Not-configured state | Show "Alerts not configured" + link | Bell always visible; guides user to Settings → Integrations |
| Configuration detection | `getAlertSettings()` on mount | Lightweight call; also seeds initial `hasUnseen` from `last_alert_at` |
| Max items shown | 5 | Keeps dropdown compact; footer link goes to full history in Settings |

## Component

**File:** `frontend/src/components/layout/NotificationBell.tsx`

### State

| State | Type | Source |
|-------|------|--------|
| `configured` | `boolean` | `alertsApi.getAlertSettings()` on mount |
| `alerts` | `AlertHistoryItem[]` | `alertsApi.getAlertHistory()` on dropdown open |
| `loading` | `boolean` | True during fetch |
| `hasUnseen` | `boolean` | Compares latest alert timestamp vs `localStorage('achilles:lastSeenAlert')` |

### Behavior

1. **On mount:** Call `getAlertSettings()` → set `configured`. Compare `last_alert_at` against `localStorage` → set initial `hasUnseen`.
2. **On dropdown open:** Call `getAlertHistory()` → populate alerts. Update `localStorage` with latest timestamp. Clear `hasUnseen`.
3. **Red dot badge:** 8x8px `bg-destructive` circle, absolute-positioned top-right of bell button. Rendered only when `hasUnseen === true`.

### UI Layout

```
┌──────────────────────────────────┐
│  Notifications             ──── │  Label + separator
├──────────────────────────────────┤
│  ⚠ Defense Score below 70%      │  Alert item
│  45% (threshold: 70%)           │
│  Slack ✓  Email ✓    12 min ago │
├──────────────────────────────────┤
│  ⚠ Error Rate above 20%        │
│  28% (threshold: 20%)           │
│  Slack ✓  Email ✗     2 hr ago  │
├──────────────────────────────────┤
│  View all alerts →              │  Footer link → Settings
└──────────────────────────────────┘
```

Width: 320px (`w-80`), right-aligned (`align="end"`).

### States

| State | Display |
|-------|---------|
| Loading | Centered spinner |
| Not configured | Bell icon + "Alerts not configured" + Settings link |
| Configured, no alerts | "No recent alerts" message |
| Configured, with alerts | Up to 5 items + "View all alerts" footer |

### Styling

Uses existing DropdownMenu component (Radix UI) with project theme tokens: `bg-popover`, `border-theme`, `shadow-theme`, `rounded-base`. Automatically adapts to default / neobrutalism / hacker-terminal themes.

## Integration

Replace `TopBar.tsx` lines 124-128 (placeholder bell button) with `<NotificationBell />`. No props needed — component is self-contained.

## Files Changed

| File | Action |
|------|--------|
| `frontend/src/components/layout/NotificationBell.tsx` | Create |
| `frontend/src/components/layout/TopBar.tsx` | Modify (swap bell button for component) |

## Backend Changes

None. Uses existing `GET /api/integrations/alerts` and `GET /api/integrations/alerts/history` endpoints.
