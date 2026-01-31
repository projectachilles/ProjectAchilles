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
./start.sh -k --daemon           # RECOMMENDED: Kill existing processes and start fresh
# ./start.sh              # Starts both frontend and backend (may fail if ports in use)

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

## Browser Testing with Chrome DevTools MCP

This project has Chrome DevTools MCP configured (`.mcp.json`). Use it for visual verification, debugging, and UI testing.

### When to Use Chrome DevTools
- **Visual verification**: After implementing UI changes, take screenshots to verify
- **Debugging**: Inspect network requests, console errors, DOM state
- **Form testing**: Fill forms, click buttons, verify interactions
- **Performance**: Record traces for performance analysis

### Workflow
1. Start dev server: `./start.sh -k --daemon`
2. Navigate: `mcp__chrome-devtools__navigate_page` to `http://localhost:5173`
3. Inspect: `mcp__chrome-devtools__take_snapshot` for page structure
4. Screenshot: `mcp__chrome-devtools__take_screenshot` for visual verification

### Handling Login Pages
When encountering a login page (Clerk auth, external services):
1. **Detect**: Check snapshot for login form elements (email/password inputs, sign-in buttons)
2. **Ask user**: Request credentials using `AskUserQuestion` tool:
   ```
   "I've encountered a login page. Please provide credentials to continue:
   - Email/username
   - Password"
   ```
3. **Never assume**: Do not guess or use placeholder credentials
4. **Fill securely**: Use `mcp__chrome-devtools__fill_form` for credential entry
5. **Verify**: Take snapshot after login to confirm success

### Common Tools
| Tool | Purpose |
|------|---------|
| `navigate_page` | Go to URL, back/forward, reload |
| `take_snapshot` | Get page accessibility tree (prefer over screenshot) |
| `take_screenshot` | Visual capture for verification |
| `click` | Click elements by uid from snapshot |
| `fill` / `fill_form` | Enter text in inputs |
| `evaluate_script` | Run JavaScript in page context |
| `list_console_messages` | Check for errors |
| `list_network_requests` | Debug API calls |

### Security Notes
- Never log or display credentials in output
- Credentials entered via MCP are visible to the browser - use dev/test accounts
- Avoid testing with production credentials
