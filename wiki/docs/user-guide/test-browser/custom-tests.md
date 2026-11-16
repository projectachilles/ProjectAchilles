---
sidebar_position: 5
title: "Custom Tests"
description: "Add your own security tests next to the upstream library: where they live, how they are named, and how they override upstream tests."
---

# Custom Tests

ProjectAchilles supports a hybrid test library that combines upstream tests (from a Git repository) with custom tests you create.

## How It Works

The test indexer scans two sources and merges them into one library:

1. **Custom source** — Tests in `~/.projectachilles/custom-tests/` on the backend (created on first start). Set `CUSTOM_TESTS_PATH` to use another folder.
2. **Upstream source** — Tests from the configured Git repository (`TESTS_REPO_URL`, branch `TESTS_REPO_BRANCH`), synced with the **Sync** button on the Tests page.

Custom tests live outside the Git clone, so a sync never touches them. In Docker and server installs `~/.projectachilles` is the backend's persistent volume, so they also survive an upgrade.

## Creating a Custom Test

### Directory Structure

A test is a folder **named with its UUID**, inside one of the category folders `cyber-hygiene`, `intel-driven`, `mitre-top10` or `phase-aligned`:

```
~/.projectachilles/custom-tests/
└── intel-driven/
    └── 3f6c1a2e-8b4d-4c5e-9a7f-1d2e3f4a5b6c/
        ├── 3f6c1a2e-8b4d-4c5e-9a7f-1d2e3f4a5b6c.go        # Main source, with the metadata header
        ├── README.md                                       # Overview and test score
        ├── 3f6c1a2e-8b4d-4c5e-9a7f-1d2e3f4a5b6c_info.md   # Info card (optional)
        └── ...                                             # Detection rules, defense files, stages
```

Folders whose name is not a UUID are ignored. Without category folders, UUID folders placed directly in the custom folder are indexed with no category.

The layout is the same as the upstream library's, so the simplest start is to copy an upstream test and give the folder and its files a new UUID (`uuidgen`).

### Metadata

There is no `metadata.json`. The indexer reads metadata from the test's own files:

- **`<uuid>.go`**: the comment block at the top of the file, one `KEY: value` per line.
- **`README.md`**: the `## Overview` section becomes the description, and `**Test Score**: **8.5/10**` the score.
- **`<uuid>_info.md`**: the info card (category, score, stage headings).
- **The folder**: the category comes from the category folder, not from a file.

```go
/*
ID: 3f6c1a2e-8b4d-4c5e-9a7f-1d2e3f4a5b6c
NAME: My Custom Test
TECHNIQUES: T1059.001, T1027
TACTICS: execution, defense-evasion
TARGET: windows-endpoint
COMPLEXITY: medium
THREAT_ACTOR: N/A
SUBCATEGORY: ransomware
TAGS: powershell, obfuscation
AUTHOR: Your Name
CREATED: 2026-11-15
*/
package main
```

The build picks the target operating system from the Go build tags of the test's source files; with no build tags it uses the platform set in **Settings → Tests**. See [Building & Signing](./building-signing).

### Making it appear

After adding or changing a custom test, click **Sync** on the Tests page (it pulls the upstream repository and re-reads both sources), or restart the backend. With Git sync turned off, Sync is not available: restart the backend.

## Overriding an Upstream Test

The custom source is read first, and the first test found for a UUID wins. A custom test with the **same UUID** as an upstream test therefore replaces it in the library. Use this to adapt an upstream test without forking the repository. Remove the custom folder to get the upstream version back.

A custom test with a UUID of its own never conflicts with upstream tests.

## Auto-Bootstrap

When the backend starts and finds no test library, it clones the upstream repository. `TESTS_REPO_URL` defaults to the public f0_library; set it to an empty value to turn Git sync off and read tests from `TESTS_SOURCE_PATH` instead. Custom tests are indexed in both cases.

## Availability

Custom tests need a backend with a filesystem. The Vercel (serverless) deployment clones the library at build time and has no custom source.
