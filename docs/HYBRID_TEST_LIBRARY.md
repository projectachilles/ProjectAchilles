# Hybrid Test Library: Auto-Bootstrap + Multi-Source Indexer

## What Changed

ProjectAchilles now supports **multiple test sources** and **auto-bootstraps** the f0_library test repository on first run without any configuration.

### Before

- `TESTS_REPO_URL` and `GITHUB_TOKEN` had to be set in `.env` for any tests to appear
- The Browser module showed zero tests on a fresh install
- All tests came from a single source directory (the git-synced f0_library clone)

### After

- The backend **defaults** `TESTS_REPO_URL` to `https://github.com/ubercylon8/f0_library.git`
- A **custom tests directory** at `~/.projectachilles/custom-tests/` is created automatically on first startup
- The test indexer scans **both** directories, with custom tests taking priority over upstream on UUID collisions
- Every test carries a `source` field (`'upstream'` or `'custom'`) that flows through the API to the frontend

---

## Impact on Developer Workflow

### New environment variable behavior

| Variable | Before | After |
|----------|--------|-------|
| `TESTS_REPO_URL` | Required for any tests | Optional. Defaults to f0_library. Set to empty string (`TESTS_REPO_URL=`) to disable auto-sync |
| `GITHUB_TOKEN` | Required alongside `TESTS_REPO_URL` | Still required while f0_library is **private**. Becomes optional once public |
| `CUSTOM_TESTS_PATH` | N/A | Optional. Overrides the default `~/.projectachilles/custom-tests/` location |

### Working with custom tests

Custom tests live at `~/.projectachilles/custom-tests/` (or `$CUSTOM_TESTS_PATH`). They follow the same structure as f0_library:

```
~/.projectachilles/custom-tests/
  cyber-hygiene/
    <uuid>/
      <uuid>.go
      README.md
      ...
  intel-driven/
    <uuid>/
      ...
```

- Create a test directory with a valid UUID name inside any known category folder (`cyber-hygiene`, `intel-driven`, `mitre-top10`, `phase-aligned`)
- The test will appear in the Browser module with a green **CUSTOM** badge
- Custom tests persist across git syncs (they're in a completely separate directory tree)
- To override an upstream test, create a custom test with the **same UUID** -- the custom version wins

### API changes

The `GET /api/browser/tests` response now includes a `source` field on each test:

```json
{
  "uuid": "a1b2c3d4-...",
  "name": "My Custom Test",
  "source": "custom",
  ...
}
```

Upstream tests have `"source": "upstream"`. The field is optional (omitted for older data) and backward-compatible.

### Backend constructor changes

If you're writing code that instantiates these services directly:

| Service | Old signature | New signature |
|---------|--------------|---------------|
| `TestIndexer` | `new TestIndexer(path: string)` | `new TestIndexer(sources: TestSource[] \| string)` |
| `BuildService` | `new BuildService(settings, path: string)` | `new BuildService(settings, paths: string[] \| string)` |
| `initCatalog()` | `initCatalog(path: string)` | `initCatalog(sources: TestSource[] \| string)` |
| `createBrowserRouter()` | `{ testsSourcePath }` | `{ testSources, testsSourcePath }` |
| `createTestsRouter()` | `{ testsSourcePath }` | `{ testSourcePaths, testsSourcePath }` |
| `createAgentRouter()` | `{ testsSourcePath, agentSourcePath }` | `{ testSources, testsSourcePath, agentSourcePath }` |

All accept the old `string` form for backward compatibility (it defaults to `'upstream'` provenance).

### Docker Compose

No changes needed. The `achilles-data` volume at `/root/.projectachilles` already persists the custom tests directory. The default `TESTS_REPO_URL` kicks in automatically.

### Vercel (serverless)

The `vercel-build` script now:
1. Defaults `REPO_URL` to f0_library if `TESTS_REPO_URL` is unset
2. Only injects `GITHUB_TOKEN` into the clone URL if the token is present
3. Works zero-config once f0_library is public

---

## Impact on End Users

### First-run experience

Users who run `docker compose up` or `./scripts/start.sh` for the first time will see tests populated automatically -- no configuration needed (once f0_library is public).

While f0_library is private, users must still set `GITHUB_TOKEN` in their `.env`. The auto-clone will fail gracefully without it (the server logs a warning and continues with an empty library).

### Custom tests in the Browser

- Custom tests appear alongside upstream tests with a green **CUSTOM** badge in both grid and list views
- The badge appears before the severity indicator for maximum visibility
- Upstream tests show no badge (they're the default)

### Sync safety

Clicking **Sync** in the Browser module only affects the upstream f0_library clone. Custom tests are never touched by sync operations. After sync, both upstream and custom tests are re-indexed so changes appear immediately.

### Disabling auto-sync

Set `TESTS_REPO_URL=` (empty string) in `.env` to disable auto-sync entirely. The server will use only local/custom tests.

---

## Architecture

```
Server startup
  |
  +-- Resolve testsSourcePath (git clone / local fallback)
  |
  +-- Create custom-tests dir (~/.projectachilles/custom-tests/)
  |
  +-- Build testSources array:
  |     [0] { path: custom-tests,   provenance: 'custom'   }  <-- first = wins collisions
  |     [1] { path: f0_library,     provenance: 'upstream'  }
  |
  +-- TestIndexer(testSources)   -- scans both, stamps provenance
  +-- initCatalog(testSources)   -- agent task enrichment catalog
  +-- BuildService([paths])      -- findTestDir() searches all paths
  +-- Routes receive testSources -- API includes source field
```

### UUID collision rule

Sources are scanned in array order. The **first source wins** -- if a UUID exists in custom-tests, the upstream version is skipped. This lets users fork and customize any upstream test by copying its UUID to their custom directory.

### Type definitions

```typescript
type TestSourceProvenance = 'upstream' | 'custom';

interface TestSource {
  path: string;
  provenance: TestSourceProvenance;
}
```

Added to `backend/src/types/test.ts`, `frontend/src/types/test.ts`, and `backend-serverless/src/types/test.ts`.
