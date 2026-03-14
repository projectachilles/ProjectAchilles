# Test Browser Visual Enhancements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle test browser cards for clearer visual hierarchy, add a list view toggle, and make the test detail sidebar collapsible with prioritized section ordering.

**Architecture:** Two independent workstreams — browse view (card restyling + list view toggle) and detail sidebar (collapsible accordion). Both are frontend-only, modifying existing React components and creating two new ones. No backend or type changes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Lucide icons, Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-14-test-browser-visual-enhancements-design.md`

---

## Chunk 1: Browse View — Card Restyling + List View

### Task 1: Add `xs` size variant to TechniqueBadge

**Files:**
- Modify: `frontend/src/components/browser/TechniqueBadge.tsx`
- Test: `frontend/src/components/browser/__tests__/TechniqueBadge.test.tsx`

- [ ] **Step 1: Write tests for all TechniqueBadge size variants**

Create test file `frontend/src/components/browser/__tests__/TechniqueBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TechniqueBadge from '../TechniqueBadge';

describe('TechniqueBadge', () => {
  it('renders technique text', () => {
    render(<TechniqueBadge technique="T1505.003" />);
    expect(screen.getByText('T1505.003')).toBeInTheDocument();
  });

  it('applies md size by default', () => {
    render(<TechniqueBadge technique="T1505.003" />);
    const el = screen.getByText('T1505.003');
    expect(el.className).toContain('text-xs');
    expect(el.className).toContain('px-2');
  });

  it('applies sm size', () => {
    render(<TechniqueBadge technique="T1505.003" size="sm" />);
    const el = screen.getByText('T1505.003');
    expect(el.className).toContain('text-[10px]');
    expect(el.className).toContain('px-1.5');
  });

  it('applies xs size', () => {
    render(<TechniqueBadge technique="T1505.003" size="xs" />);
    const el = screen.getByText('T1505.003');
    expect(el.className).toContain('text-[9px]');
    expect(el.className).toContain('px-1');
  });

  it('has monospace font', () => {
    render(<TechniqueBadge technique="T1505.003" />);
    const el = screen.getByText('T1505.003');
    expect(el.className).toContain('font-mono');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest src/components/browser/__tests__/TechniqueBadge.test.tsx --run`
Expected: FAIL — the `xs` size test fails because the variant doesn't exist yet.

- [ ] **Step 3: Add `xs` size variant to TechniqueBadge**

Modify `frontend/src/components/browser/TechniqueBadge.tsx`:

Change the `size` prop type from `'sm' | 'md'` to `'xs' | 'sm' | 'md'`.

Replace the `sizeClasses` ternary with a lookup:

```tsx
interface TechniqueBadgeProps {
  technique: string;
  size?: 'xs' | 'sm' | 'md';
}

export default function TechniqueBadge({ technique, size = 'md' }: TechniqueBadgeProps) {
  const sizeClasses = {
    xs: 'px-1 py-0.5 text-[9px]',
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-1 text-xs',
  }[size];

  return (
    <span className={`inline-flex items-center rounded-md bg-primary/10 text-primary font-mono font-medium ${sizeClasses}`}>
      {technique}
    </span>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest src/components/browser/__tests__/TechniqueBadge.test.tsx --run`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/browser/TechniqueBadge.tsx frontend/src/components/browser/__tests__/TechniqueBadge.test.tsx
git commit -m "feat(browser): add xs size variant to TechniqueBadge"
```

---

### Task 2: Restyle TestCard visual hierarchy

**Files:**
- Modify: `frontend/src/components/browser/TestCard.tsx:18-182`

This task restructures the existing `TestCard` component into three visual tiers without changing its props interface or the data it displays.

- [ ] **Step 1: Rewrite the TestCard component**

Replace the entire function body in `frontend/src/components/browser/TestCard.tsx`. Key changes:

**Severity colors** — change from text-only classes to filled pill badge classes:

```tsx
const severityBadgeColors: Record<string, string> = {
  'critical': 'bg-red-500 text-white',
  'high': 'bg-orange-500 text-white',
  'medium': 'bg-yellow-500 text-black',
  'low': 'bg-blue-500 text-white',
  'informational': 'bg-gray-500 text-white',
};
```

**Card tooltip** — combine author, date, and UUID into a single native `title` on the card outer div:

```tsx
const tooltipParts = [
  test.author && `Author: ${test.author}`,
  test.createdDate && `Created: ${test.createdDate}`,
  test.lastModifiedDate && `Modified: ${formatRelativeDate(test.lastModifiedDate)}`,
  `UUID: ${test.uuid}`,
].filter(Boolean).join('\n');
```

Add `title={tooltipParts}` to the outer `<div>`.

**Header restructure** — Title on left, action buttons + score badge stacked on right:

```tsx
{/* Header */}
<div className="mb-3">
  <div className="flex items-start justify-between gap-2 mb-2">
    <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">
      {test.name}
    </h3>
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      {/* Action buttons row */}
      <div className="flex items-center gap-1">
        {onToggleFavorite && (
          <button onClick={onToggleFavorite} className="p-1 rounded-md hover:bg-accent transition-colors"
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
            <Heart className={`w-4 h-4 transition-colors ${isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`} />
          </button>
        )}
        {onExecute && !selectMode && (
          <button onClick={onExecute} className="p-1 rounded-md hover:bg-accent transition-colors" title="Execute test">
            <Play className="w-4 h-4 text-primary" />
          </button>
        )}
      </div>
      {/* Score badge */}
      {test.score && (
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
          <span className="text-lg font-extrabold text-black">{test.score.toFixed(1)}</span>
        </div>
      )}
    </div>
  </div>

  {/* Metadata Row — Tier 2 */}
  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
    {test.severity && (
      <span className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded ${severityBadgeColors[test.severity.toLowerCase()] || 'bg-gray-500 text-white'}`}>
        {test.severity}
      </span>
    )}
    {test.isMultiStage && (
      <div className="flex items-center gap-1">
        <Layers className="w-3 h-3" />
        <span>{test.stageCount || test.techniques.length} stages</span>
      </div>
    )}
    {test.target && test.target.length > 0 && (
      <div className="flex items-center gap-1.5">
        {test.target.slice(0, 3).map(t => (
          <TargetBadge key={t} target={t} />
        ))}
        {test.target.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{test.target.length - 3}</span>
        )}
      </div>
    )}
  </div>
</div>
```

**Description** — change `line-clamp-2` to `line-clamp-1`:

```tsx
{test.description && (
  <p className="text-sm text-muted-foreground mb-3 line-clamp-1">
    {test.description}
  </p>
)}
```

**Techniques** — use `xs` size and wrap in opacity container:

```tsx
<div className="flex flex-wrap gap-1.5 mb-3 opacity-70">
  {test.techniques.slice(0, 4).map(technique => (
    <TechniqueBadge key={technique} technique={technique} size="xs" />
  ))}
  {test.techniques.length > 4 && (
    <span className="text-[9px] text-muted-foreground px-1 py-0.5">
      +{test.techniques.length - 4} more
    </span>
  )}
</div>
```

**Footer** — remove UUID and platform targets (moved to tooltip and metadata row respectively):

```tsx
<div className="flex items-center gap-3 text-xs text-muted-foreground pt-3 border-t-[length:var(--theme-border-width)] border-border">
  {test.hasDetectionFiles && (
    <div className="flex items-center gap-1 text-blue-500" title="Detection rules included">
      <Shield className="w-3 h-3" />
      <span className="text-[10px] font-medium">Rules</span>
    </div>
  )}
  {test.hasAttackFlow && (
    <div className="flex items-center gap-1 text-purple-500" title="Attack flow diagram available">
      <Workflow className="w-3 h-3" />
      <span className="text-[10px] font-medium">Flow</span>
    </div>
  )}
  {test.hasKillChain && (
    <div className="flex items-center gap-1 text-orange-500" title="Kill chain diagram available">
      <Workflow className="w-3 h-3" />
      <span className="text-[10px] font-medium">Kill Chain</span>
    </div>
  )}
  {test.hasDefenseGuidance && (
    <div className="flex items-center gap-1 text-green-500" title="Defense guidance available">
      <ShieldCheck className="w-3 h-3" />
      <span className="text-[10px] font-medium">Defense</span>
    </div>
  )}
</div>
```

Remove unused imports: `FileCode2`, `Calendar`, `User`, `Clock`, `Star` (no longer used directly — score badge uses raw text, star icon removed). Also remove `formatFullDate` — the tooltip only uses `formatRelativeDate`. Keep `formatRelativeDate` for the tooltip.

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Visual verification in browser**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles && ./scripts/start.sh -k --daemon`
Navigate to `http://localhost:5173/dashboard?tab=browse` and verify:
- Title is the dominant element (large, bold)
- Severity shows as a colored pill badge (not plain text)
- Score is a gradient amber/orange block in the top-right corner
- Description is single-line truncated
- Techniques are smaller and slightly faded
- Footer has detection badges only (no UUID, no platform targets)
- Hovering the card shows a tooltip with author, dates, and UUID
- Check all three themes: Default Dark, Neobrutalism, Hacker Terminal

- [ ] **Step 4: Run existing frontend tests**

Run: `cd frontend && npm test`
Expected: All 127 tests pass (no logic changes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/browser/TestCard.tsx
git commit -m "feat(browser): restyle TestCard with layered visual hierarchy"
```

---

### Task 3: Create TestListRow component

**Files:**
- Create: `frontend/src/components/browser/TestListRow.tsx`
- Create: `frontend/src/components/browser/__tests__/TestListRow.test.tsx`

- [ ] **Step 1: Write tests for TestListRow**

Create test file `frontend/src/components/browser/__tests__/TestListRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TestListRow from '../TestListRow';
import type { TestMetadata } from '@/types/test';

const baseTest: TestMetadata = {
  uuid: '5691f436-e630-4fd2-b930-911023cf638f',
  name: 'APT34 Exchange Server Weaponization',
  description: 'Simulates APT34 techniques',
  severity: 'critical',
  techniques: ['T1505.003', 'T1071.003', 'T1556.002', 'T1048.003', 'T1078'],
  score: 9.4,
  isMultiStage: true,
  stageCount: 4,
  stages: [],
  target: ['windows'],
  createdDate: '2026-03-07',
  lastModifiedDate: '2026-03-07',
  author: 'sectest-builder',
  hasDetectionFiles: true,
  hasAttackFlow: false,
  hasKillChain: true,
  hasDefenseGuidance: true,
  category: 'intel-driven',
};

describe('TestListRow', () => {
  it('renders test name', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} />);
    expect(screen.getByText('APT34 Exchange Server Weaponization')).toBeInTheDocument();
  });

  it('renders severity badge', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} />);
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
  });

  it('renders score', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} />);
    expect(screen.getByText('9.4')).toBeInTheDocument();
  });

  it('renders technique badges (max 4 + overflow)', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} />);
    expect(screen.getByText('T1505.003')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<TestListRow test={baseTest} onClick={onClick} />);
    await userEvent.click(screen.getByText('APT34 Exchange Server Weaponization'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders checkbox in select mode', () => {
    render(<TestListRow test={baseTest} onClick={vi.fn()} selectMode selected={false} onToggleSelect={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders without score when not provided', () => {
    const testNoScore = { ...baseTest, score: undefined };
    render(<TestListRow test={testNoScore} onClick={vi.fn()} />);
    expect(screen.queryByText('9.4')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest src/components/browser/__tests__/TestListRow.test.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Create TestListRow component**

Create `frontend/src/components/browser/TestListRow.tsx`:

```tsx
import type { TestMetadata } from '@/types/test';
import { Heart, Play } from 'lucide-react';
import TechniqueBadge from './TechniqueBadge';
import TargetBadge from './TargetBadge';

interface TestListRowProps {
  test: TestMetadata;
  onClick: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onExecute?: (e: React.MouseEvent) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
}

const severityBadgeColors: Record<string, string> = {
  'critical': 'bg-red-500 text-white',
  'high': 'bg-orange-500 text-white',
  'medium': 'bg-yellow-500 text-black',
  'low': 'bg-blue-500 text-white',
  'informational': 'bg-gray-500 text-white',
};

export default function TestListRow({ test, onClick, isFavorite, onToggleFavorite, onExecute, selectMode, selected, onToggleSelect }: TestListRowProps) {
  return (
    <div
      onClick={selectMode ? onToggleSelect : onClick}
      className={`group cursor-pointer px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors relative ${selectMode ? 'pl-10' : ''} ${selected ? 'bg-primary/5' : ''}`}
    >
      {/* Select mode checkbox */}
      {selectMode && (
        <div className="absolute left-3 top-4">
          <input
            type="checkbox"
            className="h-4 w-4 appearance-auto accent-primary cursor-pointer"
            checked={selected}
            onChange={() => {}}
            onClick={onToggleSelect}
          />
        </div>
      )}

      {/* Primary row: Severity + Title + Actions + Score */}
      <div className="flex items-center gap-3">
        {test.severity && (
          <span className={`font-bold uppercase text-[10px] px-2 py-0.5 rounded min-w-[52px] text-center shrink-0 ${severityBadgeColors[test.severity.toLowerCase()] || 'bg-gray-500 text-white'}`}>
            {test.severity}
          </span>
        )}
        <span className="font-semibold text-sm truncate flex-1 group-hover:text-primary transition-colors">
          {test.name}
        </span>

        {/* Hover actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onToggleFavorite && (
            <button onClick={onToggleFavorite} className="p-1 rounded-md hover:bg-accent transition-colors"
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
              <Heart className={`w-3.5 h-3.5 transition-colors ${isFavorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground hover:text-red-400'}`} />
            </button>
          )}
          {onExecute && !selectMode && (
            <button onClick={onExecute} className="p-1 rounded-md hover:bg-accent transition-colors" title="Execute test">
              <Play className="w-3.5 h-3.5 text-primary" />
            </button>
          )}
        </div>

        {/* Score */}
        {test.score && (
          <div className="w-9 h-9 rounded-md bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
            <span className="text-sm font-extrabold text-black">{test.score.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Secondary row: Techniques + Platform */}
      <div className="flex items-center gap-2 mt-1.5 pl-[64px]">
        <div className="flex flex-wrap gap-1 flex-1">
          {test.techniques.slice(0, 4).map(technique => (
            <TechniqueBadge key={technique} technique={technique} size="xs" />
          ))}
          {test.techniques.length > 4 && (
            <span className="text-[9px] text-muted-foreground px-1 py-0.5">
              +{test.techniques.length - 4} more
            </span>
          )}
        </div>
        {test.target && test.target.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            {test.target.slice(0, 2).map(t => (
              <TargetBadge key={t} target={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest src/components/browser/__tests__/TestListRow.test.tsx --run`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/browser/TestListRow.tsx frontend/src/components/browser/__tests__/TestListRow.test.tsx
git commit -m "feat(browser): add TestListRow component for list view"
```

---

### Task 4: Add view mode toggle to BrowserHomePage

**Files:**
- Modify: `frontend/src/pages/browser/BrowserHomePage.tsx`

- [ ] **Step 1: Add view mode state and imports**

In `frontend/src/pages/browser/BrowserHomePage.tsx`:

Add `List` to the Lucide imports on line 17 (alongside existing `LayoutGrid`).

Add `TestListRow` import after `TestCard` import (line 6):

```tsx
import TestListRow from '@/components/browser/TestListRow';
```

Add view mode type after the existing type declarations (~line 23):

```tsx
type ViewMode = 'grid' | 'list';
```

Inside the component function, add state for view mode (persisted to localStorage):

```tsx
const [viewMode, setViewMode] = useState<ViewMode>(() => {
  return (localStorage.getItem('achilles-browse-view-mode') as ViewMode) || 'grid';
});

const handleViewModeChange = (mode: ViewMode) => {
  setViewMode(mode);
  localStorage.setItem('achilles-browse-view-mode', mode);
};
```

- [ ] **Step 2: Add view mode toggle buttons to the filter bar**

In the filter controls area (~line 480, after the sort direction button and before the Select mode section), add a separator and view toggle:

```tsx
{/* Separator */}
<div className="h-5 w-px bg-border mx-1" />

{/* View Mode Toggle */}
<div className="flex items-center border border-border rounded-base overflow-hidden">
  <button
    onClick={() => handleViewModeChange('grid')}
    className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}
    title="Grid view"
  >
    <LayoutGrid className="w-4 h-4" />
  </button>
  <button
    onClick={() => handleViewModeChange('list')}
    className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}
    title="List view"
  >
    <List className="w-4 h-4" />
  </button>
</div>
```

- [ ] **Step 3: Render list or grid based on view mode**

Replace the card grid rendering (~line 535) with a conditional:

```tsx
{viewMode === 'grid' ? (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
    {filteredTests.map(test => (
      <TestCard
        key={test.uuid}
        test={test}
        onClick={() => navigate(`/browser/test/${test.uuid}`)}
        isFavorite={isFavorite(test.uuid)}
        onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(test.uuid); }}
        onExecute={canCreateTasks ? (e) => handleExecuteTest(test, e) : undefined}
        selectMode={selectMode}
        selected={selectedTestUuids.has(test.uuid)}
        onToggleSelect={(e) => handleToggleTestSelection(test.uuid, e)}
      />
    ))}
  </div>
) : (
  <div className="rounded-base border-theme border-border bg-card shadow-theme overflow-hidden mb-6">
    {filteredTests.map(test => (
      <TestListRow
        key={test.uuid}
        test={test}
        onClick={() => navigate(`/browser/test/${test.uuid}`)}
        isFavorite={isFavorite(test.uuid)}
        onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(test.uuid); }}
        onExecute={canCreateTasks ? (e) => handleExecuteTest(test, e) : undefined}
        selectMode={selectMode}
        selected={selectedTestUuids.has(test.uuid)}
        onToggleSelect={(e) => handleToggleTestSelection(test.uuid, e)}
      />
    ))}
  </div>
)}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Visual verification**

Navigate to `http://localhost:5173/dashboard?tab=browse`:
- View toggle buttons appear in the filter bar (grid icon, list icon)
- Grid mode shows restyled cards in a 3-column grid
- List mode shows condensed rows with severity + title + score inline
- Switching modes is instant and persists on page refresh
- Select mode checkboxes work in both views
- Filtering and sorting work identically in both views

- [ ] **Step 6: Run all frontend tests**

Run: `cd frontend && npm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/browser/BrowserHomePage.tsx
git commit -m "feat(browser): add grid/list view mode toggle to browse page"
```

---

## Chunk 2: Test Detail Sidebar — Prioritized Accordion

### Task 5: Create CollapsibleSection component

**Files:**
- Create: `frontend/src/components/browser/CollapsibleSection.tsx`
- Create: `frontend/src/components/browser/__tests__/CollapsibleSection.test.tsx`

- [ ] **Step 1: Write tests for CollapsibleSection**

Create `frontend/src/components/browser/__tests__/CollapsibleSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollapsibleSection from '../CollapsibleSection';
import { FileText } from 'lucide-react';

// Clear localStorage before each test
beforeEach(() => {
  localStorage.clear();
});

describe('CollapsibleSection', () => {
  it('renders label text', () => {
    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs">
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Documentation')).toBeInTheDocument();
  });

  it('shows children when defaultOpen is true', () => {
    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs" defaultOpen>
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Content')).toBeVisible();
  });

  it('hides children when defaultOpen is false', () => {
    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs" defaultOpen={false}>
        <div>Content</div>
      </CollapsibleSection>
    );
    // Content exists in DOM but is hidden via grid-template-rows: 0fr
    const content = screen.getByText('Content');
    expect(content.closest('[data-collapsed="true"]')).toBeTruthy();
  });

  it('toggles open/closed on header click', async () => {
    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs" defaultOpen={false}>
        <div>Content</div>
      </CollapsibleSection>
    );

    // Initially collapsed
    expect(screen.getByText('Content').closest('[data-collapsed="true"]')).toBeTruthy();

    // Click to expand
    await userEvent.click(screen.getByText('Documentation'));
    expect(screen.getByText('Content').closest('[data-collapsed="false"]')).toBeTruthy();

    // Click to collapse again
    await userEvent.click(screen.getByText('Documentation'));
    expect(screen.getByText('Content').closest('[data-collapsed="true"]')).toBeTruthy();
  });

  it('displays item count badge when provided', () => {
    render(
      <CollapsibleSection icon={FileText} label="Source Code" sectionKey="source" itemCount={8}>
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('does not display item count badge when omitted', () => {
    render(
      <CollapsibleSection icon={FileText} label="Build" sectionKey="build">
        <div>Content</div>
      </CollapsibleSection>
    );
    // No numeric badge present
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('persists open state to localStorage', async () => {
    render(
      <CollapsibleSection icon={FileText} label="Docs" sectionKey="docs" defaultOpen={false}>
        <div>Content</div>
      </CollapsibleSection>
    );

    // Open the section
    await userEvent.click(screen.getByText('Docs'));

    // Check localStorage
    expect(localStorage.getItem('achilles-sidebar-docs')).toBe('true');
  });

  it('reads persisted state from localStorage on mount', () => {
    localStorage.setItem('achilles-sidebar-docs', 'true');

    render(
      <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs" defaultOpen={false}>
        <div>Content</div>
      </CollapsibleSection>
    );

    // Should be open despite defaultOpen=false, because localStorage says true
    expect(screen.getByText('Content').closest('[data-collapsed="false"]')).toBeTruthy();
  });

  it('auto-expands when isActive becomes true', () => {
    const { rerender } = render(
      <CollapsibleSection icon={FileText} label="Source" sectionKey="source" defaultOpen={false} isActive={false}>
        <div>Content</div>
      </CollapsibleSection>
    );

    // Initially collapsed
    expect(screen.getByText('Content').closest('[data-collapsed="true"]')).toBeTruthy();

    // Rerender with isActive=true
    rerender(
      <CollapsibleSection icon={FileText} label="Source" sectionKey="source" defaultOpen={false} isActive={true}>
        <div>Content</div>
      </CollapsibleSection>
    );

    // Should now be expanded
    expect(screen.getByText('Content').closest('[data-collapsed="false"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest src/components/browser/__tests__/CollapsibleSection.test.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Create CollapsibleSection component**

Create `frontend/src/components/browser/CollapsibleSection.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CollapsibleSectionProps {
  icon: LucideIcon;
  label: string;
  sectionKey: string;
  itemCount?: number;
  defaultOpen?: boolean;
  isActive?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  icon: Icon,
  label,
  sectionKey,
  itemCount,
  defaultOpen = false,
  isActive = false,
  children,
}: CollapsibleSectionProps) {
  const storageKey = `achilles-sidebar-${sectionKey}`;
  const [isOpen, setIsOpen] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) return stored === 'true';
    return defaultOpen;
  });

  const prevIsActive = useRef(isActive);

  // Auto-expand when isActive transitions to true
  useEffect(() => {
    if (isActive && !prevIsActive.current) {
      setIsOpen(true);
    }
    prevIsActive.current = isActive;
  }, [isActive]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <div>
      <button
        onClick={toggle}
        className={`w-full flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground mb-1 py-1 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-60'}`}
      >
        <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
        <Icon className="w-3 h-3" />
        <span className="flex-1 text-left">{label}</span>
        {itemCount != null && (
          <span className="text-[10px] font-normal bg-muted px-1.5 py-0.5 rounded-full">
            {itemCount}
          </span>
        )}
      </button>
      <div
        data-collapsed={!isOpen}
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest src/components/browser/__tests__/CollapsibleSection.test.tsx --run`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/browser/CollapsibleSection.tsx frontend/src/components/browser/__tests__/CollapsibleSection.test.tsx
git commit -m "feat(browser): add CollapsibleSection accordion component"
```

---

### Task 6: Remove internal header from BuildSection

**Files:**
- Modify: `frontend/src/components/browser/BuildSection.tsx:170-190`

- [ ] **Step 1: Remove the `<h3>` header from both render paths**

In `frontend/src/components/browser/BuildSection.tsx`:

**Loading state** (lines 172-176): Remove the `<h3>` block. The loading state return becomes:

```tsx
if (loading) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="w-3 h-3 animate-spin" />
      Loading...
    </div>
  );
}
```

**Main return** (lines 186-190): Remove the `<h3>` block only. Keep the outer `<div>` wrapper (it groups multiple sibling elements: hidden file inputs, dependency list, build states, action buttons). Alternatively, replace `<div>` with a Fragment (`<>...</>`), but keeping `<div>` is simpler and harmless.

Also remove the `Hammer` import from the Lucide imports (line 8) since it's no longer used here — the icon will be passed to `CollapsibleSection` from the parent.

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/browser/BuildSection.tsx
git commit -m "refactor(browser): remove internal header from BuildSection for CollapsibleSection wrapping"
```

---

### Task 7: Integrate CollapsibleSection into TestDetailPage sidebar

**Files:**
- Modify: `frontend/src/pages/browser/TestDetailPage.tsx:400-577`

- [ ] **Step 1: Add CollapsibleSection import**

In `frontend/src/pages/browser/TestDetailPage.tsx`, add import after the `BuildSection` import (line 9):

```tsx
import CollapsibleSection from '@/components/browser/CollapsibleSection';
```

Add `Hammer` to the Lucide imports on line 12 (it was removed from BuildSection and is now needed here for the CollapsibleSection icon prop).

- [ ] **Step 2: Compute isActive flags**

Inside the component function, add computed values for section active state (after the existing state declarations):

```tsx
// Sidebar section active state for auto-expand
const isDocActive = activeView === 'file' && selectedFile !== null && documentationFiles.some(f => f.name === selectedFile);
const isVisualsActive = activeView === 'attack-flow' || activeView === 'kill-chain';
const isDefenseActive = activeView === 'file' && selectedFile !== null && defenseFiles.some(f => f.name === selectedFile);
const isSourceActive = activeView === 'file' && selectedFile !== null && sourceFiles.some(f => f.name === selectedFile);
const isRulesActive = activeView === 'file' && selectedFile !== null && detectionFiles.some(f => f.name === selectedFile);
const isConfigActive = activeView === 'file' && selectedFile !== null && configFiles.some(f => f.name === selectedFile);
```

- [ ] **Step 3: Wrap each sidebar section in CollapsibleSection and reorder**

Replace the sidebar content (lines ~403-576, the `<div className="p-4 space-y-4">` contents) with the new order:

**1. Documentation** (defaultOpen: true):
```tsx
{documentationFiles.length > 0 && (
  <CollapsibleSection icon={FileText} label="Documentation" sectionKey="docs"
    itemCount={documentationFiles.length} defaultOpen isActive={isDocActive}>
    <div className="space-y-1">
      {documentationFiles.map(file => (
        <button key={file.name} onClick={() => handleFileSelect(file.name)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            selectedFile === file.name && activeView === 'file'
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-accent'
          }`}>
          {file.name === 'SAFETY.md' && <AlertTriangle className="w-3 h-3 inline mr-2 text-orange-500" />}
          {file.name}
        </button>
      ))}
    </div>
  </CollapsibleSection>
)}
```

**2. Build** (defaultOpen: true):
```tsx
{canBuild && sourceFiles.length > 0 && uuid && (
  <CollapsibleSection icon={Hammer} label="Build" sectionKey="build" defaultOpen>
    <BuildSection uuid={uuid} />
  </CollapsibleSection>
)}
```

**3. Visualization** (defaultOpen: false):
```tsx
{(test.hasAttackFlow || test.hasKillChain) && (
  <CollapsibleSection icon={Workflow} label="Visualization" sectionKey="visuals"
    itemCount={(test.hasAttackFlow ? 1 : 0) + (test.hasKillChain ? 1 : 0)}
    isActive={isVisualsActive}>
    <div className="space-y-1">
      {test.hasAttackFlow && (
        <button onClick={handleAttackFlowClick}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            activeView === 'attack-flow' ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
          }`}>
          Attack Flow Diagram
        </button>
      )}
      {test.hasKillChain && (
        <button onClick={handleKillChainClick}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            activeView === 'kill-chain' ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
          }`}>
          Kill Chain Diagram
        </button>
      )}
    </div>
  </CollapsibleSection>
)}
```

**4. Defense Guidance** (defaultOpen: false):
```tsx
{defenseFiles.length > 0 && (
  <CollapsibleSection icon={ShieldCheck} label="Defense Guidance" sectionKey="defense"
    itemCount={defenseFiles.length} isActive={isDefenseActive}>
    <div className="space-y-1">
      {defenseFiles.map(file => (
        <button key={file.name} onClick={() => handleFileSelect(file.name)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
            selectedFile === file.name && activeView === 'file'
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-accent'
          }`}>
          {file.name.includes('DEFENSE_GUIDANCE') && <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
          {file.name.includes('_dr_rules') && <span className="w-2 h-2 rounded-full bg-cyan-500 flex-shrink-0" />}
          {file.name.includes('_hardening') && <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
          {getDefenseFileDisplayName(file.name)}
        </button>
      ))}
    </div>
  </CollapsibleSection>
)}
```

**5. Source Code** (defaultOpen: false):
```tsx
{sourceFiles.length > 0 && (
  <CollapsibleSection icon={Code} label="Source Code" sectionKey="source"
    itemCount={sourceFiles.length} isActive={isSourceActive}>
    <div className="space-y-1">
      {sourceFiles.map(file => (
        <button key={file.name} onClick={() => handleFileSelect(file.name)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm font-mono transition-colors ${
            selectedFile === file.name && activeView === 'file'
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-accent'
          }`}>
          {file.name}
        </button>
      ))}
    </div>
  </CollapsibleSection>
)}
```

**6. Detection Rules** (defaultOpen: false):
```tsx
{detectionFiles.length > 0 && (
  <CollapsibleSection icon={Shield} label="Detection Rules" sectionKey="rules"
    itemCount={detectionFiles.length} isActive={isRulesActive}>
    <div className="space-y-1">
      {detectionFiles.map(file => (
        <button key={file.name} onClick={() => handleFileSelect(file.name)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm font-mono transition-colors ${
            selectedFile === file.name && activeView === 'file'
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-accent'
          }`}>
          {file.type === 'kql' && <span className="text-xs text-blue-500 mr-2">KQL</span>}
          {file.type === 'yara' && <span className="text-xs text-purple-500 mr-2">YARA</span>}
          {file.type === 'sigma' && <span className="text-xs text-yellow-500 mr-2">SIGMA</span>}
          {file.type === 'ndjson' && <span className="text-xs text-green-500 mr-2">ELASTIC</span>}
          {file.name}
        </button>
      ))}
    </div>
  </CollapsibleSection>
)}
```

**7. Configuration** (defaultOpen: false):
```tsx
{configFiles.length > 0 && (
  <CollapsibleSection icon={Shield} label="Configuration" sectionKey="config"
    itemCount={configFiles.length} isActive={isConfigActive}>
    <div className="space-y-1">
      {configFiles.map(file => (
        <button key={file.name} onClick={() => handleFileSelect(file.name)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm font-mono transition-colors ${
            selectedFile === file.name && activeView === 'file'
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-accent'
          }`}>
          {file.name}
        </button>
      ))}
    </div>
  </CollapsibleSection>
)}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Visual verification**

Navigate to `http://localhost:5173/browser/test/<any-uuid>`:
- Documentation and Build sections are expanded by default
- All other sections are collapsed, showing section name + item count badge
- Clicking a section header toggles it open/closed with smooth animation
- Collapsed sections have reduced opacity
- Section state persists when navigating back and forward between tests
- Selecting a file auto-expands its parent section if collapsed

- [ ] **Step 6: Run all frontend tests**

Run: `cd frontend && npm test`
Expected: All tests pass (existing + new).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/browser/TestDetailPage.tsx
git commit -m "feat(browser): integrate collapsible accordion sidebar with prioritized section ordering"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full frontend test suite**

Run: `cd frontend && npm test`
Expected: All tests pass.

- [ ] **Step 2: TypeScript compilation check**

Run: `cd frontend && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Full visual verification across themes**

Start the app and check all changes across Default Dark, Neobrutalism, and Hacker Terminal themes:

1. **Browse page grid view**: Cards with layered hierarchy (score badge, severity pill, single-line description, muted techniques)
2. **Browse page list view**: Toggle to list, verify condensed rows, switch back to grid
3. **View mode persistence**: Refresh page, mode should be remembered
4. **Test detail sidebar**: Documentation + Build expanded, others collapsed with counts
5. **Sidebar persistence**: Collapse a section, navigate away and back, still collapsed
6. **Auto-expand**: Click a detection rule file from another context — Detection Rules section auto-expands
7. **Select mode**: Works in both grid and list views
