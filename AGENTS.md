# AGENTS.md

## Project Overview
ProjectAchilles - Unified Security Platform: A full-stack TypeScript application with a React frontend, Express backend, and security testing capabilities.

## Commands

### Development
```bash
# Full stack (interactive mode)
./start.sh

# Full stack (daemon/background mode)
./start.sh --daemon

# Stop daemon processes
./start.sh --stop

# Kill existing processes and start fresh
./start.sh --kill
```

### Backend (ESM Node.js + Express)
```bash
cd backend
npm run dev        # Development with hot reload (tsx watch)
npm run build      # Compile TypeScript to dist/
npm run start      # Run compiled server
```

### Frontend (React + Vite)
```bash
cd frontend
npm run dev        # Start Vite dev server
npm run build      # TypeScript check + Vite build
npm run preview    # Preview production build
```

### Lint/Typecheck
- No ESLint/Prettier configured
- Rely on `npm run build` for strict TypeScript validation
- Backend: `tsc` compiles with strict settings
- Frontend: `tsc -b` runs project references build

### Tests
- No JS unit-test runner (Jest/Vitest not configured)
- Security tests are compiled and executed as standalone builds
- For single security-test build:
  ```bash
  bash tests_source/<uuid>/build_all.sh
  ```
  (when present in backend data directories)

## Code Style Guidelines

### TypeScript Configuration
- **Strict mode enabled** on both frontend and backend
- Target: ES2022
- Avoid `any` types; use proper type annotations
- Satisfy `noUnusedLocals` and `noUnusedParameters` compiler options
- Use `import type` for type-only imports (enforced by `verbatimModuleSyntax` in frontend)

### Import Conventions

#### Backend (ESM)
```typescript
// Always use .js extension for relative imports (ESM requirement)
import { router } from './api/foo.routes.js';
import type { MyType } from '../types/index.js';

// External imports first, then internal
import express from 'express';
import { asyncHandler } from '../middleware/error.middleware.js';
```

#### Frontend (Vite + TypeScript)
```typescript
// Prefer @/ alias for frontend/src
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

// Import grouping: external → internal → types
import React from 'react';
import { useDispatch } from 'react-redux';
import { AppError } from '@/utils/errors';
import type { AppDispatch } from '@/store';
```

### Formatting
- **2-space indentation**
- **Single quotes** for strings
- **Semicolons** required
- Keep diffs focused; avoid unrelated changes

### Naming Conventions
- Components: PascalCase (e.g., `AnalyticsDashboardPage.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useAuthenticatedApi.ts`)
- Services: camelCase (e.g., `settingsService`)
- Routes: kebab-case with `.routes.ts` suffix (e.g., `analytics.routes.ts`)
- Types/Interfaces: PascalCase (e.g., `AnalyticsQueryParams`)

### Error Handling

#### Backend (Express)
```typescript
// Wrap async handlers
import { asyncHandler, AppError } from '../middleware/error.middleware.js';

router.get('/endpoint', asyncHandler(async (req, res) => {
  if (!valid) {
    throw new AppError('Validation failed', 400);
  }
  res.json({ success: true, data: result });
}));
```

- Error responses follow pattern: `{ success: false, error: string }`
- 404 responses add `message` field: `{ success: false, error: 'Not Found', message: 'Cannot GET /url' }`
- Don't expose stack traces in production
- Let `errorHandler` middleware format all responses consistently

#### Frontend
- Use `<ErrorBoundary>` wrapper for component trees
- Handle async errors with try/catch and proper state updates

### Authentication & Authorization

#### Backend (Clerk)
```typescript
import { requireClerkAuth } from '../middleware/clerk.middleware.js';

// Protect all routes in router
router.use(requireClerkAuth());
```

#### Frontend (Clerk + Redux)
```typescript
// Wrap protected routes
import { RequireAuth } from '@/components/auth/RequireAuth';

<RequireAuth>
  <ProtectedComponent />
</RequireAuth>

// Use JWT interceptor for API calls
import { useAuthenticatedApi } from '@/hooks/useAuthenticatedApi';

function Component() {
  useAuthenticatedApi(); // Injects Bearer token via axios interceptor
}
```
- Never bypass `<RequireAuth>` gates
- Always use `useAuthenticatedApi` hook for JWT injection

### Component Patterns

#### React Components
```typescript
// Use type for props
interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
}

export function Button({ children, onClick }: ButtonProps) {
  return <button onClick={onClick}>{children}</button>;
}
```

#### Custom Hooks
```typescript
// Follow React naming convention
export function useCustomHook() {
  const [state, setState] = useState();
  // Hook logic
  return { state, setter };
}
```

### Backend Architecture
- **Routes**: Define in `src/api/` with `.routes.ts` suffix
- **Middleware**: Place in `src/middleware/`
- **Services**: Business logic in `src/services/<domain>/`
- **Types**: Shared types in `src/types/`

### Frontend Architecture
- **Components**: Reusable UI in `src/components/ui/`, feature-specific in `src/components/<feature>/`
- **Pages**: Route-level components in `src/pages/`
- **Hooks**: Custom hooks in `src/hooks/`
- **Services**: API clients in `src/services/api/`
- **Store**: Redux store and slices in `src/store/`
- **Types**: Shared types in `src/types/`

## Project Structure
```
/home/jimx/F0RT1KA/ProjectAchilles/
├── AGENTS.md              # This file
├── start.sh               # Development startup script
├── backend/               # Express + TypeScript backend
│   ├── package.json       # ESM Node.js dependencies
│   ├── tsconfig.json      # Strict TypeScript config
│   └── src/
│       ├── server.ts      # Entry point
│       ├── api/           # Route definitions
│       ├── middleware/    # Express middleware
│       ├── services/      # Business logic
│       └── types/         # TypeScript types
├── frontend/              # React + Vite frontend
│   ├── package.json       # React 19 + Vite dependencies
│   ├── vite.config.ts     # Vite + proxy config
│   ├── tsconfig.app.json  # Strict TypeScript config
│   └── src/
│       ├── main.tsx       # Entry point
│       ├── App.tsx        # Root component
│       ├── components/    # React components
│       ├── pages/         # Page components
│       ├── hooks/         # Custom hooks
│       ├── services/      # API clients
│       ├── store/         # Redux store
│       └── types/         # TypeScript types
└── tests_source/          # Security test definitions (when present)
```

## Cursor/Copilot Rules
- No custom rules found in `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md`
- Follow conventions established in this AGENTS.md file

## Environment Variables
- Backend: Standard `PORT` (default: 3000)
- Frontend: `VITE_API_URL`, `VITE_BACKEND_PORT`, `VITE_CLERK_PUBLISHABLE_KEY`

## Important Notes
- Backend uses ES modules (`"type": "module"`); always include `.js` in relative imports
- Frontend uses `@/` path alias resolved by Vite
- Both projects use strict TypeScript; builds will fail on type errors
- Clerk authentication is required; don't disable auth checks in dev
- Security tests in `tests_source/` are compiled and run as standalone binaries
