# AGENTS.md

## Commands
- Full stack: `./start.sh` (or `./start.sh --kill`)
- Backend: `cd backend && npm run dev|build|start`
- Frontend: `cd frontend && npm run dev|build|preview`
- Lint/typecheck: no ESLint/Prettier configured; rely on `npm run build` (strict TS)
- Tests: no JS unit-test runner; for a single security-test build run `bash tests_source/<uuid>/build_all.sh` (when present)

## Code Style
- TypeScript strict; avoid `any`; satisfy `noUnusedLocals`/`noUnusedParameters`
- Use `import type` for type-only imports
- Backend is ESM: keep relative imports with `.js` extension (e.g. `./api/foo.routes.js`)
- Express handlers: wrap with `asyncHandler`; throw `AppError`; let `errorHandler` format responses
- Error responses follow `{ success: false, error: ... }` (404 adds `message`); don’t expose stacks in production
- Frontend: prefer `@/...` alias for `frontend/src`; keep imports grouped (external → internal)
- Auth: don’t bypass Clerk; keep `<RequireAuth>` gates and `useAuthenticatedApi` JWT injection
- Formatting: 2-space indent, single quotes, semicolons; keep diffs focused

- Cursor/Copilot rules: none found in `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`
