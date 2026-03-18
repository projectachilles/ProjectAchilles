---
sidebar_position: 8
title: "Backend Serverless"
description: "Key differences between backend/ and backend-serverless/ — Turso, Vercel Blob, and serverless adaptations."
---

# Backend Serverless

## Overview

`backend-serverless/` is a separate codebase (not a build target of `backend/`) adapted for Vercel's serverless runtime.

## Key Differences

| Component | `backend/` | `backend-serverless/` |
|-----------|-----------|----------------------|
| Database | better-sqlite3 (sync) | @libsql/client (async, Turso) |
| DB helper | `getDatabase()` → sync `Database` | `getDb()` → async `DbHelper` |
| Storage | `fs` (filesystem) | `@vercel/blob` |
| Signing | Filesystem keypair | `SIGNING_PRIVATE_KEY_B64` env vars |
| Entry point | `server.ts` (Express listen) | `app.ts` (export) + `api/index.ts` |
| Scheduling | `setInterval` | Vercel Crons → `cron.routes.ts` |
| Test library | Runtime git sync | Build-time clone |
| Build system | Go cross-compilation | Stubbed (returns 503) |
| Cert generation | OpenSSL CLI | `node-forge` (pure JS) |

## Important

Changes to `backend/` do **not** propagate to `backend-serverless/`. If modifying shared logic (types, API contracts, ES mappings), update both codebases.
