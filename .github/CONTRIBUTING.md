# Contributing to ProjectAchilles

Thank you for your interest in contributing to ProjectAchilles! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the maintainers.

## Getting Started

### Prerequisites

- **Node.js** 22.x or higher
- **npm** 10.x or higher
- **Git**
- **Go** 1.24+ (optional — only needed for agent development)
- **Docker** and Docker Compose (optional — for containerized development)

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ProjectAchilles.git
   cd ProjectAchilles
   ```

3. **Add the upstream remote**
   ```bash
   git remote add upstream https://github.com/projectachilles/ProjectAchilles.git
   ```

4. **Install dependencies and start development**
   ```bash
   ./scripts/start.sh -k --daemon
   ```

### Project Structure

```
ProjectAchilles/
├── frontend/              # React 19 + TypeScript + Vite
├── backend/               # Express + TypeScript (ES modules)
├── backend-serverless/    # Vercel serverless fork (Turso + Vercel Blob)
├── agent/                 # Go agent source (cross-platform)
├── scripts/               # Shell scripts (start.sh, setup.sh, etc.)
├── docs/                  # Documentation (deployment, security, plans)
├── docker-compose.yml     # Multi-service deployment
└── CLAUDE.md              # Development guidance
```

## Development Workflow

### Branching Strategy

We use a simplified Git flow:

- `main` - Production-ready code
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation updates
- `refactor/*` - Code refactoring

### Creating a Branch

```bash
# Sync with upstream
git fetch upstream
git checkout main
git merge upstream/main

# Create your branch
git checkout -b feature/your-feature-name
```

## Pull Request Process

1. **Update your branch** with the latest changes from main
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Ensure your changes work**
   - Test locally with `./scripts/start.sh -k --daemon`
   - Verify no TypeScript errors: `cd frontend && npm run build` and `cd backend && npm run build`
   - If modifying Go agent: `cd agent && go build ./...`
   - If modifying Docker: `docker compose build`

3. **Create a Pull Request**
   - Use a clear, descriptive title
   - Reference any related issues
   - Provide a summary of changes
   - Include screenshots for UI changes

4. **Address Review Feedback**
   - Respond to all comments
   - Make requested changes
   - Push updates to your branch

### PR Requirements

- [ ] Code follows project style guidelines
- [ ] TypeScript compiles without errors
- [ ] Self-review completed
- [ ] Documentation updated (if applicable)
- [ ] No sensitive data or credentials included
- [ ] Go agent compiles (if changed): `cd agent && go build ./...`
- [ ] Docker Compose builds (if changed): `docker compose build`

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Define explicit types for function parameters and return values
- Avoid `any` type; use `unknown` when type is truly unknown
- Use `import type` for type-only imports

```typescript
// Good
function processData(input: SecurityTest): ProcessedResult {
  // ...
}

// Avoid
function processData(input: any): any {
  // ...
}
```

### Frontend (React)

- Use functional components with hooks
- Place component-specific types in the same file
- Use named exports for components
- Use the `@/` path alias for imports within `frontend/src/`
- Wrap authenticated routes with `<RequireAuth>`
- Use the `useAuthenticatedApi` hook for API calls (auto-injects JWT)

```typescript
interface ButtonProps {
  variant: 'primary' | 'secondary';
  onClick: () => void;
  children: React.ReactNode;
}

export function Button({ variant, onClick, children }: ButtonProps) {
  // ...
}
```

### Backend (Express)

- **ES Module imports require `.js` extensions** — TypeScript compiles to `.js`, so runtime imports must use `.js`:
  ```typescript
  // Correct
  import browserRoutes from './api/browser.routes.js';

  // Incorrect — fails at runtime
  import browserRoutes from './api/browser.routes';
  ```
- Wrap async route handlers with `asyncHandler`
- Throw `AppError` for HTTP errors:
  ```typescript
  import { asyncHandler, AppError } from '../middleware/error.middleware.js';

  router.get('/resource/:id', asyncHandler(async (req, res) => {
    const item = await findItem(req.params.id);
    if (!item) throw new AppError('Resource not found', 404);
    res.json({ success: true, data: item });
  }));
  ```

### Agent (Go)

- Follow standard Go project layout (`internal/` for private packages)
- Use `context.Context` for cancellation and timeouts
- Handle errors explicitly — no panic in library code
- Test cross-compilation: `GOOS=linux GOARCH=amd64 go build ./...`

### File Organization

- **Frontend**
  - Components: `src/components/`
  - Pages: `src/pages/{module}/`
  - API services: `src/services/api/`
  - Hooks: `src/hooks/`
  - Types: `src/types/`

- **Backend**
  - Routes: `src/api/`
  - Services: `src/services/{module}/`
  - Types: `src/types/`
  - Middleware: `src/middleware/`

- **Agent**
  - CLI entry: `main.go`
  - Modules: `internal/{module}/`

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files (components) | PascalCase | `TestDetailPage.tsx` |
| Files (utilities) | camelCase | `metadataExtractor.ts` |
| Files (routes) | kebab-case | `browser.routes.ts` |
| Components | PascalCase | `SecurityTestCard` |
| Functions | camelCase | `fetchTestResults` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_ATTEMPTS` |
| Types/Interfaces | PascalCase | `TestMetadata` |
| Go packages | lowercase | `executor`, `sysinfo` |

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Scopes

Common scopes: `frontend`, `backend`, `backend-serverless`, `agent`, `analytics`, `browser`, `docker`, `settings`, `certs`, `deps`

### Examples

```bash
feat(agent): add self-update polling mechanism
feat(analytics): add defense score trend endpoint
fix(docker): stop overriding AGENT_SERVER_URL from env_file
refactor(browser): simplify test filtering logic
docs(readme): update architecture diagram
```

## Testing

### Automated Tests (Vitest)

```bash
# Backend (912 tests across 40 files)
cd backend && npm test

# Frontend (127 tests across 8 files)
cd frontend && npm test

# Backend Serverless (626 tests across 25 files)
cd backend-serverless && npm test

# Single test file
cd backend && npx vitest src/services/agent/__tests__/enrollment.service.test.ts

# Filter by test name
cd backend && npx vitest -t "creates a token"

# Watch mode
cd backend && npm run test:watch
```

Test file pattern: `src/**/__tests__/**/*.test.{ts,tsx}`

### Manual Testing Checklist

Before submitting a PR, verify:

- [ ] Application starts without errors (`./scripts/start.sh -k --daemon`)
- [ ] New features work as expected
- [ ] Existing features still work (no regressions)
- [ ] UI is responsive and accessible
- [ ] API endpoints return expected responses
- [ ] Error states are handled gracefully

### TypeScript Validation

```bash
# Frontend
cd frontend && npm run build

# Backend
cd backend && npm run build
```

### Go Validation (if applicable)

```bash
cd agent && go build ./...
cd agent && go test ./...
```

### Docker Validation (if applicable)

```bash
docker compose build
docker compose up -d
# Verify services are healthy
docker compose ps
```

## Documentation

### When to Update Documentation

- Adding new features
- Changing API endpoints
- Modifying configuration options
- Updating dependencies with breaking changes
- Adding new modules or services

### Documentation Files

- `README.md` - Project overview, features, and quick start
- `CLAUDE.md` - AI assistant development guidance
- `.github/CONTRIBUTING.md` - This file
- `.github/SECURITY.md` - Security policy and architecture
- `docs/CHANGELOG.md` - Version history
- `docs/ROADMAP.md` - Planned features and direction

## Releasing

Releases are managed through Claude Code commands and GitHub Actions. See `docs/RELEASING.md` for the full guide.

### Quick Reference

| Stream | Tag format | Workflow | Example |
|--------|-----------|----------|---------|
| Platform | `vX.Y.Z` | `release.yml` | `v2.0.0` |
| Agent | `agent-vX.Y.Z` | `release-agent.yml` | `agent-v0.7.0` |

### Process

1. Ensure all tests pass and you're on `main`
2. Run `/release` in Claude Code for an interactive flow, or manually:
   - Update version numbers in package.json files (platform) or Makefile + main.go (agent)
   - Update `docs/CHANGELOG.md` with a new version section
   - Commit: `chore(release): vX.Y.Z`
   - Tag: `git tag vX.Y.Z`
   - Push: `git push origin main --tags`
3. GitHub Actions automatically creates the GitHub Release
   - Agent releases also build, sign, and attach binaries for all platforms

### Who Can Release

Only members of `@projectachilles/maintainers` can push release tags. Tag protection rules are configured in the repository settings.

## Questions?

If you have questions about contributing, please open a GitHub issue with the "question" label or start a [Discussion](https://github.com/projectachilles/ProjectAchilles/discussions).

---

Thank you for contributing to ProjectAchilles!
