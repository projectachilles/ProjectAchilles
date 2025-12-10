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

- Node.js 18.x or higher
- npm 9.x or higher
- Git

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ProjectAchilles.git
   cd ProjectAchilles
   ```

3. **Add the upstream remote**
   ```bash
   git remote add upstream https://github.com/ubercylon8/ProjectAchilles.git
   ```

4. **Install dependencies and start development**
   ```bash
   ./start.sh
   ```

### Project Structure

```
ProjectAchilles/
├── frontend/          # React frontend application
├── backend/           # Express backend API
├── start.sh           # Development startup script
└── CLAUDE.md          # Development guidance
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
   - Test locally with `./start.sh`
   - Verify no TypeScript errors: `cd frontend && npm run build` and `cd backend && npm run build`

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

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Define explicit types for function parameters and return values
- Avoid `any` type; use `unknown` when type is truly unknown

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

### React Components

- Use functional components with hooks
- Place component-specific types in the same file
- Use named exports for components

```typescript
// Good
interface ButtonProps {
  variant: 'primary' | 'secondary';
  onClick: () => void;
  children: React.ReactNode;
}

export function Button({ variant, onClick, children }: ButtonProps) {
  // ...
}
```

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

### Examples

```bash
feat(analytics): add trend visualization chart
fix(endpoints): resolve session timeout issue
docs(readme): update installation instructions
refactor(browser): simplify test filtering logic
```

## Testing

### Manual Testing Checklist

Before submitting a PR, verify:

- [ ] Application starts without errors
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

## Documentation

### When to Update Documentation

- Adding new features
- Changing API endpoints
- Modifying configuration options
- Updating dependencies with breaking changes

### Documentation Files

- `README.md` - Project overview and quick start
- `CLAUDE.md` - AI assistant development guidance
- `CONTRIBUTING.md` - This file
- `SECURITY.md` - Security policy
- `CHANGELOG.md` - Version history

## Questions?

If you have questions about contributing, please open a GitHub issue with the "question" label.

---

Thank you for contributing to ProjectAchilles!
