# Handoff: Achilles Landing Page

## Overview

This is a complete redesign of the Achilles marketing landing page — a continuous security testing platform for European banks. The design positions Achilles as **enterprise BAS (Breach and Attack Simulation) without the enterprise price tag**, targeting CISOs, security architects, and compliance officers at mid-market financial institutions in the EU.

The page is **bilingual (English / Spanish)** with a runtime language toggle and includes three visual themes (Editorial, Tactical, Classical), three density modes, and a Tweaks panel for visual exploration.

---

## About the Design Files

The files in `source/` are **design references created in HTML/JSX** — a high-fidelity prototype demonstrating intended look, behavior, copy, and interaction. They use React 18 loaded from a CDN with in-browser Babel transpilation.

**Your job is not to ship this HTML directly.** Your job is to **recreate this design in the existing Fortika `frontend/` codebase** (React + TypeScript) using its established patterns: TSX components, Tailwind utility classes (or whatever the existing `HeroPage.tsx` uses), and the existing i18n helper.

The HTML prototype is the source of truth for **visual design, copy, layout, and animation** — but the implementation should match the conventions of the target codebase.

---

## Fidelity

**High-fidelity (hifi).** All colors, typography, spacing, copy, and interaction details are final. Recreate pixel-perfectly.

- Exact hex values, font stacks, border radii, and shadow values are specified in `source/styles.css` `:root`
- All copy is finalized in both EN and ES (see `source/i18n.js`)
- Animations have specific durations and easing curves (see Interactions section below)

---

## File Map

```
design_handoff_achilles_landing/
├── README.md                      ← you are here
├── INTEGRATION_PLAN.md            ← step-by-step plan for Claude Code
└── source/
    ├── Achilles Landing.html      ← entry point (just script tags)
    ├── app.jsx                    ← all React components (~720 lines)
    ├── i18n.js                    ← bilingual copy dictionary (window.COPY)
    ├── styles.css                 ← design tokens + all section styles (~1100 lines)
    ├── tweaks-panel.jsx           ← in-page tweaks UI (DEV ONLY — strip for prod)
    └── assets/
        ├── logo-achilles.svg      ← brand mark
        ├── Endpoint.webp          ← product screenshot — Endpoint module
        ├── Library.webp           ← product screenshot — Test Library
        └── Scoring.webp           ← product screenshot — Scoring engine
```

---

## Sections (Top → Bottom)

The page is composed of 9 sections, all rendered in `app.jsx`. Each `<section>` has a stable `id` for anchor links from the nav.

| # | id | Component | Purpose |
|---|----|-----------|---------|
| 1 | `top` | `Hero` | Above-fold pitch + live terminal demo |
| 2 | `problem` | `Problem` | Status quo pain points (4 stat cards) |
| 3 | `regulatory` | `Regulatory` | DORA / TIBER-EU / ISO 27001 / CIS / MITRE coverage |
| 4 | `features` | `Features` | 6-card platform capability grid |
| 5 | `how` | `HowItWorks` | 4-step pipeline with terminal transcripts |
| 6 | `mitre` | `MitreMatrix` | Interactive MITRE ATT&CK technique matrix |
| 7 | `compare` | `Compare` | Comparison table vs. enterprise BAS / pen testing |
| 8 | — | `Security` | "Security by design" callout (6 trust signals) |
| 9 | `demo` | `CTA` | Final call-to-action (book demo + sample report) |

Plus persistent chrome:
- `Nav` — sticky top nav with section anchors, EN/ES toggle, "Book a demo" button
- `Footer` — 4-column footer with logo, sitemap, legal, address

---

## Design Tokens

All tokens live in `source/styles.css` `:root`. Reproduce these in your design token system (Tailwind theme, CSS custom properties, or a `tokens.ts`).

### Colors — Brand
| Token | Hex | Usage |
|---|---|---|
| `--accent` | `#00e68a` | Primary green — CTAs, highlights, terminal "OK" lines |
| `--accent-bright` | `#00ffaa` | Hover/active state for accent |
| `--accent-dim` | `rgba(0, 230, 138, 0.5)` | Disabled/secondary accent |
| `--accent-glow` | `rgba(0, 230, 138, 0.35)` | Box shadows on accent elements |
| `--accent-subtle` | `rgba(0, 230, 138, 0.08)` | Background tints (e.g. terminal panels) |
| `--accent-bg` | `rgba(0, 230, 138, 0.04)` | Very faint backgrounds |

### Colors — Secondary
| Token | Hex | Usage |
|---|---|---|
| `--gold` | `#d4a443` | Editorial accent (regulatory section, classical theme primary) |
| `--signal` | `#4f8eff` | Informational blue |
| `--danger` | `#ff3b5c` | Error / critical findings |
| `--warn` | `#ffaa2e` | Warning / partial coverage |

### Colors — Surfaces
| Token | Hex | Usage |
|---|---|---|
| `--bg-deep` | `#050810` | Page background (deepest) |
| `--bg-surface` | `#0a0f1e` | Default section background |
| `--bg-elevated` | `#0f1528` | Cards, elevated panels |
| `--bg-card` | `rgba(15, 21, 40, 0.6)` | Translucent card overlay |

### Colors — Text
| Token | Hex | Usage |
|---|---|---|
| `--text-primary` | `#f0f2f5` | Headings, body |
| `--text-secondary` | `rgba(240, 242, 245, 0.72)` | Subheads, secondary copy |
| `--text-muted` | `#6b7388` | Captions, eyebrows, metadata |
| `--text-faint` | `#3a4055` | Disabled, placeholders |

### Colors — Lines
| Token | Hex |
|---|---|
| `--line` | `rgba(255, 255, 255, 0.06)` |
| `--line-soft` | `rgba(255, 255, 255, 0.03)` |
| `--line-strong` | `rgba(255, 255, 255, 0.12)` |

### Typography
| Token | Stack | Usage |
|---|---|---|
| `--font-display` | `'Orbitron', sans-serif` | All H1/H2 headings |
| `--font-body` | `'Inter', system-ui, ...` | Body copy, UI |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` | Terminal, code, eyebrows, metadata |
| `--font-tactical` | `'Rajdhani', sans-serif` | Stat numerals, tactical labels |

**Loaded via Google Fonts:**
- Orbitron (500, 600, 700)
- Rajdhani (500, 600, 700)
- Inter (400, 500, 600, 700)
- JetBrains Mono (400, 500, 600)
- Cormorant Garamond (500, 600, 700) — only used in Classical theme

**Type scale (display):**
- H1 (hero): `clamp(2.75rem, 6vw, 4.75rem)` — Orbitron 700, letter-spacing -0.02em, line-height 1.05
- H2 (section): `clamp(2rem, 4vw, 3rem)` — Orbitron 600, letter-spacing -0.01em
- H3 (card): `1.25rem` — Inter 600
- Eyebrow: `0.75rem` — JetBrains Mono 500, uppercase, letter-spacing 0.2em, color `--accent`
- Body: `1rem` / line-height 1.6 — Inter 400
- Lead body: `1.125rem` / line-height 1.7

### Spacing
- Section vertical padding: `--pad-y: 6.5rem` (default), `4.5rem` (compact), `8rem` (spacious)
- Section horizontal: `1.5rem` mobile, container max-width `1200px`
- Card padding: `1.75rem` to `2.5rem`
- Grid gaps: `1rem` (tight), `1.5rem` (default), `2.5rem` (wide)

### Border Radius
- Cards / buttons: `4px` (sharp, intentional — matches "tactical" feel)
- Pills / badges: `2px`
- Avoid pill/fully-rounded — this design is angular by intent

### Shadows
Most elevation comes from borders and background contrast, not shadows. The few shadows used:
- Accent glow on hover: `box-shadow: 0 0 0 1px var(--accent), 0 0 24px var(--accent-glow)`
- Card hover lift: `transform: translateY(-2px)` + border color change

---

## Themes

Three themes selectable via `<html class="theme-...">`. Default is **Editorial**.

| Theme | Class | Vibe |
|---|---|---|
| Editorial | `theme-editorial` | Refined, board-ready, default |
| Tactical | `theme-tactical` | More saturated greens, "current Achilles" aesthetic |
| Classical | `theme-classical` | Deep navy + gold accent, Cormorant Garamond display, premium positioning |

Each theme overrides a subset of CSS custom properties. See `source/styles.css` lines 41–75.

**Density modes:** `density-default`, `density-compact`, `density-spacious` — adjust `--pad-y` only.

---

## Internationalization (i18n)

Copy lives in `source/i18n.js` as a global `window.COPY` object with shape:

```js
window.COPY = {
  en: { nav: {...}, hero: {...}, problem: {...}, /* ...all sections */ },
  es: { nav: {...}, hero: {...}, problem: {...}, /* ...all sections */ },
};
```

Components receive `lang` as a prop and look up `window.COPY[lang].sectionName.key`. Language is toggled in two places:
1. The `LangToggle` component in the nav
2. The Tweaks panel "Direction" section

In production, replace this with the existing Fortika i18n mechanism (likely `react-i18next` or a custom hook — see `INTEGRATION_PLAN.md` for what to look for).

**Important:** Spanish translations are natural localizations, not literal calques. Keep the existing copy verbatim — it has been reviewed for tone (e.g. "BAS empresarial sin la factura empresarial" — do not retranslate).

---

## Interactions & Behavior

### Hero
- **Animated terminal** in the right column types out a sequence of detection lines (~150ms per line, monospace, cursor blink). Implemented via `useState` + `setInterval` in `app.jsx` lines 95–145. On loop completion, restarts after 2s pause.
- **Stat counter** (3 stat blocks below hero copy) — number counts up from 0 on viewport entry over 1.2s ease-out.
- CTAs: "Book a demo" (primary, accent fill) and "View sample report" (secondary, ghost border).

### Problem
- 4 stat cards in a 4-col grid. On scroll into view, each card fades up with 80ms staggered delay.
- Hover: border lifts to `--line-strong`, no transform.

### Regulatory
- 5 framework cards (DORA, TIBER-EU, ISO 27001, CIS, MITRE), each with an 80-cell coverage grid (cells = `coverage% / 100 * 80`, filled with `--accent`, unfilled with `--line`).
- Click a framework card → expands inline to show a translated list of specific controls.

### Features
- 6-card grid (3 cols × 2 rows on desktop, 2×3 tablet, 1×6 mobile).
- Each card: icon (top-left), title, body, optional product screenshot.
- Cards 1, 3, 5 have screenshots from `assets/`.

### How It Works
- 4 vertical pipeline steps. Each step has:
  - Number (01–04) in `--font-tactical`, large
  - Title + description
  - Inline terminal showing example commands/output
- Steps connect via a vertical accent-colored line between them (`::before` pseudo-element).

### MITRE Matrix
- **Interactive grid** of MITRE ATT&CK techniques organized by tactic columns.
- Filter chips at top: "All", "Banking-relevant", "Covered", "Not covered" — clicking filters the grid via opacity/visibility.
- Hover a technique cell → tooltip with technique ID and short description.
- State: `useState` for active filter; CSS handles the visual filter response.

### Compare
- Three-column comparison table: **Achilles** | **Enterprise BAS** | **Annual Pen Test**.
- Achilles column has accent-colored left border and `--accent-bright` checkmarks.
- ~12 capability rows (Continuous testing, MITRE coverage, DORA-ready, etc.).

### CTA Block
- Two-column: copy on left, "What you get in the demo" checklist on right.
- Primary CTA + secondary "Talk to a security engineer" link.

### Footer
- 4 columns: Brand/tagline | Product | Compliance | Company
- Bottom strip: copyright, Madrid address, social links, "Made in Spain" tagline.

### Reveal-on-scroll
Implemented in `app.jsx` `useReveal` hook (lines 34–42). Adds `.visible` class via IntersectionObserver at threshold 0.1. The CSS handles the actual fade/translate.

```css
.reveal { opacity: 0; transform: translateY(24px); transition: opacity 600ms, transform 600ms; }
.reveal.visible { opacity: 1; transform: translateY(0); }
```

---

## Tweaks Panel — DEV ONLY

`source/tweaks-panel.jsx` is a development tool for visual exploration (theme/density/lang/section toggles). **Strip this before shipping to production.** It uses a `window.parent.postMessage` protocol that only works inside the design tool's preview iframe.

In production, the page should default to:
- `theme-editorial`
- `density-default`
- `lang` driven by browser/user preference (not the toggle)
- All sections visible

The EN/ES toggle in the nav stays in production.

---

## Assets

All assets in `source/assets/` are **placeholders that should be reused as-is** unless the brand team supplies new ones:

| File | Type | Where |
|---|---|---|
| `logo-achilles.svg` | Brand mark | Nav, footer, favicon |
| `Endpoint.webp` | Product screenshot | Features section, card 1 |
| `Library.webp` | Product screenshot | Features section, card 3 |
| `Scoring.webp` | Product screenshot | Features section, card 5 |

The terminal animations in Hero and How-It-Works are **drawn in CSS/HTML, not images**. Do not screenshot them.

---

## Out of Scope

The following are **not** part of this handoff and should be handled separately:
- Backend integration for the "Book a demo" form
- Analytics events
- SEO meta tags beyond `<title>` and favicon (add via your existing meta system)
- Cookie banner / GDPR consent (use the existing Fortika component if there is one)
- Light mode (this design is dark-only by intent — do not auto-generate a light theme)

---

## See Also

`INTEGRATION_PLAN.md` — step-by-step plan for Claude Code to integrate this into the Fortika `frontend/` codebase.
