# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ProjectAchilles is a Unified Security Platform with three main modules:
- **Browser Module**: Security test browsing and viewing (Clerk auth required)
- **Analytics Module**: Test results analytics via Elasticsearch (Clerk auth + configuration)
- **Endpoints Module**: Endpoint management via LimaCharlie (Clerk auth + LimaCharlie credentials)

## Development Commands

```bash
# Full stack (installs deps, finds available ports)
./start.sh              # Starts both frontend and backend
./start.sh --kill       # Kill existing processes and restart

# Individual services
cd frontend && npm run dev      # Development server (port 5173)
cd backend && npm run dev       # Dev with hot reload (tsx watch, port 3000)

# TypeScript validation (no test framework configured)
cd frontend && npm run build    # Validates frontend TS + builds
cd backend && npm run build     # Validates backend TS
```

## Architecture

### Frontend (`frontend/src/`)
- **React 19** + **TypeScript** + **Vite 7** + **Tailwind CSS v4**
- **Clerk** for authentication, **Redux Toolkit** for state, **React Router v7** for routing
- Path alias: `@/` → `src/`

Key directories:
- `pages/` - Module pages (browser/, analytics/, endpoints/, auth/)
- `components/shared/ui/` - Base UI primitives (Button, Card, Input)
- `services/api/` - API client modules
- `hooks/` - Custom hooks (useAuthenticatedApi injects JWT automatically)
- `store/` - Redux slices (endpointAuth, sensors)

### Backend (`backend/src/`)
- **Express** + **TypeScript** (ES modules)
- **Clerk** for auth (`@clerk/express`)

Key directories:
- `api/` - Route handlers (`*.routes.ts`)
- `services/` - Business logic by module
- `middleware/` - Express middleware (clerk, auth, error handling)

### API Routes
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/browser/*` | Clerk | Security test browser |
| `/api/analytics/*` | Clerk | Elasticsearch analytics |
| `/api/auth/*` | Clerk (rate limited: 20/15min) | LimaCharlie auth |
| `/api/endpoints/*` | Clerk + LimaCharlie | Endpoint management |

## Code Patterns

### Backend ES Module Imports
Backend requires `.js` extensions in imports (TypeScript compiles to `.js`):
```typescript
// Correct
import browserRoutes from './api/browser.routes.js';

// Incorrect - fails at runtime
import browserRoutes from './api/browser.routes';
```

### TypeScript Style
- Strict mode enabled; avoid `any`
- Use `import type` for type-only imports
- Satisfy `noUnusedLocals`/`noUnusedParameters`

### Backend Error Handling
Wrap async route handlers with `asyncHandler`; throw `AppError` for HTTP errors:
```typescript
import { asyncHandler, AppError } from '../middleware/error.middleware.js';

router.get('/resource/:id', asyncHandler(async (req, res) => {
  const item = await findItem(req.params.id);
  if (!item) throw new AppError('Resource not found', 404);
  res.json({ success: true, data: item });
}));
```

Error response format: `{ success: false, error: "message" }`

### Authentication
**Three-tier model:**
1. **Clerk (global)**: All routes use `<RequireAuth>` wrapper; JWT injected via `useAuthenticatedApi` hook
2. **Analytics**: `AnalyticsAuthProvider` context → redirects to `/analytics/setup` if unconfigured
3. **Endpoints (dual-auth)**: Clerk + LimaCharlie credentials → sessions linked to Clerk user ID

### Frontend Imports
- Use `@/` alias for `frontend/src` paths
- Group imports: external → internal

### API Proxying
Vite proxies `/api` → `http://localhost:$VITE_BACKEND_PORT` (default 3000)

## Commit Convention
```
<type>(<scope>): <description>
```
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
