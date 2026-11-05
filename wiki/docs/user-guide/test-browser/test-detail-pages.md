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

![Test detail — header with severity, stages and test score, the file tree, and the rendered README](/img/screenshots/test-detail.png)

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

Documents render at the console's normal text size. A document's first heading
is dropped when it only repeats the test name shown in the header.

On narrow screens the tab row scrolls sideways.

### Overview

The Overview tab has a main column and a side column (the side column moves
under the main column on narrow screens):

- **Summary**: the test's description.
- **Stages** (multi-stage tests): one card per stage, in order, with its stage
  number, name and ATT&CK technique chips. Chains longer than six stages wrap
  onto a second row. When the test info card records a lab result for a stage
  it shows under the card ("blocked in lab", "ran in lab"), along with the
  stage's time budget. Cyber-hygiene bundles show one collapsible group per
  validator instead, and single-binary tests show a **What it does** card with
  their technique chips.
- **Expected outcomes**: what each result means for this test, with its exit
  code (126, 105 and 127 protected; 101 unprotected; 999 error).
- **Safety**: the safeguards the test runs under. **Full safety** opens the
  document they come from.
- **Detection**: the first four rows of the detection audit. **All n** opens
  the Info card tab.
- **Deploy**: the build panel (platform, signing, size, embedded files, build,
  download, rebuild and delete). Shown only if you can build tests and the test
  has source code. See [Building & Signing](./building-signing).
- **Quality**: the test's quality score (realism out of 7 and structure out of
  3, or the older five-part breakdown) and how it was validated.
- **Ships with**: the detection rules and defense files that come with the
  test. Click one to open it in its tab.
- **Source**: the primary report the test is based on.

Panels without data are not shown.

![Test detail page — kill chain diagram with stage progression, file tree, and build artifacts](/img/screenshots/test-detail-killchain.png)

### Source tab
Go source code with syntax highlighting. Copy-to-clipboard is available for the
entire file.

![Source code viewer — Go source with syntax highlighting](/img/screenshots/test-detail-source.png)

### Detection tab
Detection rules for the test's activity. Copy individual rules to the clipboard
for use in your SIEM or EDR.

![Detection rules — LimaCharlie D&R YAML with syntax highlighting beside the test's file tree](/img/screenshots/test-detail-detection.png)

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
