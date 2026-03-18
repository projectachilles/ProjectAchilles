---
sidebar_position: 1
title: "Routes & Middleware"
description: "Backend route structure and middleware stack in ProjectAchilles — auth, error handling, rate limiting."
---

# Routes & Middleware

## Route Organization

Routes are organized by module in `backend/src/api/`:

| File | Auth | Purpose |
|------|------|---------|
| `browser.routes.ts` | Clerk | Security test browser |
| `analytics.routes.ts` | Clerk | Elasticsearch analytics |
| `agent-admin.routes.ts` | Clerk | Agent management |
| `agent-device.routes.ts` | Agent key | Device endpoints |
| `tests.routes.ts` | Clerk | Build system, certificates |
| `defender.routes.ts` | Clerk | Defender integration |
| `alerting.routes.ts` | Clerk | Alert configuration |

## Middleware Stack

1. **Helmet** — Security headers
2. **CORS** — Configurable origin restrictions
3. **Rate limiting** — Per-endpoint budgets
4. **Clerk auth** — JWT validation for web routes
5. **Agent auth** — API key validation for device routes
6. **Error handler** — Catches `AppError` and unhandled errors

## Rate Limits

| Endpoint Group | Limit |
|---------------|-------|
| Enrollment | 5 / 15 min per IP |
| Device (heartbeat, tasks) | 100 / 15 min per agent |
| Binary download | 10 / 15 min per IP |
| Key rotation | 3 / 15 min per IP |
| Auth | 20 / 15 min per IP |
