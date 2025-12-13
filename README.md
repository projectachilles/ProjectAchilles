# ProjectAchilles

<div align="center">

![ProjectAchilles](https://img.shields.io/badge/ProjectAchilles-Security%20Platform-blue?style=for-the-badge)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org/)

**A Unified Security Testing Platform**

[Features](#features) • [Quick Start](#quick-start) • [Architecture](#architecture) • [Documentation](#documentation) • [Contributing](#contributing)

</div>

---

## Overview

ProjectAchilles is a comprehensive security testing platform that provides a unified interface for browsing security tests, analyzing test results, and managing endpoints. Built with modern web technologies, it offers a seamless experience for security professionals to assess and improve their organization's security posture.

## Features

### 🔐 Secure Authentication
- Social login via Clerk (Google, Microsoft, GitHub)
- Enterprise-grade security with JWT and httpOnly cookies
- Session isolation per authenticated user
- Automatic token refresh and management

### 🔍 Security Test Browser
- Browse and search security test cases
- View detailed test documentation and procedures
- Filter tests by MITRE ATT&CK techniques, platforms, and categories
- Access test artifacts and supporting files

### 📊 Analytics Dashboard
- Visualize test execution results via Elasticsearch integration
- Track defense scores and security metrics over time
- Analyze technique coverage and detection gaps
- Generate reports on security posture trends

### 🖥️ Endpoint Management
- Manage endpoints via LimaCharlie integration
- Monitor sensor status and health
- View endpoint inventory across organizations
- Real-time endpoint telemetry

## Quick Start

### Prerequisites

- **Node.js** 18.x or higher
- **npm** 9.x or higher
- **Git**

### Installation

```bash
# Clone the repository
git clone https://github.com/ubercylon8/ProjectAchilles.git
cd ProjectAchilles

# Start the full stack (installs dependencies automatically)
./start.sh
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000

### Configuration

#### Authentication (Required)
1. Create a Clerk account at https://clerk.com
2. Create a new application and enable social providers (Google, Microsoft, GitHub)
3. Copy your API keys to `.env` files:

```bash
# Frontend .env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# Backend .env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

4. Access the application at http://localhost:5173 and sign in

#### Analytics Module (Optional)
Navigate to `/analytics/setup` to configure your Elasticsearch connection for test results analytics.

#### Endpoints Module (Optional)
Navigate to `/endpoints/login` to authenticate with your LimaCharlie credentials for endpoint management.

## Architecture

```
ProjectAchilles/
├── frontend/                 # React 19 + TypeScript + Vite
│   ├── src/
│   │   ├── components/       # Shared UI components
│   │   │   ├── auth/         # Authentication components
│   │   │   └── shared/       # Reusable UI components
│   │   ├── pages/            # Module-specific pages
│   │   │   ├── auth/         # Sign in/up pages
│   │   │   ├── browser/      # Security test browser
│   │   │   ├── analytics/    # Analytics dashboard
│   │   │   └── endpoints/    # Endpoint management
│   │   ├── services/api/     # API client modules
│   │   ├── hooks/            # Custom React hooks
│   │   ├── store/            # Redux state management
│   │   └── routes/           # React Router configuration
│   └── package.json
├── backend/                  # Express + TypeScript
│   ├── src/
│   │   ├── api/              # Route handlers
│   │   ├── services/         # Business logic by module
│   │   ├── middleware/       # Express middleware (auth, Clerk)
│   │   └── types/            # TypeScript definitions
│   └── package.json
├── tests_source/             # Security test repository (20 tests)
│   └── {uuid}/               # Individual test directories
│       ├── {uuid}.go         # Test source code
│       ├── README.md         # Test documentation
│       ├── {uuid}_info.md    # Test metadata card
│       ├── *.kql             # Detection rules (KQL)
│       ├── *.yar             # Detection rules (YARA)
│       └── *.html            # Attack flow diagrams
├── start.sh                  # Unified startup script
└── CLAUDE.md                 # AI assistant guidance
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend Framework | React 19 |
| Build Tool | Vite 7 |
| Styling | Tailwind CSS 4 |
| State Management | Redux Toolkit |
| Routing | React Router 7 |
| Authentication | Clerk |
| Backend Framework | Express |
| Language | TypeScript 5 |
| Analytics Backend | Elasticsearch |
| Endpoint Backend | LimaCharlie |

## API Reference

> **Note:** All API endpoints require Clerk authentication. Include the JWT token in the `Authorization: Bearer <token>` header.

### Browser Module
| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `GET /api/browser/tests` | List all security tests | Clerk |
| `GET /api/browser/tests/:uuid` | Get test details | Clerk |
| `GET /api/browser/tests/:uuid/files` | Get test files | Clerk |

### Analytics Module
| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `POST /api/analytics/settings` | Configure Elasticsearch | Clerk |
| `POST /api/analytics/settings/test` | Test Elasticsearch connection | Clerk |
| `GET /api/analytics/defense-score` | Get defense score metrics | Clerk |
| `GET /api/analytics/executions` | List test executions | Clerk |

### Endpoints Module
| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `POST /api/auth/login` | Authenticate with LimaCharlie | Clerk |
| `GET /api/auth/session` | Get current session info | Clerk |
| `POST /api/auth/logout` | Clear session | Clerk |
| `GET /api/endpoints/sensors` | List sensors | Clerk + LC |
| `GET /api/endpoints/tasks` | List tasks | Clerk + LC |
| `GET /api/endpoints/payloads` | List payloads | Clerk + LC |

**Auth Legend:**
- **Clerk**: Requires Clerk JWT authentication
- **Clerk + LC**: Requires both Clerk authentication and LimaCharlie credentials

## Documentation

- [CLAUDE.md](CLAUDE.md) - AI assistant guidance for development
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [SECURITY.md](SECURITY.md) - Security policy
- [CHANGELOG.md](CHANGELOG.md) - Version history
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Community guidelines

## Development

### Running Individual Services

```bash
# Frontend only
cd frontend && npm run dev

# Backend only
cd backend && npm run dev
```

### Building for Production

```bash
# Frontend
cd frontend && npm run build

# Backend
cd backend && npm run build
```

### Environment Variables

#### Frontend
| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | ✅ Yes |
| `VITE_BACKEND_PORT` | Backend port for Vite proxy | No (default: 3000) |

#### Backend
| Variable | Description | Required |
|----------|-------------|----------|
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key | ✅ Yes |
| `CLERK_SECRET_KEY` | Clerk secret key | ✅ Yes |
| `PORT` | Backend server port | No (default: 3000) |
| `SESSION_SECRET` | Express session secret | ⚠️ Yes (production) |
| `CORS_ORIGIN` | Allowed CORS origin | No (default: localhost:5173) |
| `TESTS_SOURCE_PATH` | Path to security tests directory | No (default: ./tests_source) |

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For security concerns, please review our [Security Policy](SECURITY.md) and report vulnerabilities responsibly.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with security in mind**

</div>
