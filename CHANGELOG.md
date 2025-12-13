# Changelog

All notable changes to ProjectAchilles will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Authentication System**: Global authentication using Clerk with social login support
  - Social providers: Google, Microsoft, GitHub
  - JWT-based authentication with httpOnly cookies
  - Session isolation per authenticated user
  - Automatic token refresh and management
- **Frontend Authentication**:
  - Sign-in, sign-up, and user profile pages
  - `RequireAuth` component for route protection
  - `useAuthenticatedApi` hook for automatic JWT injection
  - UserButton component in header for account management
- **Backend Authentication**:
  - Clerk middleware for JWT verification
  - `requireClerkAuth()` middleware for route protection
  - Session linking to Clerk user ID
  - Enhanced dual authentication for Endpoints module
- **Navigation Improvements**:
  - "Back to Tests" button on Analytics setup page
  - "Back to Tests" button on Endpoints login page
  - Removed duplicate navigation buttons
- Updated documentation (README, CLAUDE.md, CHANGELOG)

### Changed
- **BREAKING**: All routes now require Clerk authentication
- Browser Module now requires authentication (previously public)
- Analytics Module requires Clerk auth + Elasticsearch configuration
- Endpoints Module requires Clerk auth + LimaCharlie credentials (dual auth)
- All API endpoints require valid JWT token in Authorization header

### Security
- JWT-based authentication with short-lived tokens
- httpOnly cookies for XSS protection
- Session validation against Clerk user ID
- Prevention of session hijacking across users
- CORS configuration updated for authentication flow

## [1.0.0] - 2024-12-10

### Added

#### Core Platform
- Unified startup script (`start.sh`) with smart port detection and fallback
- Frontend/backend architecture with API proxying
- Dark/light theme support with system preference detection
- Error boundary for graceful error handling

#### Browser Module
- Security test browsing and viewing
- Test detail pages with metadata display
- File viewer for test artifacts
- Search and filtering capabilities

#### Analytics Module
- Elasticsearch integration for test results
- Settings-based authentication flow
- Dashboard with defense score metrics
- Trend visualization over time
- Technique breakdown analysis
- Test execution history

#### Endpoints Module
- LimaCharlie integration for endpoint management
- Session-based authentication with rate limiting
- Organization management
- Sensor inventory and status monitoring
- Real-time endpoint telemetry

#### UI Components
- Shared component library (Button, Card, Input, Select, Tabs, Badge, Alert, Spinner)
- Responsive layout with mobile support
- Accessible UI following WCAG guidelines

#### Developer Experience
- TypeScript throughout (frontend and backend)
- Path aliases (`@/` for imports)
- Hot reload for development
- Comprehensive CLAUDE.md for AI-assisted development

### Security
- Helmet.js for security headers
- CORS configuration
- Rate limiting on authentication endpoints
- Secure session management
- Input validation with Zod

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2024-12-10 | Initial release |

[Unreleased]: https://github.com/ubercylon8/ProjectAchilles/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ubercylon8/ProjectAchilles/releases/tag/v1.0.0
