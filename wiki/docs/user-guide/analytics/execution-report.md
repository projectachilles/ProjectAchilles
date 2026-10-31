---
sidebar_position: 4
title: "Execution Report"
description: "Print a professional PDF report of everything the All Executions filters select."
---

# Execution Report

The execution report turns whatever the **All Executions** tab currently shows into a print-ready document you can save as a PDF and hand to stakeholders.

## Open a report

1. Go to **Analytics → All Executions** and set the filters you want: date range, endpoints, tests, techniques and so on.
2. Open **Export → Report (PDF)**. The report opens in a new tab with the same filters in its address, so you can bookmark it and regenerate it later. A preset such as **Last 30 days** re-resolves when you regenerate; use a custom date range to pin the window. **Back to analytics** returns to the same filters.
3. Choose **Paper** (A4 or Letter) and **Marking** (TLP level, or None), then select **Print / Save as PDF** and choose *Save as PDF* in the browser's print dialog. The report starts with A4 and TLP:AMBER and remembers your choice in this browser.

The report builds first, so **Print / Save as PDF** is enabled only once it is ready. If the build fails, the page shows the error with a **Retry** button.

The marking appears on the cover and in the bottom-left footer of every page, next to the report ID. Page numbers sit in the bottom-right corner. The footer marking, the running headers and the page numbers print in Chromium-based browsers (Chrome, Edge). Other browsers omit them and print the same pages with the marking on the cover only. The first page has no running header. The report prints its colours and bars as shown, so you do not need to tick *Background graphics*.

## What the report contains

| Section | What it shows |
|---|---|
| Cover | Organization, window, active filters, report ID, generation time and handling marking. Smaller scopes also get a column for each run. |
| Executive summary | A plain-language verdict, the Defense Score, the outcome of every stage, the campaign timeline and the lowest endpoints by stage protection rate. The median time to first EDR alert appears when an EDR vendor is configured. |
| Threat actors and ATT&CK coverage | Emulated actors with their techniques, then every technique grouped by tactic and marked Held, Partial, Gap or No verdict. Tests without their own page are listed in a table. |
| One page per test | A kill-chain flow for multi-stage bundles, or a control table for cyber-hygiene bundles and single tests. Shows the latest result on each endpoint and the most recent correlated EDR alerts. Up to 40 tests get a page. |
| Findings | Up to six techniques whose stage protection rate is below 75% (with at least three conclusive results), ranked and weighted toward exfiltration and impact, with remediation excerpts from the test's defense guidance. Also the techniques that held, the time to first EDR alert, and accepted risks when you are allowed to see them. |
| Appendix A | The execution log, newest first. A scope over 500 runs shows its newest 500 and says so. |
| Appendix B | Per-run timelines with the start, EDR alerts at their real times and the completion. Only when the scope has 25 runs or fewer. |
| Method | Outcome definitions, the Defense Score and stage protection rate, data sources and limits. |

If no execution matches the filters, the report says so and lists them instead of printing empty sections.

## Organization name

The cover, the scope table and every page header name the organization the deployment serves. It is the **full name** of the [console identity](../settings/console-identity), so an administrator sets it in **Settings → General**, and the next report picks it up.

Without a saved identity, the report uses the backend variable `CONSOLE_ORG_NAME`, then `ORGANIZATION_NAME` (see [Environment Variables](../../deployment/environment-variables)). A saved identity replaces both, so an identity saved without a full name prints no name. On Vercel, which has no console identity, only `ORGANIZATION_NAME` applies. To set the name from the environment:

- **Server install (`deploy-server.sh`):** set `ORGANIZATION_NAME` in `deploy.config.env` and re-run the installer. It rewrites `backend/.env` on every run, so a line added there by hand does not last.
- **Docker Compose:** add `ORGANIZATION_NAME=Acme Corp` to `backend/.env`, then run `docker compose up -d`. A plain `docker compose restart` keeps the old environment.
- **Render, Fly.io, Railway or Vercel:** add the variable to the backend service's environment and redeploy.

Without a name, the cover says *All organizations* and the page headers read *ProjectAchilles · Security Validation Report*.

Keep the name to 56 characters or fewer, so the page header fits on one line beside the date range. A longer name is cut with an ellipsis everywhere it appears in the report; the console itself shows up to 80 characters.

## How to read the numbers

- **Defense Score** in the report is the **executions-basis** score: protected or detected conclusive executions divided by all conclusive executions in the window. The report describes what happened during the period, so it counts every execution. The Analytics dashboard headline uses the [latest-result score](./defense-score.md#latest-result-score) instead, which counts each test × endpoint pair once, by its most recent result. **The two numbers can differ for the same filters.** That is expected: a test that failed early in the window and has passed since counts against the report but not against the dashboard. When accepted risks are excluded, the summary also prints the score before accepted risks.
- **Stage protection rate** is every other percentage: protected, prevented or detected stage results divided by conclusive stage results. Skipped bundle stages (exit code 0) are not results and are not counted. Rates are truncated to whole percents, so 74.9% prints as 74% and matches its Partial band.
- Outcomes use the same labels as the executions panel: **Protected**, **Prevented**, **Detected**, **Unprotected** and **Inconclusive**. Squares mean the stage was stopped or detected, circles mean it got through, and a hollow mark means no verdict. A dark red mark flags an unprotected exfiltration or impact stage.
- Coverage bands are **Held** at 75% or more, **Partial** from 40% to 74%, and **Gap** below 40%. A technique with no conclusive result reads **No verdict**.
- If a **Result**, **Error name** or **Exit code** filter is active, the cover says so. The rates then describe that subset, not your overall posture.
- **All time** covers every execution on record. The window starts at the first execution, and the scope lists the first and last execution dates.
- Times use your browser's time zone, and the cover names it. Archived executions are not included.

### When data is missing

A missing value is never printed as "none". If an optional lookup fails or times out, the affected section says so:

- **Defense Score** shows *unavailable* in place of the number.
- **EDR alerts** that could not be fully checked show a one-line notice. Any alerts that were found are still listed, and alert counts read as a lower bound (for example *≥2*), with *—* where none were found.
- A run whose EDR alerts were not searched reads **not checked**. It is not counted as silent.
- **Accepted risks** that could not be loaded read *unavailable*.
- **Run start times** that could not be loaded mean the timelines show completion only.
- When part of the data in scope could not be read, the cover and summary show a banner with the number of shards affected, and the totals may be incomplete.

Each of these issues is also listed under *Some sections are incomplete* on the executive summary. When no EDR vendor is configured, the report leaves out the alert columns, alert tables, the latency plot and the vendor sources, so a tenant without Microsoft Defender or CrowdStrike Falcon sees no alert content. The outcome definitions on the Method page still describe Prevented and Detected.
