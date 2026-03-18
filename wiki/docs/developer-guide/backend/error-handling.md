---
sidebar_position: 3
title: "Error Handling"
description: "Backend error handling patterns — asyncHandler, AppError, and standard response format."
---

# Error Handling

## Pattern

Wrap async route handlers with `asyncHandler` and throw `AppError` for HTTP errors:

```typescript
import { asyncHandler, AppError } from '../middleware/error.middleware.js';

router.get('/resource/:id', asyncHandler(async (req, res) => {
  const item = await findItem(req.params.id);
  if (!item) throw new AppError('Resource not found', 404);
  res.json({ success: true, data: item });
}));
```

## Response Format

### Success

```json
{ "success": true, "data": { ... } }
```

### Error

```json
{ "success": false, "error": "Resource not found" }
```

## How It Works

1. `asyncHandler` wraps the async function in a try/catch
2. If the handler throws an `AppError`, the error middleware sends the appropriate HTTP status and message
3. If an unexpected error occurs, the middleware sends a 500 with a generic message (no stack trace in production)
