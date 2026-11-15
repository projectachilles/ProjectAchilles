---
sidebar_position: 2
title: "Browser Endpoints"
description: "REST API endpoints for the ProjectAchilles test browser — list tests, get details, and retrieve files."
---

# Browser Endpoints

## Endpoints

All endpoints need the `tests:library:read` permission. Sync and refresh also need `tests:sync:execute`.
These responses do not use the `data` wrapper: each has its own top-level field.

### List Tests

```
GET /api/browser/tests
```

Returns all security tests from the indexed test library. One optional filter is applied, the first present of
`search`, `technique`, `category`, `severity`.

**Response:**
```json
{
  "success": true,
  "count": 1,
  "tests": [
    {
      "uuid": "a1b2c3d4-...",
      "name": "Process Injection via CreateRemoteThread",
      "category": "defense-evasion",
      "subcategory": "...",
      "techniques": ["T1055.001"],
      "tactics": ["defense-evasion", "privilege-escalation"],
      "target": ["windows-endpoint"],
      "isMultiStage": false,
      "stageCount": 0,
      "source": "upstream"
    }
  ]
}
```

Each test also has `severity` (optional; the console no longer shows it), `complexity`, `threatActor`, `author`,
`version`, `tags`, `createdDate`, `score`, `description`, `integrations`, the `has*` flags for its documents
(`hasReadme`, `hasInfoCard`, `hasAttackFlow`, `hasKillChain`, `hasSafetyDoc`, `hasDetectionFiles`,
`hasDefenseGuidance`), and `lastModifiedDate` / `lastCommitMessage` when known.

### List Categories

```
GET /api/browser/tests/categories
```

Returns `{ "success": true, "categories": [...] }`.

### Get Test Details

```
GET /api/browser/tests/:uuid
```

Returns `{ "success": true, "test": { ... } }`: the full metadata of one test (stages, files, MITRE mappings)
plus `overview`, the content of the test page's Overview tab extracted from the test's documents.
A malformed UUID returns `400`, an unknown test `404`.

### Get a Description

```
GET /api/browser/tests/:uuid/description[?validator=<name>]
```

Returns `{ "success": true, "data": { "description", "hasInfoCard", "hasReadme" } }`. With `validator`,
`description` is that validator's (or stage's) own description. An unknown test returns `description: null`, not `404`.

### List Test Files

```
GET /api/browser/tests/:uuid/files
```

Returns `{ "success": true, "files": [...] }`: the files in a test directory (source, docs, detection rules, references).

### Get File Contents

```
GET /api/browser/tests/:uuid/file/:filename
```

Returns the contents of one test file. A filename with a path separator or `..` returns `400`.

### Diagrams

```
GET /api/browser/tests/:uuid/attack-flow
GET /api/browser/tests/:uuid/kill-chain
```

Return the test's attack flow and kill chain diagrams, or `404` when the test has none.

### Sync and Refresh

```
GET  /api/browser/tests/sync/status
POST /api/browser/tests/sync
POST /api/browser/tests/refresh
```

- `sync/status` returns `syncStatus` (`lastSyncTime`, `commitHash`, `branch`, `status`, `testCount`).
- `sync` pulls the test library from Git and re-indexes it (the **Sync** button on the Tests page). `409` while a sync is running, `503` when Git sync is not configured (always the case on Vercel, where the library is cloned at build time).
- `refresh` re-reads the library folder without pulling.
