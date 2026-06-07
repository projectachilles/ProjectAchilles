<!-- gitnexus:start -->
# GitNexus MCP

This project is indexed by GitNexus as **ProjectAchilles** (13953 symbols, 32240 relationships, 300 execution flows).

## Always Start Here

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- impeccable:start -->
# Design Context

This project's frontend design system is documented for agents by the
`impeccable` skill. Read these **before** designing, building, or critiquing any
UI (pages, components, dashboards, settings, themes):

- **`PRODUCT.md`** (project root) — strategic: register (`product`), users,
  product purpose, brand personality, anti-references, design principles, and the
  WCAG 2.2 AA accessibility bar.
- **`DESIGN.md`** (project root) — visual: design tokens, the "Situation Room"
  North Star, color/typography/elevation/component specs, and named rules
  (the Skin Rule, the Status Rule, the Three-Face Ceiling, the Flat-At-Rest Rule).

**These files are gitignored (local working docs), so they may be absent on a
fresh clone.** If missing, regenerate with `$impeccable init` (strategic) and
`$impeccable document` (visual), or treat the existing `frontend/src/styles/index.css`
token system as the source of truth in the meantime.

Core invariants either file will tell you, summarized: identity is
**theme-agnostic** (it lives in the structural theme-token layer + status
semantics, never a single hue — three themes share one component set); status
color is **always doubled** by icon/label/shape; surfaces are **flat at rest,
kinetic on interaction**; never hard-code a hex/oklch literal in a component.
<!-- impeccable:end -->

