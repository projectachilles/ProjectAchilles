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
- **Go** 1.24+ (optional — only needed for agent development)
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
cd backend && npm run build      # tsc -> dist/

# Tests
cd backend && npm test           # 912 tests (~12s)
cd frontend && npm test          # 127 tests (~2s)
cd backend-serverless && npm test  # 626 tests (~11s)
```

## Branching Strategy

- `main` — Production-ready code
- `feature/*` — New features
- `fix/*` — Bug fixes
- `docs/*` — Documentation updates
- `refactor/*` — Code refactoring
