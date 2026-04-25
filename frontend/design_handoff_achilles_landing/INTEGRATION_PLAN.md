# Integration Plan — for Claude Code

This document gives Claude Code a concrete plan for integrating the Achilles landing redesign into the existing Fortika `frontend/` codebase.

**Read this before touching any code.** Then read `README.md` for design tokens, sections, and copy.

---

## Phase 0 — Discover the codebase

Before writing anything, understand the target environment. Run these in order:

1. **Map the frontend.** `ls frontend/` and read `frontend/package.json`. Note: framework (React version), build tool (Vite/Next/CRA), styling (Tailwind / CSS modules / styled-components), TypeScript config, router (React Router / Next routing).
2. **Find the existing landing page.** Look for `HeroPage.tsx`, `Landing.tsx`, `Home.tsx`, or whatever owns the `/` route. Read it end-to-end.
3. **Find the i18n system.** Search for `useTranslation`, `i18next`, `tx(`, `t(`, `lang`, or a `locales/` folder. Identify the helper signature (e.g. `t('hero.title')` vs. `tx({en, es})`).
4. **Find the design tokens.** Look for `tailwind.config.{js,ts}`, `theme.ts`, `tokens.css`, `_variables.scss`, or a global CSS file with `:root` custom properties. Note how colors and fonts are referenced in existing components.
5. **Find the routing.** How are pages registered? Where would a new route or a replacement landing live?
6. **Find shared components.** Buttons, sections, containers, navs — does the codebase already have these? Reuse them.

**Do not skip Phase 0.** Lifting tokens from this handoff verbatim into a project that already has Tailwind theme tokens will create drift. The goal is to **map** the design tokens onto the existing system, not duplicate them.

---

## Phase 1 — Add the design tokens

Depending on what Phase 0 revealed:

**If Tailwind:** Extend `tailwind.config.{js,ts}` `theme.extend.colors` with `accent`, `accent-bright`, `bg-deep`, `bg-surface`, `bg-elevated`, `text-primary`, etc. Add fontFamily entries for `display`, `body`, `mono`, `tactical`. Add the three theme variants either as data-attribute selectors or as a `darkMode: 'class'`-style class strategy.

**If CSS variables already exist:** Add the new tokens to the existing `:root` block. Match the existing naming convention (e.g. if the codebase uses `--color-accent-primary`, don't introduce `--accent`).

**If neither:** Add `frontend/src/styles/tokens.css` with the `:root` block from `source/styles.css` lines 5–45.

Either way, **import the Google Fonts** in the way the rest of the app does — likely a `<link>` in `index.html` or a `@import` in a global stylesheet. Required families: Orbitron, Rajdhani, Inter, JetBrains Mono, Cormorant Garamond.

---

## Phase 2 — Port the i18n dictionary

`source/i18n.js` is a global `window.COPY` object. **Do not ship `window.COPY`.** Instead:

1. Convert it to the existing i18n mechanism. Examples:
   - **react-i18next:** Add `frontend/src/locales/en/landing.json` and `frontend/src/locales/es/landing.json`, each containing the matching subtree.
   - **Custom `tx({en, es})` helper:** Inline the strings at the call site as `tx({en: '...', es: '...'})`.
   - **Custom `t('key')` helper:** Add namespaced keys like `landing.hero.title` to wherever the dictionary lives.
2. Preserve the **section/key structure** — translators have already reviewed the Spanish strings as a coherent set, and breaking the structure means re-reviewing.
3. Keep the strings byte-identical. Do not retranslate. The Spanish copy is intentionally idiomatic, not literal.

---

## Phase 3 — Port the components

The source is one ~720-line `app.jsx` file. **Split it into TSX files**, one per section:

```
frontend/src/pages/landing/
├── Landing.tsx              ← page composition (Nav + sections + Footer)
├── components/
│   ├── Nav.tsx
│   ├── Hero.tsx
│   ├── Problem.tsx
│   ├── Regulatory.tsx
│   ├── Features.tsx
│   ├── HowItWorks.tsx
│   ├── MitreMatrix.tsx
│   ├── Compare.tsx
│   ├── Security.tsx
│   ├── CTA.tsx
│   └── Footer.tsx
├── icons.tsx                ← the `I` icon set (lines 5–30 of app.jsx)
└── hooks/
    └── useReveal.ts
```

For each component:
- Add explicit prop types. Most components currently take `lang` as a prop — replace with the i18n hook from Phase 2.
- Replace inline `style={{...}}` with the codebase's styling convention (Tailwind classes, CSS modules, or styled-components).
- Replace CSS class strings (`className="hero"`) with whatever the codebase uses.
- Convert `useState` / `useEffect` / `useRef` imports to ESM imports (the source uses `const { useState } = React;`).

**`AchillesLogo`** (lines 31–35 of `app.jsx`) is a small inline SVG component — keep it inline, but consider also exposing the file `assets/logo-achilles.svg` for `<img>` usage.

---

## Phase 4 — Port the styles

`source/styles.css` is ~1100 lines. **Don't bulk-copy it.** Walk it section by section.

For each section's styles:
- If the codebase uses **Tailwind**, convert rules to utility classes inline on the components. Pull out genuinely complex rules (animations, terminal cursor blink) into `@layer components` or a dedicated CSS file.
- If the codebase uses **CSS modules**, create a `Hero.module.css` next to `Hero.tsx` with the relevant rules.
- If the codebase uses **a global stylesheet**, append a scoped block per section.

The **animations** (terminal type-on, reveal-on-scroll, stat counter) are CSS keyframes + JS state. Keep them as-is — they're already minimal.

The **page background** (`.page-bg` — radial gradients + grid lines + film grain) is non-trivial and worth porting carefully. Lines 100–125 of `styles.css`.

---

## Phase 5 — Wire it up

1. **Add the route.** If replacing the existing `HeroPage`, swap the import. If A/B testing, register `/landing-v2` (or whatever convention the codebase uses) and let stakeholders compare side-by-side.
2. **Strip dev-only code.** Remove anything related to `tweaks-panel.jsx`, `window.parent.postMessage`, `__edit_mode_*`, the `EDITMODE-BEGIN`/`EDITMODE-END` markers, and the tweaks state on the root component.
3. **Hardcode production defaults:**
   - Theme: `editorial` (apply the class to `<html>` or whatever the theme system expects)
   - Density: `default`
   - Language: from browser/user preference (existing i18n hook)
   - All sections visible
4. **Keep the EN/ES toggle in the nav.** That ships.

---

## Phase 6 — Verify

Run, in order:

1. `tsc --noEmit` (or whatever typechecks the frontend) — fix any type errors.
2. The dev build (`npm run dev` / `vite` / `next dev`) — load the page, click through every nav anchor, toggle language, scroll the full page.
3. The production build (`npm run build`) — confirm it compiles without warnings about missing fonts, missing assets, or unused imports.
4. **Visual diff** — open `source/Achilles Landing.html` in a browser side-by-side with the integrated page. Look for:
   - Color drift (tokens mapped wrong)
   - Font fallback (Google Fonts not loading)
   - Spacing differences (Tailwind utilities not matching the source `clamp()` / `rem` values)
   - Missing animations
   - Missing copy in either language

Fix all of the above before opening a PR.

---

## Phase 7 — PR hygiene

- One commit per phase, or one commit per section component if you prefer fine-grained.
- PR description should link to this handoff and call out anything you deviated from (e.g. "used existing `<Section>` wrapper instead of duplicating the container styles").
- Include a screenshot of the new page in the PR description.
- Tag whoever owns the existing `HeroPage.tsx` for review.

---

## Common Pitfalls

1. **Lifting `window.COPY` directly.** It works in the browser but defeats the existing i18n system and breaks SSR. Always port to the real i18n.
2. **Copying `styles.css` wholesale.** It will collide with existing global styles. Walk it section by section.
3. **Skipping the font import.** If Orbitron and JetBrains Mono don't load, the design looks completely wrong. Verify they're requested in the network tab.
4. **Missing the reveal-on-scroll observer.** Without `useReveal`, every section is invisible (`opacity: 0`). Easy to miss when porting.
5. **Keeping the `tweaks-panel.jsx` script tag.** Will throw console errors in production because the postMessage protocol only exists in the design tool's iframe.
6. **Retranslating Spanish.** The strings have been reviewed. Keep them verbatim.
7. **Letterboxing the terminal animation as an image.** It's CSS — port the markup and keyframes.

---

## Asking for help

If you hit anything ambiguous (an existing component conflicts with the new design, a token doesn't have an obvious mapping, the existing i18n is missing a piece), **stop and ask** rather than guessing. The README has the design intent; the codebase has the conventions. When they disagree, the human needs to arbitrate.
