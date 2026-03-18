---
sidebar_position: 9
title: "Testing"
description: "Testing patterns for ProjectAchilles — Vitest, in-memory SQLite, mock patterns, and gotchas."
---

# Testing

## Test Framework

All modules use **Vitest** with the test file pattern: `src/**/__tests__/**/*.test.{ts,tsx}`

## Running Tests

```bash
cd backend && npm test           # 912 tests across 40 files (~12s)
cd frontend && npm test          # 127 tests across 8 files (~2s)
cd backend-serverless && npm test  # 626 tests across 25 files (~11s)

# Single file
cd backend && npx vitest src/services/agent/__tests__/enrollment.service.test.ts

# Filter by name
cd backend && npx vitest -t "creates a token"

# Watch mode
cd backend && npm run test:watch
```

## Backend Test Pattern

Tests use in-memory SQLite via `createTestDatabase()`:

```typescript
let testDb: Database.Database;
vi.mock('../database.js', () => ({ getDatabase: () => testDb }));

// Import AFTER mock setup
const { functionToTest } = await import('../service.js');
```

:::warning Mock Ordering Is Critical
The `vi.mock` must come before the dynamic `import()`. Vitest hoists mocks, but the imported module captures the mock at import time.
:::

## Gotchas

- **ES service tests**: Must use `function(){}` not arrow functions for `new` compatibility when mocking the ES client
- **SQLite `datetime('now')`**: Has only second precision — tests needing ordering must use explicit timestamps
- **Frontend**: All Clerk hooks are mocked globally via `frontend/src/__tests__/setup.ts`
