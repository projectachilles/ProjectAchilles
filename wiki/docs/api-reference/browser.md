---
sidebar_position: 2
title: "Browser Endpoints"
description: "REST API endpoints for the ProjectAchilles test browser — list tests, get details, and retrieve files."
---

# Browser Endpoints

## Endpoints

All endpoints need the `tests:library:read` permission. Sync and refresh also need `tests:sync:execute`.
These responses do not use the `data` wrapper: each has its own top-level field. The two [test version](#test-versions) routes are the exception.

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

### Test Versions

```
GET  /api/browser/tests/versions
POST /api/browser/tests/updates/check
```

The published, synced and built version of every test, as shown on the Tests page and the **Version** card. See [Test Versions](../user-guide/test-browser/test-versions) for what each status means. Not available on `backend-serverless`, which reports `testVersions: false` in `/api/capabilities`.

- `GET /tests/versions` needs `tests:library:read`. It reads the result of the last check and never contacts the test repository.
- `POST /tests/updates/check` also needs `tests:sync:execute` (the **Check now** button). It fetches the published branch of the configured test repository, compares, and answers with the same payload as the read route. It never changes the synced files.

Both answer `{ "success": true, "data": { "library": {...}, "tests": {...} } }`:

```json
{
  "success": true,
  "data": {
    "library": {
      "gitEnabled": true,
      "checkEnabled": true,
      "repoWebUrl": "https://github.com/<owner>/<repo>",
      "syncedCommit": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      "syncedCommitDate": "2026-11-20T09:12:44-04:00",
      "publishedCommit": "f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0",
      "publishedCommitDate": "2026-11-22T16:03:10-04:00",
      "checkedAt": "2026-11-23T10:00:00.000Z",
      "checkError": null,
      "updatesAvailable": 1,
      "rebuildsNeeded": 0,
      "newTests": 2
    },
    "tests": {
      "a1b2c3d4-...": {
        "status": "update_available",
        "reason": "test_source_changed",
        "custom": false,
        "published": { "commit": "f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0", "commitDate": "2026-11-22T16:03:10-04:00", "fingerprint": "3f1c…" },
        "synced": { "commit": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", "commitDate": "2026-11-20T09:12:44-04:00", "fingerprint": "9b07…" },
        "built": { "commit": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", "commitDate": "2026-11-20T09:12:44-04:00", "fingerprint": "9b07…", "builtAt": "2026-11-21T14:30:00.000Z", "signed": true }
      }
    }
  }
}
```

`library`:

| Field | Description |
|-------|-------------|
| `gitEnabled` | Git sync is configured. When `false`, every test is compared by content and has no published side. |
| `checkEnabled` | The timed check runs: git sync is on and `TESTS_UPDATE_CHECK` is not `off`. **Check now** works whatever `TESTS_UPDATE_CHECK` is set to. |
| `repoWebUrl` | `https://github.com/<owner>/<repo>` for a github.com remote, never with credentials; `null` for any other remote. |
| `syncedCommit`, `syncedCommitDate` | The commit the synced library is at; `null` without git. |
| `publishedCommit`, `publishedCommitDate`, `checkedAt` | The published commit and when the last successful check or Sync recorded it; `null` until one has. |
| `checkError` | `null`, or one fixed text (never git's own message): `The test library could not be read` (git can't read the synced library; it wins over the others), `Could not reach the test repository`, `The test repository rejected the credentials` or `The update check failed`. |
| `updatesAvailable` | Tests in `update_available`, plus `not_built` tests with `updateNote`. |
| `rebuildsNeeded` | Tests in `rebuild_needed`. |
| `newTests` | Tests in the published tree that this library does not have. |

Each entry of `tests` (keyed by test UUID):

| Field | Description |
|-------|-------------|
| `status` | `up_to_date`, `update_available`, `rebuild_needed`, `not_built`, `uploaded`, `unknown_build` or `not_checked` (**Built, not checked**). |
| `reason` | Optional. `test_source_changed` or `shared_changed` (with `update_available` or `rebuild_needed`), `documentation_changed` (with `update_available`), `dependency_changed` (an embedded file, with `rebuild_needed`), `no_stamp` or `modified_source` (with `unknown_build`, which can also have none). |
| `updateNote` | `true` on a `not_built` test whose published version differs from the synced one. |
| `custom` | A custom test: compared by content, `published` is `null`. |
| `published`, `synced` | `{ commit, commitDate, fingerprint }`, or `null` when not known. `published` is `null` for custom tests, without git and before the first successful check. A test missing from the published tree reports its synced version there. |
| `built` | `null` when the test has no binary. Otherwise `builtAt` and `signed`, with `commit`, `commitDate` and `fingerprint` set only when the build recorded a version from unmodified source (`null` otherwise). |

Errors:

| Status | When |
|--------|------|
| `403` | Missing `tests:library:read`, or for the check route `tests:sync:execute`. |
| `409` | Check route only: `A sync or a version check is already running`. |
| `503` | `Test versions are not available`: the backend was started without the versions service. |

A check that fails to reach or read the repository is not an HTTP error: the route answers `200` with the failure in `library.checkError`, and the previous published result is kept. With git sync off the check route answers `200` without contacting anything.
