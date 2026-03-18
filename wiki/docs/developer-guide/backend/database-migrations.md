---
sidebar_position: 4
title: "Database & Migrations"
description: "SQLite database schema, table recreation pattern for CHECK constraint changes, and migration gotchas."
---

# Database & Migrations

## Database Location

- **Docker/PaaS**: `~/.projectachilles/agents.db` (better-sqlite3, WAL mode)
- **Vercel**: Turso (`@libsql/client`, async)

## Schema

Tables are created via `CREATE TABLE IF NOT EXISTS` in `database.ts` with incremental migrations.

### Tables

| Table | Purpose |
|-------|---------|
| `agents` | Enrolled agents with status, OS, tags |
| `enrollment_tokens` | Registration tokens with TTL and max uses |
| `tasks` | Task queue with status lifecycle |
| `agent_versions` | Uploaded binary versions per platform |
| `schedules` | Recurring execution schedules |

## Table Recreation Migrations

SQLite has no `ALTER COLUMN`, so changing CHECK constraints requires recreating the table:

:::danger Follow This Exact Pattern

```typescript
// 1. Drop leftover temp tables (previous crash may leave them)
database.exec('DROP TABLE IF EXISTS agents_temp');

// 2. Disable FK checks (tasks references agents)
database.pragma('foreign_keys = OFF');

// 3. Create temp table with new schema
database.exec(\`CREATE TABLE agents_temp (...)\`);

// 4. Copy data
database.exec('INSERT INTO agents_temp SELECT * FROM agents');

// 5. Swap
database.exec('DROP TABLE agents');
database.exec('ALTER TABLE agents_temp RENAME TO agents');

// 6. Recreate indexes
database.exec('CREATE INDEX ...');

// 7. Re-enable FK checks
database.pragma('foreign_keys = ON');
```

:::

### Key Gotchas

1. **Always `DROP TABLE IF EXISTS <temp>` first** — a previous crashed run may leave the temp table
2. **Disable FK checks** — `PRAGMA foreign_keys = OFF` before the swap. Tables with FK references refuse DROP
3. **Use `database.pragma()`** not `database.exec('PRAGMA ...')` — PRAGMA only works outside transactions
