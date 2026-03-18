---
sidebar_position: 2
title: "Test Detail Pages"
description: "Explore test detail pages — source code, documentation, detection rules, references, and execution history."
---

# Test Detail Pages

Clicking any test in the browser opens its detail page with comprehensive metadata.

## Page Layout

The test detail page is organized into tabs:

### Source Tab
View the test's Go source code with syntax highlighting. Copy-to-clipboard available for the entire file.

### Documentation Tab
Rendered markdown documentation describing the test's purpose, behavior, and expected outcomes.

### Detection Rules Tab
KQL (Kusto Query Language) and YARA rules for detecting the test's activity. Copy individual rules to clipboard for use in your SIEM.

### References Tab
External references and documentation links related to the technique.

## Metadata Sidebar

The sidebar displays:
- **MITRE ATT&CK mapping** — Techniques and tactics
- **Severity** — Critical, High, Medium, or Low
- **Platforms** — Windows, Linux, macOS
- **Author** and **version history**
- **Git modification date**
- **Tags** for additional categorization

## Execution Drawer

Click the **Run** button to open the execution drawer, which allows you to:
1. Select target agent(s)
2. Choose the target platform and architecture
3. Build the test binary (if not cached)
4. Create a task for execution

## Build & Download

The **Build** button triggers Go cross-compilation for the selected platform. See [Building & Signing](./building-signing) for details.
