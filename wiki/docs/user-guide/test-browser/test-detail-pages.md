---
sidebar_position: 2
title: "Test Detail Pages"
description: "Explore test detail pages — overview, stage chain, documentation, detection rules, defense guidance, source code, and diagrams."
---

# Test Detail Pages

Clicking any test in the browser opens its detail page. The page has a fixed
header, a row of tabs, and the selected tab's content underneath.

## Page Layout

### Header

The header stays on screen whichever tab you open. It shows:

- **Breadcrumb**: `Tests / <category> / <subcategory>`. **Tests** returns to the
  list with the filters you had set.
- **Title** with a **severity** pill (critical, high, medium, low).
- **One metadata line**: threat actor, platforms, stage count, complexity,
  author, when the test was last modified (hover for the full date and last
  commit message), and the short test ID with a copy button.
- **Actions**: test score, favourite, **Download** (when a build exists and you
  can build tests) and **Run on agents**, which opens the
  [execution drawer](#execution-drawer).

![Test detail — header with severity, stages and test score above the tab row and the Overview](/img/screenshots/test-detail.png)

### Tabs

Tabs replace the old file sidebar. A tab is shown only when the test has files
for it:

| Tab | Contents |
|-----|----------|
| **Overview** | Default tab; see [Overview](#overview) |
| **README** | `README.md`, plus `SAFETY.md` when present |
| **Info card** | The test's info card |
| **Detection** | Detection rules (Defender KQL, YARA, Sigma, Elastic EQL, LimaCharlie D&R) |
| **Defense** | Defense guide, D&R rules and hardening scripts |
| **References** | External references and sources |
| **Source** | Go source, configuration and other documentation files |
| **Kill chain** / **Attack flow** | The test's diagram, when it has one |

Tabs with several files show a count and list their files by a readable name
above the viewer (for example **YARA** instead of `<uuid>_rules.yar`; hover a
name to see the file name). The selected tab and file are part of the page
URL (`?tab=defense&file=…`), so you can share a link to a specific document,
and the browser's Back button returns to the previous tab.

Documents render at the console's normal text size, with prose kept to a
comfortable line length; wide tables and code blocks use the full width and
scroll sideways when needed. A document's first heading is dropped when it only
repeats the test name shown in the header. A link to a file the tab doesn't
have opens the tab's first file and corrects the URL.

On narrow screens the tab row scrolls sideways.

### Overview

The Overview tab has a main column and a side column (the side column moves
under the main column on narrow screens):

- **Summary**: the test's description.
- **Techniques**: the test's ATT&CK technique chips that no stage card already
  shows (for cyber-hygiene bundles, all of them). Hidden when every technique
  is on a stage card.
- **Stages** (multi-stage tests): one card per stage, in order, with its stage
  number, name and ATT&CK technique chips. Chains longer than six stages wrap
  onto a second row; a single stage uses the full width. Under each card is the
  stage's result (see [Fleet results](#fleet-results)) and its time budget.
  Cyber-hygiene bundles show one collapsible group per validator instead (or a
  flat **Controls** list when results carry no validator), and single-binary
  tests show a **What it does** card with their technique chips.
- **Expected outcomes**: what each result means for this test, with its exit
  code (126, 105 and 127 protected; 101 unprotected; 999 error). A lab
  "observed outcome" line in the README is not listed here.
- **Expected outcomes** and **Safety** sit side by side; when only one of them
  has data it takes the full width.
- **Safety**: the safeguards the test runs under. **Full safety** opens the
  document they come from.
- **Detection**: the first four rows of the detection audit. **All n** opens
  the Info card tab.
- **Deploy**: the build panel (platform, signing, size, embedded files, build,
  download, rebuild and delete). Shown only if you can build tests and the test
  has source code. See [Building & Signing](./building-signing).
- **Quality**: the test's quality score (realism out of 7 and structure out of
  3, or the older five-part breakdown) and how it was validated.
- **On your fleet · 90 d**: how the test has done on your endpoints; see
  [Fleet results](#fleet-results).
- **Ships with**: the detection rules and defense files that come with the
  test. Click one to open it in its tab.
- **Source**: the primary report the test is based on.

Panels without data are not shown.

#### Fleet results

When the test has run on your endpoints in the last 90 days, the Overview adds
fleet results. They use the same rule as the Analytics Defense Score's
*latest* basis: each host counts once, with its most recent conclusive result.

- **On your fleet · 90 d** panel: a ring and one line. For a stage chain,
  "chain stopped on *X* of *N* hosts"; for a standalone test, "stopped on *X*
  of *N* hosts"; for a cyber-hygiene bundle, "*X* of *N* control checks passing
  on *H* hosts". **Analytics →** opens Analytics filtered to this test over the
  same 90 days.
- **Stage pills**: under each stage card, a bar and "*b* blocked · *d* detected
  · *t* through", over the hosts whose latest run reported that stage. When two
  stages use the same ATT&CK technique, results can't be told apart, so both
  cards show the same numbers with a "shared with stage *n*" note. With no
  fleet runs, the card shows the lab result from the info card instead
  ("blocked in lab", "ran in lab").
- **Stopped before any stage ran**: a line above the stages counts hosts where
  the EDR killed the agent or blocked the test at launch, before any stage
  reported.
- **Other stage results**: results whose stage doesn't match a stage card (for
  example a stage file the test index doesn't recognise, or a stage from an
  older version of the test) are listed under the chain by control ID.
- **Control rows** (cyber-hygiene bundles): each validator group lists its
  controls with their pass share, "*passed* / *N* hosts".

Fleet results need the Analytics module (Elasticsearch) and a deployment that
supports them; on deployments without fleet support (such as the Vercel
serverless backend) or without Analytics they are not shown, and the Overview
falls back to lab results.

![Test detail page — Overview with the stage chain and side panels](/img/screenshots/test-detail-killchain.png)

### Source tab
Go source code with syntax highlighting. Copy-to-clipboard is available for the
entire file.

![Source code viewer — Go source with syntax highlighting](/img/screenshots/test-detail-source.png)

### Detection tab
Detection rules for the test's activity. Copy individual rules to the clipboard
for use in your SIEM or EDR.

![Detection rules — LimaCharlie D&R YAML with syntax highlighting in the Detection tab](/img/screenshots/test-detail-detection.png)

### Kill chain and Attack flow tabs
The test's diagrams, shown in a sandboxed frame. A diagram loads the first time
you open its tab.

## Execution Drawer

Click **Run on agents** to open the execution drawer, which allows you to:
1. Select target agent(s)
2. Choose the target platform and architecture
3. Build the test binary (if not cached)
4. Create a task for execution

**Run on agents** is shown only to users who can create agent tasks.

## Build & Download

The **Deploy** panel on the Overview tab triggers Go cross-compilation for the
selected platform; **Download** in the header fetches the latest build. Both
need permission to build tests. See [Building & Signing](./building-signing)
for details.
