# Frontend Performance Optimization

**Date:** April 3, 2026
**Scope:** ProjectAchilles frontend (React 19 + Vite 8 + Tailwind CSS v4)

## Problem Statement

The frontend was built incrementally with LLM assistance. While functionally correct, it exhibited classic performance anti-patterns: no code splitting, zero component memoization, coarse state selectors, unmemoized context providers, uncompressed images, and background polling with no visibility awareness. The entire application shipped as a single 2.3MB JavaScript bundle.

## Findings

### Before Optimization

| Issue | Impact |
|-------|--------|
| Single monolithic JS bundle (2.3MB) | Every user downloads all pages on first visit |
| Zero `React.lazy()` or dynamic imports | No route-based code splitting |
| Zero `React.memo()` across 82 components | All 25+ analytics charts re-render on every parent state change |
| 3.1MB of uncompressed marketing PNGs | 55% of total dist size |
| `hero.css` (953 lines) loaded for all users | Authenticated users download landing page styles |
| ThemeProvider context value not memoized | Cascading re-renders across entire component tree |
| 4 independent `setInterval` polling loops | Requests fire even when browser tab is hidden |
| Coarse Redux selector (`state.agent` entire slice) | Any slice field change re-renders AgentsPage |
| AppSidebar modules array recreated every render | Sidebar children re-render on unrelated state changes |
| Debug `console.log` left in Header.tsx | Serializes user object on every render in production |

## Changes Implemented

### Phase A: Measurement Infrastructure

#### A1. Bundle Analysis Plugin
- Added `rollup-plugin-visualizer` to `vite.config.ts`
- Generates interactive treemap: `ANALYZE=true npm run build`
- Gzip size visualization included

#### A2. Web Vitals Reporting
- Created `src/lib/vitals.ts` using the `web-vitals` library
- Reports LCP, INP, CLS, TTFB, FCP to dev console
- Only loads in development (`import.meta.env.DEV` guard)

#### A3. React Profiler Wrapper
- Created `src/components/shared/DevProfiler.tsx`
- Logs render phase, duration, and timing per component
- Zero overhead in production builds

#### A4. Performance Marks
- Added `performance.mark()` / `performance.measure()` to `AnalyticsDashboardPage`
- Measures "time-to-data" (mount to dashboard data loaded)
- Visible in Chrome DevTools Performance tab

### Phase B: Optimizations

#### B1. Route-Based Code Splitting
**File:** `src/routes/AppRouter.tsx`

Converted 11 page imports from static to `React.lazy()`:
- HeroPage, BrowserHomePage, TestDetailPage, AnalyticsDashboardPage
- AgentDashboardPage, AgentsPage, AgentDetailPage, TasksPage
- SettingsPage, UserProfilePage, CliAuthPage

Auth pages (SignInPage, SignUpPage) remain eagerly loaded for instant sign-in flow.

Added `<Suspense>` wrapper with the existing `<Loading>` spinner as fallback.

#### B2. Vite Manual Chunk Strategy
**File:** `vite.config.ts`

Split vendor dependencies into cacheable chunks:
- `vendor-react` — React, React DOM, React Router
- `vendor-charts` — Recharts + D3 dependencies
- `vendor-clerk` — Clerk authentication SDK
- `vendor-ui` — Radix UI primitives
- `vendor-code` — react-syntax-highlighter, react-markdown, remark-gfm

Vendor chunks are cached independently — app code changes no longer invalidate vendor caches.

#### B3. Image Optimization
**Files:** `public/assets/images/`

Converted marketing PNGs to WebP (quality 80) using ImageMagick:

| Image | Before (PNG) | After (WebP) | Reduction |
|-------|-------------|-------------|-----------|
| Scoring | 1.9MB | 53KB | 97% |
| Endpoint | 733KB | 43KB | 94% |
| Library | 443KB | 37KB | 92% |
| **Total** | **3.1MB** | **133KB** | **96%** |

Removed unused duplicate `logo-achilles.png` (92KB) — SVG version (211B) is used instead.

#### B4. Hero CSS Lazy Loading
**Files:** `src/App.tsx`, `src/pages/HeroPage.tsx`

Moved `import './styles/hero.css'` from `App.tsx` (loaded for all users) into `HeroPage.tsx` (loaded only when visiting the landing page). Since HeroPage is lazy-loaded (B1), the CSS travels with the chunk.

Result: Authenticated users no longer download 953 lines of marketing CSS. The main CSS dropped from 125KB to 108KB.

#### B5. ThemeProvider Context Memoization
**File:** `src/hooks/useTheme.tsx`

Wrapped the context value object in `useMemo` with dependencies on the three state values (`theme`, `themeStyle`, `phosphorVariant`). The setter/toggle functions are stable references from `useState`, so the memo only breaks when theme state actually changes.

Eliminates cascading re-renders across the entire component tree on unrelated state updates.

#### B6. Debug Console.log Removal
**File:** `src/components/shared/Header.tsx`

Removed `console.log('[Header] useUser() values:', ...)` that was serializing Clerk user objects on every render in production.

#### B7. React.memo on Chart Components
**Files:** 10 components in `src/pages/analytics/components/`

Wrapped all analytics chart/card components with `React.memo()`:
- TrendChart, ErrorTypePieChart, StackedBarChart, CoverageTreemap
- DefenseScoreByHostChart, CategoryBreakdownChart, TestActivityCard
- HeroMetricsCard, SecureScoreCard, TopControlsCard

When AnalyticsDashboardPage re-renders (tab switch, filter change), only charts whose props actually changed will re-render. Recharts is expensive (SVG layout recalculation), so this prevents significant wasted work.

#### B8. Visibility-Aware Polling Hook
**New file:** `src/hooks/usePolling.ts`

Created a `usePolling(callback, intervalMs)` hook that:
- Pauses polling when the browser tab is hidden (`document.visibilityState`)
- Resumes immediately on tab focus with a catch-up call
- Uses `useRef` for the callback to avoid resetting the interval when dependencies change
- Cleans up on unmount

Replaced all 4 `setInterval` patterns:

| Page | Interval | Before | After |
|------|----------|--------|-------|
| AgentsPage | 15s | `setInterval` always active | Pauses when tab hidden |
| TasksPage | 10s | `setInterval` always active | Pauses when tab hidden |
| AgentDetailPage | 30s | `setInterval` inside effect | Separate `usePolling` call |
| useOutdatedAgentCount | 60s | `setInterval` always active | Pauses when tab hidden |

#### B9. Fine-Grained Redux Selectors
**Files:** `src/store/agentSlice.ts`, `src/pages/endpoints/AgentsPage.tsx`

Added named selectors to the agent slice:
- `selectAgents`, `selectAgentFilters`, `selectAgentLoading`, `selectAgentError`

Updated AgentsPage from coarse destructuring (`useAppSelector(state => state.agent)`) to individual selectors. The page now only re-renders when its specific data changes, not on every slice field update.

#### B10. AppSidebar Modules Memoization
**File:** `src/components/layout/AppSidebar.tsx`

Wrapped the `modules` array definition in `useMemo` with dependencies on the 4 values it depends on (`analyticsConfigured`, `canAccessEndpoints`, `canAccessAgents`, `outdatedCount`). Previously recreated on every render, causing all navigation children to re-render.

## Results

### Build Output Comparison

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **JS bundle** | 2.3MB (1 file) | 112KB entry + lazy chunks | -95% initial |
| **Total dist** | 5.6MB | 2.8MB | -50% |
| **Image payload** | 3.1MB (PNG) | 133KB (WebP) | -96% |
| **CSS for auth users** | 125KB | 108KB | -14% |
| **Hero CSS for auth users** | Loaded always | Not loaded | -100% |
| **Polling while tab hidden** | 4 active intervals | 0 | -100% |
| **Memoized chart components** | 0 | 10 | Prevents cascading re-renders |
| **Redux selector granularity** | 1 coarse | 4 fine-grained | Prevents unrelated re-renders |

### Production Chunk Distribution

| Chunk | Raw Size | Gzipped | Loaded When |
|-------|---------|---------|-------------|
| `index` (app shell) | 113KB | 34KB | Always (entry point) |
| `vendor-react` | 220KB | 69KB | Always |
| `vendor-charts` | 435KB | 112KB | Analytics page |
| `vendor-clerk` | 94KB | 26KB | Any authenticated page |
| `vendor-ui` | 120KB | 31KB | Most pages |
| `vendor-code` | 773KB | 262KB | TestDetail page only |
| `AnalyticsDashboardPage` | 167KB | 38KB | Analytics page |
| `SettingsPage` | 69KB | 16KB | Settings page |
| `BrowserHomePage` | 58KB | 17KB | Dashboard/Browse page |
| `HeroPage` | 52KB | 15KB | Landing page only |

### Production Web Vitals Baseline (localhost)

| Metric | Value | Rating |
|--------|-------|--------|
| **TTFB** | 7ms | Excellent |
| **FCP** (First Contentful Paint) | 252ms | Excellent (<1.8s) |
| **LCP** (Largest Contentful Paint) | 1,768ms | Good (<2.5s) |
| **DOM Content Loaded** | 190ms | Excellent |
| **Total page transfer** | 812KB | 31 JS chunks + 2 CSS files |
| **App shell transfer** | ~125KB gzipped | `index` + `vendor-react` + CSS |

*Note: TTFB reflects localhost. Over a real network, add server response time, but transfer sizes are the controllable factor.*

## How to Measure Going Forward

### Bundle Size
```bash
cd frontend && npm run build        # Check chunk output
ANALYZE=true npm run build           # Open interactive treemap
```

### Web Vitals (Development)
Open the browser dev console while running `npm run dev`. Vitals are automatically logged:
```
[Vitals] First Contentful Paint: 252ms
[Vitals] Largest Contentful Paint: 1768ms
[Vitals] Cumulative Layout Shift: 0.001
```

### React Profiler
Wrap components with `<DevProfiler id="name">` to log render counts and durations:
```
[Profiler] AnalyticsDashboard (mount) — 45.2ms @ 190ms
[Profiler] AnalyticsDashboard (update) — 3.1ms @ 2450ms
```

### Performance Marks
Open Chrome DevTools Performance tab, record a page load. Named marks appear in the timeline:
- `analytics-mount` / `analytics-data-ready` with measured `analytics-time-to-data`

## Future Optimization Opportunities (Tier 3)

These items were assessed but deferred — implement if metrics justify:

1. **Barrel export elimination** — `components/shared/ui/index.ts` re-exports 10 components; importing one imports all. Convert to direct imports across ~36 files.

2. **List virtualization** — `AgentList` renders all rows without virtualization. With fleet expected to grow 4-5x, add `@tanstack/react-virtual` when agent count regularly exceeds 100.

3. **CSS theme splitting** — All 5 theme variants (default light/dark, neobrutalism, hackerterminal green/amber) are in a single 108KB CSS file. Could split into lazy-loaded theme stylesheets.

4. **API request caching** — No client-side caching layer exists. Consider `@tanstack/react-query` or a custom SWR hook to avoid redundant API calls and provide stale-while-revalidate behavior.

## Files Created
- `frontend/src/lib/vitals.ts` — Web Vitals reporter
- `frontend/src/components/shared/DevProfiler.tsx` — React Profiler wrapper
- `frontend/src/hooks/usePolling.ts` — Visibility-aware polling hook
- `frontend/public/assets/images/*.webp` — Optimized WebP images

## Files Modified
- `frontend/vite.config.ts` — Bundle analyzer + manual chunks
- `frontend/package.json` — New deps (rollup-plugin-visualizer, web-vitals)
- `frontend/src/routes/AppRouter.tsx` — Lazy imports + Suspense
- `frontend/src/App.tsx` — Lazy HeroPage, removed hero.css import
- `frontend/src/main.tsx` — Web Vitals hook
- `frontend/src/hooks/useTheme.tsx` — Context memoization
- `frontend/src/components/shared/Header.tsx` — Removed debug console.log
- `frontend/src/pages/analytics/components/*.tsx` — React.memo on 10 chart components
- `frontend/src/pages/endpoints/AgentsPage.tsx` — usePolling + fine-grained selectors
- `frontend/src/pages/endpoints/TasksPage.tsx` — usePolling
- `frontend/src/pages/endpoints/AgentDetailPage.tsx` — usePolling
- `frontend/src/hooks/useOutdatedAgentCount.ts` — usePolling
- `frontend/src/store/agentSlice.ts` — Named selectors
- `frontend/src/components/layout/AppSidebar.tsx` — useMemo modules
- `frontend/src/pages/HeroPage.tsx` — hero.css import, WebP image refs
- `frontend/.gitignore` — Added bundle-report.html

## Files Removed
- `frontend/public/assets/images/Scoring.png` (1.9MB)
- `frontend/public/assets/images/Endpoint.png` (733KB)
- `frontend/public/assets/images/Library.png` (443KB)
- `frontend/public/assets/logo-achilles.png` (92KB, duplicate of SVG)
