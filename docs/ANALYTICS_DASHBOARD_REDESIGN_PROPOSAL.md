# Analytics Dashboard Redesign Proposal

**Date:** January 24, 2026
**Status:** Proposal - Pending Implementation
**Mockup:** `mockup-analytics-redesign.html` (project root)

---

## Executive Summary

This document outlines a comprehensive redesign of the ACHILLES Analytics Dashboard, transitioning from a light-themed, chart-heavy layout to a modern dark-themed interface optimized for security operations workflows. The redesign prioritizes visual hierarchy, information density, and role-based value delivery.

---

## Current State Analysis

### What's Working
- Comprehensive data coverage (defense score, trends, host analytics, technique distribution)
- Good filter system with organization/date/result filtering
- Interactive treemap for host test breadth
- Recharts-based visualizations with consistent styling

### Areas for Improvement

| Issue | Impact | Priority |
|-------|--------|----------|
| Visual hierarchy - all cards have similar weight | Hard to identify critical information | High |
| Light theme | Not optimal for extended SOC monitoring | Medium |
| Trend chart dominates top section | Doesn't provide immediate actionable insight | High |
| Basic metric cards | Missing supporting context and visual cues | Medium |
| Inconsistent color usage | Red/yellow/green meanings vary across charts | Medium |
| Treemap for host data | Difficult to compare values accurately | Low |

---

## Research Foundation

### Industry Best Practices Consulted

1. **SOC Dashboard Design**
   - Source: [ArmorPoint - SOC Dashboards: Features, Functions, and KPIs](https://armorpoint.com/2025/05/07/soc-dashboards-key-features-functions-and-kpis/)
   - Key insight: Place critical KPIs at top/left, separate high-priority alerts from secondary info

2. **Visual Hierarchy**
   - Source: [UXPin - Dashboard Design Principles](https://www.uxpin.com/studio/blog/dashboard-design-principles/)
   - Key insight: Use font sizes, colors, and placement to create clear information hierarchy

3. **Dark Mode Implementation**
   - Source: [Power BI Dark Mode Best Practices](https://lukasreese.com/2025/12/18/power-bi-dark-mode-templates/)
   - Key insight: Use deep gray (not pure black), limit accent colors to 1-2, ensure label contrast

4. **Security-Specific UX**
   - Source: [Cybersecurity Dashboard UI/UX Design Guide](https://www.aufaitux.com/blog/cybersecurity-dashboard-ui-ux-design/)
   - Key insight: Support role-based views (CISO vs SOC Analyst), highlight critical threats first

5. **Avoiding Common Pitfalls**
   - Source: [From Pew Pew Maps to Meaningful Metrics](https://cybersierra.co/blog/security-dashboard-kpis/)
   - Key insight: Focus on actionable metrics over decorative visualizations

---

## Proposed Design System

### Color Palette

```css
:root {
  /* Backgrounds */
  --bg-primary: #0a0a0b;      /* Main canvas */
  --bg-secondary: #111113;    /* Sidebar, top bar */
  --bg-card: #161618;         /* Card backgrounds */
  --bg-elevated: #1e1e21;     /* Nested elements */

  /* Borders */
  --border: #27272a;          /* Card borders */
  --border-subtle: #1f1f23;   /* Dividers */

  /* Text */
  --text-primary: #fafafa;    /* Headings, values */
  --text-secondary: #a1a1aa;  /* Body text */
  --text-muted: #71717a;      /* Labels, hints */

  /* Semantic Colors */
  --accent: #3b82f6;          /* Interactive elements, links */
  --success: #22c55e;         /* Protected, good scores (≥80%) */
  --warning: #f59e0b;         /* Moderate scores (50-79%) */
  --danger: #ef4444;          /* Bypassed, poor scores (<50%) */
}
```

### Typography Scale

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Hero Score | 56px | 700 | Semantic (score-based) |
| Section Title | 14px | 600 | text-primary |
| Card Title | 13px | 600 | text-primary |
| Metric Value | 24px | 700 | text-primary or semantic |
| Body Text | 13px | 400 | text-secondary |
| Labels | 12px | 500 | text-muted |
| Subtitles | 11px | 400 | text-muted |

### Spacing System

- **Card padding:** 16-20px
- **Grid gaps:** 12-16px
- **Section margins:** 20px

---

## Layout Specification

### Overall Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Sidebar (220px)  │  Main Content                            │
│                  │  ┌─────────────────────────────────────┐ │
│  ACHILLES        │  │ Top Bar (52px)                      │ │
│                  │  ├─────────────────────────────────────┤ │
│  MODULES         │  │ Filter Bar                          │ │
│  ├─ Tests        │  ├─────────────────────────────────────┤ │
│  ├─ Analytics ●  │  │ Hero Section                        │ │
│  └─ Endpoints    │  │ [Defense Score] [Trend Chart      ] │ │
│                  │  ├─────────────────────────────────────┤ │
│  ANALYTICS       │  │ Stats Row (4 cards)                 │ │
│  ├─ Dashboard ●  │  ├─────────────────────────────────────┤ │
│  └─ Executions   │  │ Activity + Category Row             │ │
│                  │  ├─────────────────────────────────────┤ │
│  ─────────────   │  │ Viz Grid (2 columns)                │ │
│  Settings        │  ├─────────────────────────────────────┤ │
│                  │  │ Host Grid (full width)              │ │
└─────────────────────────────────────────────────────────────┘
```

### Section Details

#### 1. Hero Section (340px + flex)

**Left: Defense Score Card**
- Overall score as large number (56px)
- Color-coded by threshold (green ≥80%, yellow 50-79%, red <50%)
- Trend indicator with delta percentage
- Breakdown: Protected | Bypassed | Total

**Right: Trend Chart**
- Compact area chart showing score over time
- Grid lines at 25%, 50%, 75%
- Average score displayed in header

#### 2. Stats Row (4 equal columns)

| Card | Icon | Primary Value | Subtitle |
|------|------|---------------|----------|
| Unique Endpoints | Monitor | Count | "Active in period" |
| Executed Tests | Tool | Count | "X unique tests" |
| Protected Rate | CheckCircle (green) | Percentage | "X of Y blocked" |
| Bypass Rate | XCircle (red) | Percentage | "X tests bypassed" |

#### 3. Activity + Category Row (2 equal columns)

**Left: Recent Test Activity**
- Feed-style list with status icons
- Protected = green check, Bypassed = red X
- Shows: Test name, Host, Technique ID, Time

**Right: Score by Category**
- Horizontal progress bars
- Color-coded by score threshold
- Categories: Cyber Hygiene, Phase-Aligned, MITRE Top 10, Intel-Driven

#### 4. Visualization Grid (2 equal columns)

**Left: Results by Error Type**
- Donut chart with center showing total
- Legend with percentages
- Colors: SUCCESS (green), BLOCKED_* (blue/purple), errors (yellow/red)

**Right: ATT&CK Technique Distribution**
- Horizontal stacked bars (protected vs bypassed)
- Technique IDs as labels
- Top 5-10 techniques shown

#### 5. Host Grid (full width)

- Card-based grid (auto-fill, min 140px)
- Each card shows: Host name, Score%, Test count
- Background color indicates score threshold
- Clickable for drill-down

---

## Component Changes

### New Components Required

```
frontend/src/pages/analytics/components/
├── DefenseScoreHero.tsx      # New hero card with breakdown
├── CompactTrendChart.tsx     # Simplified trend visualization
├── EnhancedMetricCard.tsx    # Metric card with icon/subtitle
├── ActivityFeed.tsx          # Recent activity with status icons
├── CategoryProgressBars.tsx  # Simple horizontal bars
├── HostScoreGrid.tsx         # Grid-based host visualization
```

### Modified Components

| Component | Changes |
|-----------|---------|
| `TrendChart.tsx` | Reduce height, simplify header |
| `MetricCard.tsx` | Add icon prop, subtitle prop, enhanced styling |
| `StackedBarChart.tsx` | Simplify to single-direction bars |
| `DefenseScoreByHostChart.tsx` | Replace with grid component |
| `CoverageTreemap.tsx` | Deprecate in favor of HostScoreGrid |

---

## Implementation Phases

### Phase 1: Dark Theme Foundation
- Add CSS custom properties for dark theme
- Implement theme toggle in settings
- Update Card, Button, Input base components
- **Effort:** Low | **Impact:** High

### Phase 2: Hero Section Restructure
- Create DefenseScoreHero component
- Create CompactTrendChart component
- Update dashboard grid layout
- **Effort:** Medium | **Impact:** High

### Phase 3: Enhanced Metrics
- Update MetricCard with icons and subtitles
- Add Protected Rate and Bypass Rate cards
- Implement semantic color coding
- **Effort:** Low | **Impact:** Medium

### Phase 4: Activity Feed
- Create ActivityFeed component
- Add status icons (protected/bypassed)
- Integrate with recent tests data
- **Effort:** Medium | **Impact:** Medium

### Phase 5: Host Grid
- Create HostScoreGrid component
- Implement color-coded cards
- Add click-to-drill-down functionality
- Deprecate CoverageTreemap
- **Effort:** Medium | **Impact:** Medium

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Time to answer "How are we doing?" | ~5 seconds (scroll + read) | <2 seconds (glance) |
| Above-fold information density | 4 data points | 8+ data points |
| Color consistency | Varies by chart | Unified semantic system |
| Theme support | Light only | Light + Dark |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| User familiarity disruption | Implement as opt-in "new dashboard" initially |
| Dark theme accessibility | Ensure WCAG AA contrast ratios |
| Information overload | Progressive disclosure with drill-down |
| Chart library limitations | Recharts supports all proposed visualizations |

---

## Appendix

### File References
- Mockup: `/mockup-analytics-redesign.html`
- Current Dashboard: `/frontend/src/pages/analytics/AnalyticsDashboardPage.tsx`
- Current Components: `/frontend/src/pages/analytics/components/`

### Related Resources
- Existing Tests mockup: `/mockup-redesign.html` (dark theme reference)
- UI Components: `/frontend/src/components/ui/`
- Chart Config: `/frontend/src/components/ui/chart.tsx`
