---
sidebar_position: 2
title: "ES Module Imports"
description: "Critical gotcha: backend ES module imports require .js extensions in TypeScript."
---

# ES Module Imports

## The Rule

Backend TypeScript files **must** use `.js` extensions in import paths:

```typescript
// Correct — works at runtime
import browserRoutes from './api/browser.routes.js';
import { getDatabase } from '../database.js';

// Incorrect — fails at runtime with MODULE_NOT_FOUND
import browserRoutes from './api/browser.routes';
import { getDatabase } from '../database';
```

## Why?

The backend uses ES modules (`"type": "module"` in `package.json`). TypeScript compiles `.ts` files to `.js` files, but **does not rewrite import specifiers**. At runtime, Node.js resolves imports as-is — so the import path must match the compiled `.js` filename.

## How to Remember

- Always add `.js` to relative imports in `backend/src/`
- This does NOT apply to:
  - `node_modules` packages (`import express from 'express'`)
  - The frontend (Vite handles module resolution)
  - Type-only imports (`import type { Foo } from './types'` — erased at compile time)
