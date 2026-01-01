# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ProjectAchilles is a Unified Security Platform with three main modules:
- **Browser Module**: Security test browsing and viewing (Clerk auth required)
- **Analytics Module**: Test results analytics via Elasticsearch (Clerk auth + configuration)
- **Endpoints Module**: Endpoint management via LimaCharlie (Clerk auth + LimaCharlie credentials)

## Development Commands

### Start the full stack
```bash
./start.sh              # Starts both frontend and backend
./start.sh --kill       # Kill existing processes and restart
./start.sh --help       # Show all options
```

### Frontend (Vite + React)
```bash
cd frontend
npm run dev             # Development server (port 5173)
npm run build           # Build for production (runs tsc -b && vite build)
npm run preview         # Preview production build
```

### Backend (Express + TypeScript)
```bash
cd backend
npm run dev             # Development server with hot reload (tsx watch, port 3000)
npm run build           # Compile TypeScript (tsc)
npm run start           # Run compiled JS
```

### TypeScript Validation (No test framework)
```bash
cd frontend && npm run build    # Validates frontend TypeScript
cd backend && npm run build     # Validates backend TypeScript
```

## Architecture

### Frontend (`frontend/src/`)
- **React 19** with **TypeScript**, **Vite**, and **Tailwind CSS v4**
- **Clerk** for authentication (`@clerk/clerk-react`)
- **Redux Toolkit** for state management (endpoint auth, sensors)
- **React Router v7** for routing
- Path alias: `@/` maps to `src/`

Key directories:
- `pages/` - Module-specific page components (browser/, analytics/, endpoints/, auth/)
- `components/auth/` - Authentication components (RequireAuth)
- `components/shared/` - Reusable UI components (Layout, Header, ErrorBoundary)
- `components/shared/ui/` - Base UI primitives (Button, Card, Input, etc.)
- `services/api/` - API client modules (browser.ts, analytics.ts, endpoints.ts)
- `hooks/` - Custom hooks (useTheme, useAnalyticsAuth, useAuthenticatedApi)
- `store/` - Redux store configuration and slices (endpointAuth, sensors)
- `routes/AppRouter.tsx` - All routing with Clerk-protected route wrappers

### Backend (`backend/src/`)
- **Express** with **TypeScript** (ES modules)
- **Clerk** for authentication (`@clerk/backend`, `@clerk/express`)
- Organized by module with routes and services

Key directories:
- `api/` - Route handlers (browser.routes.ts, analytics.routes.ts, endpoints.routes.ts)
- `services/` - Business logic organized by module (browser/, analytics/, endpoints/)
- `middleware/` - Express middleware (clerk.middleware.ts, auth.middleware.ts, error handling)
- `types/` - TypeScript type definitions

### API Routes (All require Clerk authentication)
- `/api/browser/*` - Security test browser (Clerk auth)
- `/api/analytics/*` - Elasticsearch-based analytics (Clerk auth)
- `/api/auth/*` - Endpoint authentication (Clerk auth, rate limited: 20 req/15 min)
- `/api/endpoints/*` - Endpoint management (Clerk auth + LimaCharlie credentials)

## Key Patterns

### ES Module Imports (Backend)
Backend uses `.js` extensions in imports for ES module compatibility. This is required because TypeScript compiles to `.js` files:
```typescript
// Correct - use .js extension even though source is .ts
import browserRoutes from './api/browser.routes.js';
import { someUtil } from './utils/helper.js';

// Incorrect - will fail at runtime
import browserRoutes from './api/browser.routes';
```

### Protected Routes (Three-tier authentication)
1. **Global (Clerk)**: All routes wrapped with `<RequireAuth>` component
   - Unauthenticated users redirected to `/sign-in`
   - JWT token automatically injected into API requests via `useAuthenticatedApi` hook
2. **Analytics**: Uses `AnalyticsAuthProvider` context, redirects to `/analytics/setup` if not configured
3. **Endpoints**: Uses Redux `endpointAuth` slice, redirects to `/endpoints/login` if not authenticated

### Authentication Flow
**Browser Module:**
- Clerk authentication only
- Access test browser and details

**Analytics Module:**
- Clerk authentication required
- Configuration check (Elasticsearch settings)
- Redirect to setup if not configured

**Endpoints Module (Dual Auth):**
- Clerk authentication required
- LimaCharlie credentials required
- Session linked to Clerk user ID for isolation

### API Proxying
Vite proxies `/api` requests to backend at `http://localhost:$VITE_BACKEND_PORT` (default 3000)

### Commit Convention
Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
<type>(<scope>): <description>
```
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
Example: `feat(analytics): add trend visualization chart`
