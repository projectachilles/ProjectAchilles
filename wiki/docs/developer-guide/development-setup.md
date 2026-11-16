---
sidebar_position: 1
title: "Development Setup"
description: "Set up your development environment for contributing to ProjectAchilles."
---

# Development Setup

## Prerequisites

- **Node.js** 22.x or higher
- **npm** 10.x or higher
- **Git**
- **Go** 1.26+ (optional — only needed for agent and installer development; the exact version is in `agent/go.mod`)
- **Docker** and Docker Compose (optional — for containerized development)

## Getting Started

### 1. Fork and Clone

```bash
git clone https://github.com/YOUR_USERNAME/ProjectAchilles.git
cd ProjectAchilles
git remote add upstream https://github.com/projectachilles/ProjectAchilles.git
```

### 2. Install Dependencies and Start

```bash
./scripts/start.sh -k --daemon
```

This installs npm dependencies for both frontend and backend, finds available ports, and starts both services.

### 3. Configure Authentication

Create `frontend/.env` and `backend/.env` with your Clerk keys. See [Quick Start — Local Dev](../getting-started/quick-start-local) for details.

## Development Commands

```bash
# Full stack
./scripts/start.sh -k --daemon   # Start (kill existing first)
./scripts/start.sh --stop        # Stop

# Individual services
cd frontend && npm run dev       # Vite dev server (port 5173)
cd backend && npm run dev        # tsx watch with hot reload (port 3000)

# TypeScript validation
cd frontend && npm run build     # tsc -b + vite build
cd backend && npm run build      # tsc -> dist/, then type-checks backend/scripts/

# Tests
cd backend && npm test
cd frontend && npm test
cd backend-serverless && npm test
cd agent && go test ./...        # Go agent
cd installer && go test ./...    # achilles-installer
```

## Branching Strategy

- `main` — Production-ready code
- `feature/*` — New features
- `fix/*` — Bug fixes
- `docs/*` — Documentation updates
- `refactor/*` — Code refactoring
