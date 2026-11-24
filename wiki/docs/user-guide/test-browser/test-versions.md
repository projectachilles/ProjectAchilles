---
sidebar_position: 5
title: "Test Versions"
description: "Which version of each test the console has, whether a newer one is published, and which version produced each result."
---

# Test Versions

The console keeps track of which version of each security test it has. That answers three questions:

- Which version of a test does this console have?
- Is a newer version published in the test repository?
- Which version of the test produced a given result?

## After an upgrade

Every test that was already built on the server reads **Unknown build** until it is built once with **Build & Sign**. The line above the test list says how many, for example "12 tests were built before versions were recorded: build each once to record its version". The library itself can be fully up to date at the same time.

## The three versions

A test's version is the library commit it comes from plus a fingerprint: a value computed from the test's source and, for a test synced with git, the shared libraries it builds with.

| Version | What it is |
|---------|------------|
| **Published** | What the test repository has now |
| **Synced** | What this console downloaded with **Sync** |
| **Built** | What the test's binary was compiled from |

The **Version** card in the side column of a test's **Overview** tab shows all three: the short commit for each (with its date for **Published** and **Synced**), when the binary was built and whether it is signed, and "same as published" when the synced version is the published one. For a test that reads **Update available** or **Rebuild needed**, when the test repository is on GitHub, **View changes on GitHub** opens the changes between the two commits.

## The seven statuses

Each test has one status, shown under its name in the test list and at the top of the **Version** card. The card adds the reason, for example **Rebuild needed: test source changed**; in the list, hover the status to see it. The **All versions** menu above the list shows only the tests in one status.

| Status | What it means | What to do |
|--------|---------------|------------|
| **Up to date** | The binary was built from the synced version, and the synced version is the published one. | Nothing. |
| **Update available** | The test repository has a newer version than the one synced. Reason: test source changed, shared libraries changed, or documentation changed. | **Sync** on the **Tests** page. Build afterwards if the test then reads **Rebuild needed**. |
| **Rebuild needed** | The synced version is newer than the binary. Reason: test source changed, shared libraries changed, or an embedded file changed. | **Build & Sign**. |
| **Not built** | The test has no binary. With "update available" next to it, a newer version is published. | **Build & Sign**. With "update available", Sync first, then build. |
| **Uploaded** | The binary was uploaded by hand, so the console doesn't know its version. | To record a version, build it on the server (the **Rebuild** icon in the **Deploy** panel). |
| **Unknown build** | The binary's version was not recorded (it was built before versions were recorded, or a build is replacing it or stopped part-way), or it was built from source that was changed on the server and differs from the synced commit. Also shown when the console can't read its synced library. | **Build & Sign**. |
| **Built, not checked** | The binary was built from the synced version, but no check of the published version has succeeded yet. | **Check now**, or wait for the next check. |

A test that has a newer published version and an out-of-date binary shows **Update available**: sync first, then rebuild.

The short commit next to a status in the list is the built binary's own commit. **Not built**, **Uploaded** and **Unknown build** show no commit.

While a build replaces a test's binary, the test reads **Unknown build**, also when the binary it replaces was uploaded. A build that fails can leave **Unknown build** until the next build completes.

## Documentation changes

A change to a test's documents (Markdown, HTML) or to its detection and defense files shows as **Update available: documentation changed**, so you know to sync. The detection and defense files are the KQL, YARA, Elastic, Sigma and LimaCharlie D&R rules and the hardening scripts that come with each test. The Sigma and D&R rules and the hardening scripts count only under the names the test library gives them, which start with the test's ID, for example `<test-id>_sigma_rules.yml` or `<test-id>_hardening.ps1`. Such a change never asks for a rebuild: after the Sync, the binary still matches the synced version.

Every other file in the test's folder counts as source, other PowerShell and shell scripts included, for example a script named `apply_hardening.ps1`. A change to the test's source, to the shared libraries it builds with (tests synced with git), or to an embedded file asks for a rebuild.

## How the console knows what is published

The backend checks the test repository:

- 2 minutes after it starts, then every 6 hours;
- after each **Sync**, from what the Sync itself downloaded;
- when you click **Check now** in the **Tests** page header, next to **Sync**, or on the **Version** card of a test that reads **Built, not checked**.

**Check now** needs the same permission as **Sync** (`tests:sync:execute`). The header shows when the last check ran, for example `· checked 5m ago`.

The check contacts only the configured test repository, the same way Sync does. It downloads what is published to compare it, and never changes the synced files: your library stays as it is until you click **Sync**.

If a check fails, the line above the list says **Could not check for updates**. Hover it for the reason: **Could not reach the test repository**, **The test repository rejected the credentials** or **The update check failed**. Tests keep the result of the last check that worked, or read **Built, not checked** if none has. The same line, with the reason **The test library could not be read**, appears when the console can't read its own synced library.

To turn off the timed check, set `TESTS_UPDATE_CHECK=off` in the backend's environment and restart the backend. **Check now** still works, and a Sync still records what it downloaded.

## Versions on results

When a test task is created, the console copies the version of the binary it sends into the task, and every result of that run carries it. A result's version is in one of four states:

| State | What it means | What to do |
|-------|---------------|------------|
| **current** | The binary was built from the source you have synced now. | Nothing. |
| **older** | The synced source has changed since that binary was built. | Open the test and rebuild it; the next runs read **current**. |
| **version unknown** | The run recorded which build it used, but not a version that can be compared: an uploaded binary, a build with no recorded version or from changed source, a task created while a rebuild was replacing the binary, a test that is no longer in the library, or the console can't read the test's synced version now. | For a test still in the library, **Build & Sign** it so that new runs can be compared. When the console can't read the test's synced version, a build doesn't help: the library, or that test's folder, must be readable again. When git can't read the synced library, the **Tests** page header says **The test library could not be read**. When only the files of a custom test, or of any test with git sync off, can't be read, the header says nothing and the reason is in the server log. |
| **not recorded** | The run has no version: its task was created before this console recorded versions. | Nothing. New runs record it. |

Where they show:

- **Analytics → All Executions**: each run shows the short commit and its state. The run's detail has a **Test version** block with the commit, the source date and the build date, and for an **older** result a link to the test. The **Version** filter (**Older version**, **Current version**, **Version unknown**, **Not recorded**) narrows the list to one state and is kept in the page address. The CSV export ends with two columns, `version` (the short commit) and `version_state`. See [Execution Table](../analytics/execution-table).
- **Campaign run page**: under each test name, the short commit and its state, or **mixed versions** when the hosts ran different versions (hover for each version and its number of hosts). The **As of** line adds that the states compare with the synced test library as of that time, or, when they could not be compared, says "Version states could not be compared with the test library when this page was generated." It prints with the page. The CSV ends with the same two columns. See [Campaigns](../agent-management/campaigns#exporting-evidence).
- **PDF report**: in the execution log, under each run's completion time, the short commit and its state, for example `abc1234 current` or `abc1234 older`. A run without a commit shows its state alone, for example **not recorded**. A commit alone means its state could not be compared. The Method page says what the states mean and when the report compared them. See [Execution Report](../analytics/execution-report).

When the console can't read a test's synced version, its results read **version unknown**. If the console can't read its test library at all, or reading it takes more than 5 seconds, the states can't be worked out: All Executions then shows no version on its rows and its **Version** filter can't be applied, and the campaign page and the report show recorded commits without a state.

## Three things to know

:::note[Older results are not back-filled]
Results recorded before the upgrade, and results of tasks created before it (a Retry of an older task included), say **not recorded**. Nothing fills them in later. A test built before the upgrade has no recorded version, so its results say **version unknown** until you build it once.
:::

:::note[Current and older are compared when you look]
**current** and **older** compare a result with what is synced when you look, so a Sync can turn earlier results into **older**. A printed campaign page, its CSV and the PDF report show the state as of the time they were made, and say so. The commit is the lasting fact: it never changes.
:::

:::note[What current compares]
A result is **current** when the source its binary was built from equals the source synced now: the test's own files and, for a test synced with git, the shared libraries it builds with. It does not look at files uploaded for the build (embedded dependencies), the signing certificate, or the target platform. A documentation change, as described under [Documentation changes](#documentation-changes), never makes a result **older**.
:::

## Without git, and custom tests

When git sync is off, and for custom tests, the console compares versions by the content of the test's folder. Only the folder counts: a change to the shared libraries never asks these tests for a rebuild and never makes their results **older**. There is no published side: the **Version** card has no **Published** row, and **Built, not checked** never appears. With git sync off, the header also says "Git sync is off: published versions are not checked". There is no commit either, so these tests show none, and the CSV `version` column is empty for their results. Custom tests carry a **Custom** label next to their status.

## Uploaded binaries

A binary uploaded with **Upload Binary** has no version. Its status is **Uploaded**, and the results of its runs say **version unknown**.

## Not on serverless

Test versions need the main backend. They are not available on `backend-serverless` (Vercel): the Tests page shows no statuses, and results show no version.
