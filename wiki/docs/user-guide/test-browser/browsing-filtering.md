---
sidebar_position: 1
title: "Browsing & Filtering"
description: "Navigate the ProjectAchilles test library: list view, search, filters, sorting, favorites, and categories."
---

# Browsing & Filtering

The **Tests** page (`/tests`) is the primary interface for discovering and running security tests. It is one page: a filter rail and the test list. The old Overview tab with its ATT&CK coverage chart is gone; coverage by technique is on the [Dashboard](../console/security-dashboard)'s ATT&CK matrix.

## Test Library List

The Tests page is a list with a filter rail on the left. The header shows how many tests match (`42/187 tests`) and the [sync status](#git-sync-status). Each row shows the test name, then `actor · subcategory` (or "No attributed actor" when the test has none), the fleet result, the test score, and the favorite and run actions. The score shows "—" when it is missing or zero. Under the name is the test's version status (for example **Up to date** or **Rebuild needed**), and the **All versions** menu lists only the tests in one status; see [Test Versions](./test-versions).

![Tests — facet rail beside the test list, with techniques, platform, stages, fleet result and score per row](/img/screenshots/tests.png)

Columns appear as the window gets wider:

| Width | Layout |
|-------|--------|
| Below 1280px | No header row. Each row stacks the name and `actor · subcategory`, with the fleet result line (and its bar) underneath; score and actions sit on the right |
| 1280px and up | A header row appears, and **Platform**, **Fleet result** and **Score** become columns |
| 1536px and up | Adds **Techniques** (the first two unique ATT&CK IDs, then `+n`) and **Stages** columns |

### Fleet result

The fleet result is the latest result per endpoint over the last 90 days, the same rule the Defense Score uses.

| Shows | Meaning |
|-------|---------|
| `N / M endpoints protected` | N of M endpoints protected on their latest result |
| `N / M checks passed` | The same count for cyber-hygiene tests, where each control is a check |
| `Not run yet` | The test has no recorded execution at all |
| `No conclusive result in 90 days` | The test may have run, but no endpoint returned protected or unprotected in the window. Errors, blocks before execution (exit 260), skipped stages and risk-accepted results don't count |
| `—` | Fleet results are loading, or analytics is not configured or unavailable |

Hover the cell for the window and the time of the last run. The data comes from `GET /api/analytics/test-results`; see the [Analytics API reference](../../api-reference/analytics).

## Filtering

The filter rail holds the facets as plain rows with counts, and the search box sits above the list. Filters are additive: combining several narrows the results. On a narrow window the rail is behind a **Filters** button, and the active filters show as chips above the list.

| Filter | Description |
|--------|-------------|
| **Search** | Free-text search across test names, UUIDs, technique IDs and descriptions |
| **View** | All tests, Favorites, or Recently viewed |
| **Category** | Filter by test category (e.g., intel-driven, cyber-hygiene) |
| **Platform** | Filter by target platform (Windows, Linux, macOS) |
| **Threat actor** | Filter by attributed threat actor |
| **Not run yet** | Tests with no recorded executions (requires Elasticsearch) |
| **Has binary** | Tests that already have a compiled binary |

There is no severity facet. An old `?severity=` link still loads; the parameter is ignored.

The view, category, platform and threat actor are part of the page URL (`?view=favorites`, `?category=intel-driven`, `?platform=…`, `?actor=…`), so a filtered list can be bookmarked or shared. A `?tactic=<tactic>` link also filters the list to one ATT&CK tactic and shows it as a chip.

## Favorites

Click the heart icon on any test row to favorite it. Favorites are stored per-user in the browser's local storage. Use the **Favorites** filter to show only favorited tests.

## Categories

A test's category is the folder it lives in in the test library:

- `intel-driven`: multi-stage tests built from threat intelligence
- `mitre-top10`
- `cyber-hygiene`: configuration checks, where each control is a check
- `phase-aligned`

The test list groups tests under a plain header for each category, with the number of tests in it.

## Filter Details

### Search

The search box matches across multiple fields simultaneously:

- Test names and descriptions
- UUIDs (partial matching supported)
- MITRE ATT&CK technique IDs (e.g., "T1059")

:::info["Not Run Yet" Filter]
The "Not Run Yet" filter queries your Elasticsearch analytics data to identify tests that exist in the library but have no recorded executions. This is useful for expanding coverage to untested techniques.
:::

:::info["Has Binary" Filter]
The **Has Binary** toggle narrows the list to tests that have already been
built. It loads the set of built test UUIDs once from
`GET /api/tests/builds` and filters client-side. On serverless (Vercel)
deployments the build system is stubbed, so the endpoint is unavailable and the
toggle has no effect — the filter degrades gracefully rather than erroring.
:::

### Sorting

Sort the test list with the menu next to the search box. Tests are sorted inside each category group.

- **Name** -- Alphabetical
- **Score** -- By test quality rating
- **Created** (default, newest first) / **Modified** -- By date
- The button next to the menu switches between ascending and descending

## Test Detail Page

Click a test to open its page: a header, a row of tabs (Overview, README, Detection, Defense, Source and more) and the selected tab's content. See [Test Detail Pages](./test-detail-pages).

## Running Tests from the List

Users who can create tasks get two ways to run tests from this page:

- **One test** -- The run button at the end of a row opens the [execution drawer](./building-signing#execution-drawer) for that test
- **Several tests** -- Click **Select**, tick the tests, then **Run N**. The drawer opens with all of them, and creates one task per test and agent. **Cancel** leaves select mode

## Recently Viewed

The console remembers the tests you opened, in your browser. Choose **Recently viewed** under **View** in the filter rail to list them. The old `/favorites` and `/recent` links open the Tests page with the matching view.

## Git Sync Status

The **Tests** page shows the sync status of the test library in its header:

- A **sync indicator** shows the branch, the commit and when the library was last updated from the Git repository
- Click **Sync** to trigger a manual sync if you have the `tests:sync:execute` permission
- After syncing, the test list refreshes automatically with any new or updated tests; a failed sync shows "Sync failed" next to the button
- The Dashboard no longer has the Sync button. Its "library sync failed" attention chip links to the Tests page
