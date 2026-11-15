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

1. `asyncHandler` passes a rejected promise from the handler to Express (`.catch(next)`)
2. If the handler throws an `AppError`, the error middleware (`errorHandler`) sends its `statusCode` and message
3. Any other error is sent as a 500 with the error's message. A `stack` field is added only when `NODE_ENV=development`
4. Unknown routes are answered by `notFoundHandler` with a 404: `{ "success": false, "error": "Not Found", "message": "Cannot GET /api/unknown" }`

:::warning[Error messages reach the client]
The message of any thrown error is returned in the response, not only `AppError` messages. Do not put secrets, file paths or upstream response bodies in error messages.
:::
