# ATT&CK Matrix Redesign — Bar Chart + Drill-Down

**Date:** 2026-03-14
**Status:** Approved
**Scope:** Frontend only — `frontend/src/`

## Problem

The current MITRE ATT&CK matrix view displays technique IDs in a card grid layout that:
1. Shows technique IDs without human-readable names, making it opaque
2. Uses a card grid that destroys the kill chain left-to-right spatial relationship
3. Optimizes for showing what's covered rather than highlighting gaps
4. Creates scroll-monsters when tactics have 70+ techniques (Persistence shows "Show 62 more")

## Audience

Red teamers and blue teamers using the matrix primarily for **coverage assessment** — "What parts of ATT&CK can we test? Where are the gaps?"

## Design

### Two-Part Visualization

Replace the card grid with a bar chart (overview) + detail panel (drill-down).

#### 1. Bar Chart (always visible)

14 vertical bars arranged left-to-right in kill chain order:
- Reconnaissance → Resource Development → Initial Access → Execution → Persistence → Privilege Escalation → Defense Evasion → Credential Access → Discovery → Lateral Movement → Collection → Command and Control → Exfiltration → Impact

**Bar properties:**
- Height proportional to technique count for that tactic (relative to the tactic with most techniques)
- Color: theme-aware intensity gradient. Bar intensity = `totalTestsInTactic / maxTestsAcrossAllTactics` (same ratio-based approach as existing `getIntensityColor(count)` but at the tactic level). This makes the tactic with the most tests the brightest bar, and others proportionally dimmer.
- Uncovered tactics (0 techniques): stubby minimum-height bar with red-dashed outline (`border: 1px dashed` in red/error color). These are the visual "gap screamers"
- Selected state: bar gets a brighter border or ring to indicate it's the active drill-down target

**Bar labels:**
- Below each bar: tactic short abbreviation (IA, EX, PE, PR, DE, CA, DI, LM, CO, C2, EF, IM, RE, RD)
- Add a `barLabel` field to the `MitreTactic` interface (e.g., `barLabel: 'IA'`). These are new — not derived from `shortName` at runtime.

**Hover tooltip** (native `title` attribute):
- Full tactic name + technique count + total test count for that tactic
- Example: `"Execution — 12 techniques · 43 tests"`

**Bar chart container:**
- Fixed height: `h-48` (192px) — enough for visual differentiation without dominating the page
- Bars use `flex` layout with equal flex-1 widths and small gap
- Bottom axis line with labels

#### 2. Detail Panel (click-activated)

Appears below the bar chart when a tactic bar is clicked.

**Header row:**
- Tactic full name + TA ID (e.g., "Execution — TA0002")
- Right side: technique count + test count (e.g., "12 techniques · 43 tests")

**Body:**
- Technique chips rendered as colored pills in a flex-wrap layout
- Each chip shows: `T1059 — Command and Scripting Interpreter · 6`
  - Technique ID (monospace)
  - Human-readable name from the static lookup map
  - Test count badge
- Chip background color = intensity (same scale as bars)
- Chip text color = contrast-aware (white on dark chips, dark on light chips) — reuse existing `getTextColor()` logic
- Chips sorted by test count (descending), then alphabetically
- Click a chip → calls `onDrillToTechnique(techniqueId)` → switches to Browse tab filtered by that technique

**Panel behavior:**
- Initially hidden (no tactic selected)
- Click a bar → panel appears/updates with that tactic's data
- Click the same bar again → panel closes
- Smooth open transition (same `grid-template-rows: 0fr/1fr` pattern from CollapsibleSection)

**Empty state for panel:**
When no bar is selected, show a subtle hint: `"Click a tactic bar to explore technique coverage"`

#### 3. Stats Header (preserved)

Keep existing implementation:
- Three stat badges: technique count (green), tactic count (primary), test count (default)
- "Show uncovered tactics" toggle on the right
- Title: "MITRE ATT&CK Coverage"

The toggle controls whether 0-technique tactic bars are visible. When hidden, those bars don't render (chart compresses). When shown, they appear as red-dashed stubby bars.

### Technique Name Lookup

**New file:** `frontend/src/data/mitre-techniques.ts`

Static `Record<string, string>` mapping technique IDs to human-readable names. Covers all MITRE ATT&CK Enterprise techniques (~400 entries including sub-techniques).

```typescript
// frontend/src/data/mitre-techniques.ts
export const TECHNIQUE_NAMES: Record<string, string> = {
  'T1001': 'Data Obfuscation',
  'T1001.001': 'Junk Data',
  'T1001.002': 'Steganography',
  'T1001.003': 'Protocol Impersonation',
  // ... ~400 entries
  'T1059': 'Command and Scripting Interpreter',
  'T1059.001': 'PowerShell',
  // etc.
};
```

**Source:** MITRE ATT&CK Enterprise matrix v16 (public domain, October 2024 release)
**Bundle size:** ~15KB minified (acceptable, loaded only on matrix tab)
**Fallback:** If a technique ID isn't in the map, display the raw ID without a name (graceful degradation)

### Theme Support

All three themes must work:
- **Default (dark/light):** Green intensity scale (existing oklch 145 logic)
- **Neobrutalism:** Hot pink/magenta scale (existing oklch 340 logic)
- **Hacker Terminal:** Phosphor green scale (existing oklch 142 logic)

The gap bars (red-dashed) use `text-destructive` / `border-destructive` for theme-aware red.

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/data/mitre-techniques.ts` | Static technique ID → name lookup map |

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/browser/MitreAttackMatrix.tsx` | Full rewrite: replace card grid with bar chart + detail panel. Keep props interface, tacticMap computation, stats, toggle. |

## Files NOT Modified

- `BrowserHomePage.tsx` — no changes, same props contract
- Backend — no changes
- Types — no changes

## What's Preserved

- `MitreAttackMatrixProps` interface (`tests: TestMetadata[]`, `onDrillToTechnique: (technique: string) => void`)
- `ENTERPRISE_TACTICS` constant (14 tactics with slugs, IDs, names)
- `useMemo` computation of `tacticMap`, `maxCount`, `stats`
- `getIntensityColor()` and `getTextColor()` theme-aware color functions
- Stats badges (technique count, tactic count, test count)
- "Show uncovered tactics" toggle
- `onDrillToTechnique` drill-down to browse view
- Empty state when no tests have ATT&CK data

## What's Removed

- Per-tactic card layout with `<div>` grid
- Per-row technique rendering with expand/collapse (8-item limit + "Show N more")
- `COLLAPSED_LIMIT` constant
- `expandedTactics` state (replaced by `selectedTactic` for detail panel)
- Intensity legend at bottom of cards
- `getTacticBorderColor()` function (border intensity no longer needed)

## Testing

- Existing frontend tests should pass unchanged (MitreAttackMatrix has no unit tests currently)
- Visual verification across all three themes
- Manual checks:
  - Bar chart renders 14 bars in kill chain order
  - Uncovered tactics show as red-dashed stubs (when toggle is on)
  - Clicking a bar opens detail panel with technique chips
  - Technique chips show human-readable names
  - Clicking a chip drills to browse view with correct technique filter
  - Clicking same bar again closes detail panel
  - "Show uncovered tactics" toggle works (hides/shows empty bars)
  - Hover tooltip shows full tactic name + counts
  - Theme switching works for all three themes

## Out of Scope

- No backend changes
- No Elasticsearch integration (coverage health / pass/fail per technique — future enhancement)
- No changes to the Overview or Browse tabs
- No changes to the test detail page
