# Changelog

All notable changes to ProjectAchilles will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Agent System
- Custom Go agent (`agent/`) with enrollment, heartbeat, task execution, and self-updating
- Token-based enrollment with configurable TTL and max uses
- Heartbeat monitoring with real-time system metrics (CPU, memory, disk, uptime)
- Task queue with priority-based assignment and state machine (pending → assigned → downloading → executing → completed)
- SHA256 binary verification before execution
- Stdout/stderr capture with 1MB limit per execution
- Agent tagging system for filtering and bulk operations
- Agent admin dashboard with search, filtering, and status indicators
- Agent soft-delete and status management (active/inactive)
- Silent auto-polling on Agents and Tasks pages
- Self-update mechanism — agents poll for new versions and auto-apply
- System service installation (systemd on Linux, SCM on Windows)
- Cross-platform support: Windows/Linux × amd64/arm64
- Agent API key authentication middleware (separate from Clerk)
- Public binary download endpoint with rate limiting (10 req/15min)

#### Build System
- On-demand Go cross-compilation from the UI
- Target platform selection (Linux/Windows × amd64/arm64)
- Windows Authenticode code signing via osslsigncode
- Multi-certificate management — upload PFX/P12 or generate self-signed (up to 5)
- Active certificate tracking with label editing
- Embed dependency detection (`//go:embed` directive scanning)
- Embed file upload for tests that embed resources
- Build caching in `~/.projectachilles/builds/`
- Build metadata tracking (platform, filename, signed status, file size, timestamp)
- Certificate storage in `~/.projectachilles/certs/cert-<timestamp>/` subdirectories
- Legacy flat-file certificate migration on first `listCertificates()` call

#### Task Scheduling
- Recurring test execution schedules (once, daily, weekly, monthly)
- Timezone-aware scheduling with DST handling
- Randomized execution time option (office hours weekdays, anytime weekends)
- Per-task Elasticsearch index targeting for result isolation
- Task notes with version tracking and edit history
- Copy-to-clipboard for stdout/stderr in task detail view
- Schedule pause/resume and soft-delete
- Background scheduler processing with automatic next-run calculation

#### Analytics
- 30+ analytics query endpoints covering defense scoring, coverage, and error analysis
- Defense score trend with rolling-window aggregation (1–90 day windows)
- Defense score breakdowns by test, technique, category, hostname, severity, and organization
- Host-test matrix endpoint for heatmap visualization
- Threat actor coverage metrics
- Error rate trend analysis with stacked area chart
- Canonical error code mapping and redesigned error type chart
- Three-state result classification (Protected / Unprotected / Inconclusive)
- Paginated execution results with advanced multi-field filtering
- Available-values catalog endpoints (tests, techniques, hostnames, categories, severities, threat actors, tags, error names, error codes)
- Multi-index management — list indices, create indices, set active index pattern
- Canonical test count with rolling 90-day window for stable coverage denominators
- Nested donut chart for category/subcategory breakdown
- Clickable hosts in "Others" aggregation with drill-down
- Forward-fill (LOCF) for defense score trend gaps
- Environment variable support for Elasticsearch configuration
- User-configured settings take priority over environment variables
- Auto-test connection on save for immediate UX feedback
- Fire-and-forget result ingestion — agent results auto-ingest to ES asynchronously

#### Browser
- Git-synced test library with automatic repository sync
- Favorites and recent views with localStorage persistence
- Version, author, and Git modification dates on test cards
- Copy-to-clipboard for detection rules and test artifacts
- Build, sign, and download test binaries from test detail pages
- Searchable test selector in task creation dialog

#### Docker & Deployment
- Docker Compose support with multi-service configuration (frontend, backend)
- Optional Elasticsearch profile (`--profile elasticsearch`)
- Elasticsearch seeding service with 1000 synthetic results
- Interactive setup wizard (`setup.sh`) with TUI (whiptail/dialog)
- Non-interactive setup mode for automation
- ngrok tunnel support with configurable domains
- ENCRYPTION_SECRET for stable encryption across container restarts
- Health checks for backend and Elasticsearch services
- Go toolchain and osslsigncode in Docker image for builds

#### Frontend
- Collapsible sidebar layout
- Dark/light theme improvements with consistent text colors
- Responsive design updates across all modules

#### Authentication
- Clerk authentication with social login (Google, Microsoft, GitHub)
- `RequireAuth` component for route protection
- `useAuthenticatedApi` hook for automatic JWT injection
- Session isolation per authenticated user
- Rate limiting on authentication endpoints (20 req/15min)

### Changed
- **BREAKING**: Removed LimaCharlie integration — replaced by custom agent system
- **BREAKING**: All routes now require Clerk authentication (Browser was previously public)
- **BREAKING**: Endpoints module replaced by Agents module
- Replaced stacked bar charts with horizontal single-bar layout for clarity
- Replaced dashboard widgets with simpler alternatives
- Migrated charts to consistent UI patterns
- Redistributed analytics filters — date range in tab bar, filter panel in table toolbar
- ASCII banner updated from "PROJECT" to "ACHILLES"
- Start script supports `--daemon` mode for background operation and `-k` flag for killing existing processes

### Fixed
- SQLite UTC timestamp parsing in `timeAgo` display
- Docker env file no longer overrides `AGENT_SERVER_URL` from env_file
- Agent build copies source to temp directory for read-only Docker mounts
- Elasticsearch field mapping queries for enriched fields
- Index pattern selection persistence across sessions
- Stacked bar charts showing all data series correctly
- Analytics setup redirect loop
- Tab parameter preservation when syncing filter URL params
- Non-conclusive results excluded from defense score calculations
- Dashboard data refresh when credentials or index pattern change
- Non-test data filtered from analytics queries
- LOCF threshold logic for sparse trend data
- Synthetic data generator error code distribution
- Local Docker ES support with no-auth and correct field mappings
- Elasticsearch Python client pinned to v8 for ES 8.17 compatibility
- Setup script guarded `&&` conditionals against `set -e`
- Setup wizard plain-text newline rendering
- Delete filter alignment in agent management
- Windows SCM handshake in agent service installation
- Agent version reporting
- Task creator dialog effect stabilization and checkbox visibility
- Tag API route alignment between frontend and backend

### Security
- Upgraded React to 19.2.3 (CVE-2025-55182 patch)
- Code signing for test binaries with Authenticode
- Certificate password encryption at rest
- Enrollment token validation with TTL and usage limits
- Agent API key authentication (separate from web UI)
- SHA256 binary verification in agent executor
- Resolved all Dependabot security vulnerabilities
- Added Dependabot configuration for automated dependency updates

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

[Unreleased]: https://github.com/projectachilles/ProjectAchilles/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/projectachilles/ProjectAchilles/releases/tag/v1.0.0
