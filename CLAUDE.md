# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ProjectAchilles is a purple team platform for continuous security validation. It deploys a custom Go agent to endpoints, executes security tests, and measures detection coverage via Elasticsearch analytics.

**Modules:**
- **Browser**: Git-synced test library with MITRE ATT&CK mapping, build/sign/download (Clerk auth)
- **Analytics**: 30+ Elasticsearch query endpoints — defense scores, heatmaps, treemaps, trends (Clerk auth)
- **Agent**: Custom Go agent enrollment, heartbeat monitoring, task execution, scheduling (Clerk auth + SQLite)

## Development Commands

```bash
# Full stack (auto port detection, installs deps)
./start.sh -k --daemon           # Kill existing processes and start fresh
./start.sh --stop                # Stop daemon processes

# Individual services
cd frontend && npm run dev       # Vite dev server (port 5173)
cd backend && npm run dev        # tsx watch with hot reload (port 3000)

# TypeScript validation
cd frontend && npm run build     # tsc -b + vite build
cd backend && npm run build      # tsc → dist/
```

### Testing (Vitest)

```bash
# All tests
cd backend && npm test           # 176 tests across 10 files (~10s)
cd frontend && npm test          # 119 tests across 7 files (~2s)

# Single file
cd backend && npx vitest src/services/agent/__tests__/enrollment.service.test.ts
cd frontend && npx vitest src/hooks/__tests__/useAnalyticsFilters.test.ts

# Filter by test name
cd backend && npx vitest -t "creates a token"

# Watch mode / coverage
cd backend && npm run test:watch
cd backend && npm run test:coverage
```

Test file pattern: `src/**/__tests__/**/*.test.{ts,tsx}`

### Go Agent

```bash
cd agent && make build-all       # Cross-compile Windows + Linux (amd64)
cd agent && make sign-windows    # Build + Authenticode sign
cd agent && go test ./...        # Run Go tests
cd agent && go build ./...       # Validate compilation
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
- `hooks/` - Custom hooks (`useAuthenticatedApi` injects JWT automatically)
- `store/` - Redux slices; use typed hooks `useAppDispatch`/`useAppSelector` (not raw `useDispatch`/`useSelector`)

### Backend (`backend/src/`)
- **Express** + **TypeScript** (ES modules)
- **Clerk** for auth (`@clerk/express`)

Key directories:
- `api/` - Route handlers (`*.routes.ts`)
- `services/` - Business logic organized by module:
  - `agent/` - Enrollment, heartbeat, tasks, schedules, update, database
  - `analytics/` - Elasticsearch queries, client factory, encrypted settings
  - `browser/` - Git sync, test indexing, metadata extraction
  - `tests/` - Go cross-compilation (build service), multi-cert management
- `middleware/` - Auth, error handling, rate limiting

### Agent (`agent/`)
- **Go 1.24** — lightweight binary with enrollment, heartbeat, task execution, self-update
- Internal packages: `config`, `enrollment`, `executor`, `httpclient`, `poller`, `reporter`, `service`, `store`, `sysinfo`, `updater`
- CGO disabled for static cross-platform binaries
- Version set via LDFLAGS: `-X main.version=$(VERSION)`

### Database (SQLite)
- **Location**: `~/.projectachilles/agents.db` (better-sqlite3, WAL mode)
- **Schema**: Created via `CREATE TABLE IF NOT EXISTS` in `backend/src/services/agent/database.ts` — no migration system
- **Tables**: `agents`, `enrollment_tokens`, `tasks`, `agent_versions`, `schedules`
- **Settings storage**: `~/.projectachilles/` — `analytics.json` (AES-256-GCM encrypted), `tests.json`, `certs/`

### API Routes
| Route | Auth | Purpose |
|-------|------|---------|
| `/api/browser/*` | Clerk | Security test browser |
| `/api/analytics/*` | Clerk | Elasticsearch analytics |
| `/api/agent/admin/*` | Clerk | Agent management (tokens, tasks, schedules) |
| `/api/agent/*` | Agent key | Device endpoints (enroll, heartbeat, tasks) |
| `/api/tests/*` | Clerk | Build system, certificates |

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
3. **Agent admin**: Clerk JWT required; device endpoints use agent API key (hashed in DB)

### Backend Test Pattern
Tests use in-memory SQLite via `createTestDatabase()` from `backend/src/__tests__/helpers/db.ts`. The `vi.mock` + dynamic import ordering is critical:
```typescript
let testDb: Database.Database;
vi.mock('../database.js', () => ({ getDatabase: () => testDb }));
// Import the module AFTER mock setup
const { functionToTest } = await import('../service.js');
```

Frontend tests mock all Clerk hooks globally via `frontend/src/__tests__/setup.ts`.

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
Scopes: `frontend`, `backend`, `agent`, `analytics`, `browser`, `docker`, `settings`, `certs`, `deps`

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to main:
- `test-backend`: npm ci → build → test
- `test-frontend`: npm ci → build → test
- Node 22

## Docker

```bash
docker compose up -d                            # Backend + frontend
docker compose --profile elasticsearch up -d    # Include ES + synthetic seed data
```

The `elasticsearch` profile starts ES 8.17 (single-node, security disabled) and seeds 1000 synthetic test results.

## Browser Testing

Two browser tools are available for visual verification. **Prefer the Claude Code Chrome Extension** (uses real browser with auth sessions); fall back to **Playwright** (`mcp__plugin_playwright_playwright__*`) for headless screenshots, drag-and-drop, file uploads, `browser_wait_for`, or programmatic JS execution.

### Workflow
1. Start dev server: `./start.sh -k --daemon`
2. Navigate to `http://localhost:5173`
3. When encountering Clerk login, ask the user for credentials — never guess
4. For Analytics setup, read Elasticsearch credentials from `backend/.env`

## Gotchas

### SVG Text Stroke Inheritance in Recharts
When writing custom `content` renderers for Recharts components (Treemap, etc.), always set `stroke="none"` on `<text>` elements. Recharts sets `stroke="var(--background)"` on the parent SVG container for cell borders, and SVG `stroke` is an inherited property — it cascades to all children including text. In dark mode `--background` is near-black, so text renders with a visible dark outline around every glyph. In light mode the stroke is white-on-white (invisible), making the bug theme-specific and easy to miss.

### Certificate System
- Multi-cert storage: `~/.projectachilles/certs/cert-<timestamp>/` (max 5)
- Active cert tracked in `active-cert.txt`
- Legacy flat files auto-migrate to subdirectory on first `listCertificates()` call
- Build service reads active cert dynamically via `settingsService.getActiveCertPfxPath()`
