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

## Browser Testing

Two browser tools are available for visual verification, debugging, and UI testing. **Prefer the Claude Code Chrome Extension by default**; fall back to Playwright when the extension lacks a needed capability.

### Tool Selection

| Use Case | Tool | Why |
|----------|------|-----|
| Interactive testing with Clerk auth | **CC Chrome Extension** | Uses the real browser with existing sessions/cookies |
| Visual verification of UI changes | **CC Chrome Extension** | Sees exactly what the user sees |
| Filling forms, clicking buttons | **CC Chrome Extension** | Works with real auth state |
| Headless/automated screenshots | **Playwright** | No real browser needed |
| Running custom JS on the page | **Playwright** (`browser_evaluate`, `browser_run_code`) | More powerful programmatic control |
| Multi-tab workflows | **Playwright** (`browser_tabs`) | Tab management API |
| Drag-and-drop testing | **Playwright** (`browser_drag`) | Not available in extension |
| File upload testing | **Playwright** (`browser_file_upload`) | Not available in extension |
| Waiting for async UI updates | **Playwright** (`browser_wait_for`) | Built-in wait primitives |

**Rule of thumb**: If the CC Chrome Extension has a tool for it, use that. If not, use Playwright.

### Workflow (CC Chrome Extension - Default)
1. Start dev server: `./start.sh -k --daemon`
2. Ensure the user has Chrome open with the Claude Code extension connected
3. Navigate to `http://localhost:5173`
4. Use snapshot/screenshot tools for verification

### Workflow (Playwright - Fallback)
1. Start dev server: `./start.sh -k --daemon`
2. Navigate: `mcp__plugin_playwright_playwright__browser_navigate` to `http://localhost:5173`
3. Inspect: `mcp__plugin_playwright_playwright__browser_snapshot` for page structure
4. Screenshot: `mcp__plugin_playwright_playwright__browser_take_screenshot` for visual verification

### Playwright Tool Reference
| Tool | Purpose |
|------|---------|
| `browser_navigate` | Go to URL |
| `browser_navigate_back` | Go back in history |
| `browser_snapshot` | Get page accessibility tree (prefer over screenshot) |
| `browser_take_screenshot` | Visual capture for verification |
| `browser_click` | Click elements by ref from snapshot |
| `browser_type` | Type text into elements |
| `browser_fill_form` | Fill multiple form fields |
| `browser_select_option` | Select dropdown options |
| `browser_evaluate` | Run JavaScript on page or element |
| `browser_run_code` | Run Playwright code snippets |
| `browser_console_messages` | Check for errors |
| `browser_network_requests` | Debug API calls |
| `browser_tabs` | List, create, close, select tabs |
| `browser_drag` | Drag and drop between elements |
| `browser_file_upload` | Upload files |
| `browser_wait_for` | Wait for text/element/time |
| `browser_press_key` | Press keyboard keys |
| `browser_hover` | Hover over elements |
| `browser_handle_dialog` | Accept/dismiss dialogs |
| `browser_resize` | Resize browser window |

All Playwright tools are prefixed with `mcp__plugin_playwright_playwright__`.

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
4. **Fill securely**: Use the appropriate fill/form tool for credential entry
5. **Verify**: Take snapshot after login to confirm success

### Analytics / Elasticsearch Credentials
When testing the Analytics module and you need Elasticsearch credentials (e.g., to configure the connection in Settings), pick them from `backend/.env` (Cloud ID, API Key, index pattern).

### Security Notes
- Never log or display credentials in output
- Credentials entered via browser tools are visible to the browser - use dev/test accounts
- Avoid testing with production credentials

## Gotchas

### SVG Text Stroke Inheritance in Recharts
When writing custom `content` renderers for Recharts components (Treemap, etc.), always set `stroke="none"` on `<text>` elements. Recharts sets `stroke="var(--background)"` on the parent SVG container for cell borders, and SVG `stroke` is an inherited property — it cascades to all children including text. In dark mode `--background` is near-black, so text renders with a visible dark outline around every glyph. In light mode the stroke is white-on-white (invisible), making the bug theme-specific and easy to miss.
