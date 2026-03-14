# Test Browser Visual Enhancements

**Date:** 2026-03-14
**Status:** Approved
**Scope:** Frontend only — `frontend/src/`

## Problem

The test browser has two visual issues:

1. **Browse view cards** display all metadata at equal visual weight, making the grid feel cluttered during scanning despite the information being genuinely useful for red/blue team practitioners.
2. **Test detail sidebar** has 7 sections always expanded with no collapse behavior, forcing users to scroll past unused sections to reach their primary workflow (Documentation + Build).

## Audience

Red teamers and blue teamers — security practitioners who use this tool regularly. They need information density but with clear visual hierarchy so the eye knows where to land.

## Design Decisions

### Browse View: Layered Card Hierarchy + List View Toggle

Two complementary changes: restyle existing cards for better visual hierarchy, and add an alternative list view for power users.

#### Card Restyling (`TestCard.tsx`)

No information is removed. Visual weight is redistributed into three tiers:

**Tier 1 — Headline (dominant):**
- **Title**: Remains `text-lg font-semibold`, primary scan target
- **Severity badge**: Changes from plain colored text to a filled pill badge (`bg-red-500 text-white` for critical, `bg-orange-500 text-white` for high, etc.). First element on metadata row.
- **Score**: Moves from inline icon+number to a standalone gradient badge block (amber/orange gradient background, bold number). Anchored top-right of the card as a "rating stamp". Sized ~44x44px with `rounded-lg`.

**Tier 2 — Context (visible but quieter):**
- **Metadata row**: Simplified to severity badge + stage count + platform target only. Author and dates move to a hover tooltip on the card (accessible but not competing for scan attention).
- **Description**: Reduced from `line-clamp-2` to `line-clamp-1`. It's a scan aid, not a reading area — the detail page has the full text.
- **Techniques**: `TechniqueBadge` gains a new `xs` size variant (`px-1 py-0.5 text-[9px]`). Cards use `size="xs"` instead of `size="sm"`. Wrapped in a `div` with `opacity-70` to visually recede.

**Tier 3 — Footer (subdued):**
- Thin separator line (existing `border-t` pattern).
- Detection badges (Rules, Flow, Kill Chain, Defense) remain — these are scan-critical for coverage assessment.
- UUID moves to card hover tooltip (not scan-critical).
- Platform target badges move up to the metadata row (Tier 2), removing duplication from the footer.

**Action buttons** (Heart, Play) remain in their current top-right position, arranged vertically above the score badge: `[Heart] [Play]` on one line, score badge below. The score badge is the visual anchor of that corner.

**Tooltips:** Author, dates, and UUID use native `title` attributes (not custom tooltip components) to keep scope minimal. The card's outer `<div>` gets a `title` with author + created date + UUID. This is a single tooltip on the card container, not per-element tooltips.

#### List View (`TestListRow.tsx`)

A new component providing a condensed row layout as an alternative to the card grid:

```
[SEVERITY] Title                                              [Score]
           T1505.003  T1071.003  T1556.002  +1more        ● Win
```

**Structure:**
- Primary row: Severity pill (fixed-width, ~52px) + Title (flex-1, truncated) + Score badge (right-aligned)
- Secondary row: Technique badges (indented to align with title) + Platform target (right-aligned)
- Row hover: Same `hover:bg-accent` pattern used elsewhere in the app
- Row height: ~60-70px (vs ~200px for cards), showing 3-4x more tests per screen

**Integration:**
- View mode toggle added to the filter bar, after the sort direction button and before the Select mode button
- Two icon buttons: `LayoutGrid` (current card view) and `List` (new list view), using Lucide icons
- Active state: `bg-accent` highlight on the selected mode icon
- Preference persisted to `localStorage` key `achilles-browse-view-mode` (`'grid' | 'list'`)
- Both views consume the same `filteredTests` array — no logic changes, only rendering
- Select mode (checkbox) works in both views
- Favorite heart and execute button available in both views (list view shows them on hover or as inline icons)

### Test Detail Sidebar: Prioritized Accordion

#### New Component: `CollapsibleSection.tsx`

Location: `frontend/src/components/browser/CollapsibleSection.tsx`

```typescript
interface CollapsibleSectionProps {
  icon: LucideIcon;
  label: string;
  sectionKey: string;        // Stable slug for localStorage (e.g., 'docs', 'build')
  itemCount?: number;        // Optional — shown as badge when provided
  defaultOpen?: boolean;
  isActive?: boolean;        // Auto-expand when active file belongs to this section
  children: React.ReactNode;
}
```

**Behavior:**
- Click header to toggle expand/collapse
- Chevron icon rotates: `ChevronRight` (collapsed) → `ChevronDown` (expanded), with `transition-transform duration-200`
- Item count badge (small `bg-muted` rounded pill) shown next to the label — visible in both states, useful at-a-glance when collapsed
- Collapsed state: header only, content hidden with `overflow-hidden` and height animation
- Open/close state persisted to `localStorage` key `achilles-sidebar-${sectionKey}` (uses stable slug, not display label) so sections remember their state across page navigations
- Collapsed sections render at reduced opacity (`opacity-60`) on the header text/icon to visually recede

**Height animation:** Use CSS `grid-template-rows: 0fr` / `1fr` transition pattern (works reliably with `overflow: hidden` on the inner div). This avoids the `max-height` hack which requires guessing a max value.

#### Section Reordering

Current order in `TestDetailPage.tsx` (lines 404-576):
1. Documentation
2. Visualization
3. Defense Guidance
4. Source Code
5. Build
6. Detection Rules
7. Configuration

**New order:**
1. Documentation (`defaultOpen: true`)
2. Build (`defaultOpen: true`)
3. Visualization (`defaultOpen: false`)
4. Defense Guidance (`defaultOpen: false`)
5. Source Code (`defaultOpen: false`)
6. Detection Rules (`defaultOpen: false`)
7. Configuration (`defaultOpen: false`)

Build moves from position 5 to position 2 — directly below Documentation. This places the two primary workflow sections together at the top with zero scrolling.

#### Section-Specific Notes

**`itemCount` mapping per section:**
| Section | `itemCount` source | `sectionKey` |
|---------|-------------------|--------------|
| Documentation | `documentationFiles.length` | `docs` |
| Build | omitted (no count badge) | `build` |
| Visualization | count of available diagrams (0-2) | `visuals` |
| Defense Guidance | `defenseFiles.length` | `defense` |
| Source Code | `sourceFiles.length` | `source` |
| Detection Rules | `detectionFiles.length` | `rules` |
| Configuration | `configFiles.length` | `config` |

**BuildSection header deduplication:** `BuildSection.tsx` renders its own `<h3>` header (icon + "Build" label) at line 187-189. When wrapped in `CollapsibleSection`, this would duplicate the heading. Fix: remove the internal `<h3>` from `BuildSection.tsx` — the `CollapsibleSection` wrapper provides the header. This moves `BuildSection.tsx` to the "Files to Modify" list.

#### Auto-Expand on Active Selection

When `activeView` or `selectedFile` changes to a file that belongs to a collapsed section, that section auto-expands. Implementation:

- Each `CollapsibleSection` receives an `isActive` prop (boolean)
- When `isActive` transitions from `false` to `true`, the section expands (via `useEffect`)
- The parent (`TestDetailPage`) computes `isActive` by checking if the currently selected file belongs to that section's file list

This prevents the confusing state where a user navigates to a file (e.g., via a link) but its sidebar section is collapsed.

**`isActive` mapping per section:**
- Documentation, Defense Guidance, Source Code, Detection Rules, Configuration: `activeView === 'file' && sectionFileList.includes(selectedFile)`
- Visualization: `activeView === 'attack-flow' || activeView === 'kill-chain'`
- Build: no `isActive` trigger (always user-initiated)

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/browser/TestListRow.tsx` | List view row component |
| `frontend/src/components/browser/CollapsibleSection.tsx` | Reusable accordion section |

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/browser/TestCard.tsx` | Visual hierarchy restyling (score badge, severity pill, metadata simplification, description clamp, footer cleanup). Props interface unchanged. |
| `frontend/src/components/browser/TechniqueBadge.tsx` | Add `xs` size variant (`px-1 py-0.5 text-[9px]`) to the size prop union |
| `frontend/src/components/browser/BuildSection.tsx` | Remove internal `<h3>` header (lines 187-189) — `CollapsibleSection` wrapper provides the header |
| `frontend/src/pages/browser/BrowserHomePage.tsx` | Add view mode toggle (grid/list), render `TestListRow` in list mode, persist preference |
| `frontend/src/pages/browser/TestDetailPage.tsx` | Wrap sidebar sections in `CollapsibleSection`, reorder sections, add `isActive` computation |

## Files NOT Modified

- `TargetBadge.tsx` — unchanged
- Backend — no changes, purely frontend visual work
- Types — no changes

## Testing

- Visual verification in browser (all three themes: Default, Neobrutalism, Hacker Terminal)
- Existing frontend tests should pass unchanged (no logic changes)
- Manual checks:
  - Card grid view renders correctly with new hierarchy
  - List view toggle works and persists preference
  - Select mode works in both grid and list views
  - Sidebar sections collapse/expand with animation
  - Section state persists across page navigation (click into test, back, click another test)
  - Auto-expand works when navigating to a file in a collapsed section
  - Build section renders correctly inside CollapsibleSection wrapper
  - Responsive behavior: cards collapse to 1-column on mobile, list view adapts

## Out of Scope

- No backend changes
- No new API endpoints
- No changes to the test detail header (compact/full header behavior)
- No changes to the right panel content viewer
- No changes to Matrix or Overview tabs
- No mobile-specific redesign (existing responsive behavior is preserved)
