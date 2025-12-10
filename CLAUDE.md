# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ProjectAchilles is a Unified Security Platform with three main modules:
- **Browser Module**: Security test browsing and viewing (public access)
- **Analytics Module**: Test results analytics via Elasticsearch (settings-based auth)
- **Endpoints Module**: Endpoint management via LimaCharlie (session-based auth)

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

## Architecture

### Frontend (`frontend/src/`)
- **React 19** with **TypeScript**, **Vite**, and **Tailwind CSS v4**
- **Redux Toolkit** for state management (endpoint auth)
- **React Router v7** for routing
- Path alias: `@/` maps to `src/`

Key directories:
- `pages/` - Module-specific page components (browser/, analytics/, endpoints/)
- `components/shared/` - Reusable UI components (Layout, Header, ErrorBoundary)
- `components/shared/ui/` - Base UI primitives (Button, Card, Input, etc.)
- `services/api/` - API client modules (browser.ts, analytics.ts, endpoints.ts)
- `hooks/` - Custom hooks (useTheme, useAnalyticsAuth)
- `store/` - Redux store configuration and slices
- `routes/AppRouter.tsx` - All routing with protected route wrappers

### Backend (`backend/src/`)
- **Express** with **TypeScript** (ES modules)
- Organized by module with routes and services

Key directories:
- `api/` - Route handlers (browser.routes.ts, analytics.routes.ts, endpoints.routes.ts)
- `services/` - Business logic organized by module (browser/, analytics/, endpoints/)
- `middleware/` - Express middleware (error handling)
- `types/` - TypeScript type definitions

### API Routes
- `/api/browser/*` - Security test browser (public)
- `/api/analytics/*` - Elasticsearch-based analytics
- `/api/auth/*` - Endpoint authentication (rate limited)
- `/api/endpoints/*` - Endpoint management

## Key Patterns

### Protected Routes
- **Analytics**: Uses `AnalyticsAuthProvider` context, redirects to `/analytics/setup` if not configured
- **Endpoints**: Uses Redux `endpointAuth` slice, redirects to `/endpoints/login` if not authenticated

### API Proxying
Vite proxies `/api` requests to backend at `http://localhost:$VITE_BACKEND_PORT` (default 3000)

### Module Imports
Backend uses `.js` extensions in imports for ES module compatibility:
```typescript
import browserRoutes from './api/browser.routes.js';
```
