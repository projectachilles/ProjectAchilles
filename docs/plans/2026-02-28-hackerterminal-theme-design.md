# Hacker Terminal Theme Design

**Date:** 2026-02-28
**Status:** Approved

## Overview

Add a "hacker terminal" visual style as a third selectable theme alongside default and neobrutalism. This theme delivers a green phosphor CRT aesthetic — monospace font, phosphor green on deep black, subtle text glow — without animated effects. It forces dark mode when active.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Immersion level | Moderate | Green colors, monospace font, text glow — no animated scanlines or flicker. Usable for a real dashboard |
| Light mode | Dark only | Terminals don't have light mode. Forces `.dark` class when active; restores user preference on switch away |
| UI picker | Cycle button | Single header button cycles: default → neobrutalism → hackerterminal → default. Icon changes per style |

## Architecture

### Theme System Extension

`ThemeStyle` union becomes `'default' | 'neobrutalism' | 'hackerterminal'`. The `toggleThemeStyle` cycles through all three. A new `useEffect` in `useTheme.tsx` forces `.dark` when `hackerterminal` is active and restores the previous light/dark preference when switching away.

**Class on `<html>`:** `.hackerterminal` (independent of `.dark`, but `.dark` is always co-present)

### CSS Variables — `.hackerterminal`

All surfaces use the oklch green axis (hue ~142-145):

```css
.hackerterminal {
  /* Structural overrides */
  --theme-border-width: 1px;
  --theme-border-radius: 2px;
  --theme-shadow: 0 0 8px oklch(0.75 0.27 142 / 25%);
  --theme-hover-translate: 0px;
  --theme-hover-shadow: 0 0 12px oklch(0.75 0.27 142 / 40%);
  --theme-font-body: 'JetBrains Mono', ui-monospace, monospace;
  --theme-font-weight-base: 400;
  --theme-font-weight-heading: 500;

  /* Color overrides (dark only) */
  --background: oklch(0.10 0.02 145);
  --foreground: oklch(0.85 0.25 142);
  --card: oklch(0.14 0.03 145);
  --card-foreground: oklch(0.85 0.25 142);
  --popover: oklch(0.14 0.03 145);
  --popover-foreground: oklch(0.85 0.25 142);
  --primary: oklch(0.75 0.27 142);
  --primary-foreground: oklch(0.10 0.02 145);
  --secondary: oklch(0.18 0.04 145);
  --secondary-foreground: oklch(0.85 0.25 142);
  --muted: oklch(0.16 0.03 145);
  --muted-foreground: oklch(0.50 0.12 145);
  --accent: oklch(0.75 0.27 142);
  --accent-foreground: oklch(0.10 0.02 145);
  --destructive: oklch(0.65 0.22 25);
  --border: oklch(0.35 0.10 142);
  --input: oklch(0.08 0.02 145);
  --ring: oklch(0.75 0.27 142);

  /* Sidebar */
  --sidebar: oklch(0.08 0.02 145);
  --sidebar-foreground: oklch(0.85 0.25 142);
  --sidebar-primary: oklch(0.75 0.27 142);
  --sidebar-primary-foreground: oklch(0.10 0.02 145);
  --sidebar-accent: oklch(0.18 0.04 145);
  --sidebar-accent-foreground: oklch(0.85 0.25 142);
  --sidebar-border: oklch(0.35 0.10 142);
  --sidebar-ring: oklch(0.75 0.27 142);
}
```

### Text Glow

```css
.hackerterminal body {
  text-shadow: 0 0 3px oklch(0.75 0.27 142 / 40%);
}
```

### Typography

Uses JetBrains Mono (already imported in `index.css` for the hero page). Weight 400 base, 500 headings.

### Dark Mode Forcing

When `themeStyle === 'hackerterminal'`:
1. Save current `theme` to a ref
2. Force `theme` to `'dark'`
3. Add `.hackerterminal` to `<html>`
4. On switch away: restore saved theme preference

### UI Toggle (3-way cycler)

| Active style | Icon | Appearance |
|-------------|------|------------|
| default | `Palette` | Normal color |
| neobrutalism | `Palette` | Highlighted primary |
| hackerterminal | `Terminal` | Highlighted green |

`toggleThemeStyle` cycles: `default → neobrutalism → hackerterminal → default`

### No-Touch Zones

- Hero page — cyberpunk aesthetic unchanged
- Chart semantic colors — red/green for bypassed/protected stay distinct

## Files to Modify

1. `frontend/src/hooks/useTheme.tsx` — extend ThemeStyle, 3-way cycle, dark mode forcing
2. `frontend/src/styles/index.css` — `.hackerterminal` CSS variables + text glow
3. `frontend/src/components/shared/UnifiedHeader.tsx` — 3-way cycle button with Terminal icon
4. `frontend/src/components/shared/TopBar.tsx` — same toggle update (if it has one)

No component-level changes needed — the CSS variable cascade from neobrutalism already made all components theme-aware (`border-theme`, `rounded-base`, `shadow-theme`).

## Sources

- [CSS-Tricks: Old Timey Terminal Styling](https://css-tricks.com/old-timey-terminal-styling/)
- [DEV.to: Retro CRT Terminal Screen in CSS + JS](https://dev.to/ekeijl/retro-crt-terminal-screen-in-css-js-4afh)
- [Hacker Color Palette](https://www.color-hex.com/color-palette/82551)
- [Grokipedia: Classic Hacker Terminal Aesthetic](https://grokipedia.com/page/Classic_Hacker_Terminal_Aesthetic)
