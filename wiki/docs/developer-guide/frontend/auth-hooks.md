---
sidebar_position: 3
title: "Auth Hooks"
description: "Authentication hooks in ProjectAchilles — useAuthenticatedApi for automatic JWT injection."
---

# Auth Hooks

## useAuthenticatedApi

The primary hook for making authenticated API calls. It automatically injects the Clerk JWT token into request headers.

```typescript
const api = useAuthenticatedApi();

// All requests include Authorization: Bearer <jwt>
const response = await api.get('/api/browser/tests');
```

## Three-Tier Auth Model

1. **Clerk (global)** — All web routes require Clerk authentication
2. **Analytics** — `AnalyticsAuthProvider` context redirects to setup if ES is unconfigured
3. **Agent admin** — Clerk JWT required; agent device endpoints use agent API key

## AnalyticsAuthProvider

Wraps Analytics pages and redirects to `/analytics/setup` if Elasticsearch is not configured:

```typescript
<AnalyticsAuthProvider>
  <AnalyticsDashboard />
</AnalyticsAuthProvider>
```
