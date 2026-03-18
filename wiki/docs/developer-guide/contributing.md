---
sidebar_position: 11
title: "Contributing"
description: "How to contribute to ProjectAchilles — PR process, coding standards, and review requirements."
---

# Contributing

## Pull Request Process

1. Fork the repository and create a feature branch
2. Make your changes following the [coding standards](#coding-standards)
3. Ensure TypeScript compiles: `npm run build` in both frontend and backend
4. Run tests: `npm test` in the relevant directory
5. Create a PR with a clear description
6. Address review feedback

## PR Requirements

- [ ] Code follows project style guidelines
- [ ] TypeScript compiles without errors
- [ ] Self-review completed
- [ ] No sensitive data or credentials included
- [ ] Go agent compiles (if changed): `cd agent && go build ./...`

## Coding Standards

### TypeScript
- Strict mode enabled; avoid `any`
- Use `import type` for type-only imports
- Satisfy `noUnusedLocals`/`noUnusedParameters`

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Component files | PascalCase | `TestDetailPage.tsx` |
| Utility files | camelCase | `metadataExtractor.ts` |
| Route files | kebab-case | `browser.routes.ts` |
| Components | PascalCase | `SecurityTestCard` |
| Functions | camelCase | `fetchTestResults` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_ATTEMPTS` |
| Go packages | lowercase | `executor`, `sysinfo` |

## Questions?

Open a GitHub issue with the "question" label or start a [Discussion](https://github.com/projectachilles/ProjectAchilles/discussions).
