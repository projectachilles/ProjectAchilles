---
sidebar_position: 4
title: Quick Start — Local Dev
description: Get ProjectAchilles running locally for development in under 5 minutes.
---

# Quick Start — Local Development

Get ProjectAchilles running on your machine for development. This guide uses the development startup script that automatically detects your platform, installs missing dependencies, finds available ports, and starts both frontend and backend.

## Prerequisites

The start script automatically installs missing dependencies on supported platforms. You can also install them manually if preferred:

- **Node.js** 22.x or higher
- **npm** 10.x or higher
- **Git**
- **Go** 1.24+ (for agent development and building test binaries)

### Supported Platforms for Auto-Install

| Platform | Package Manager | Notes |
|----------|----------------|-------|
| Ubuntu / Debian / WSL | `apt` | Node.js via NodeSource, Go via official tarball |
| Fedora / RHEL / CentOS | `dnf` | Falls back to tarball if Go version is too old |
| Arch / Manjaro | `pacman` | |
| openSUSE / SLES | `zypper` | Node.js via NodeSource, Go via official tarball |
| macOS | `brew` | Requires [Homebrew](https://brew.sh) |

If your platform isn't listed, install the prerequisites manually before running the start script.

## Steps

### 1. Clone the Repository

```bash
git clone https://github.com/projectachilles/ProjectAchilles.git
cd ProjectAchilles
```

### 2. Start the Development Stack

```bash
./scripts/start.sh -k --daemon
```

This script will:
- Kill any existing ProjectAchilles processes (`-k`)
- Detect your platform and install missing system dependencies (Node.js, npm, Git, Go)
- **Guide you through Clerk authentication setup** (if not already configured)
- Install npm dependencies for both frontend and backend
- Find available ports (defaults: frontend 5173, backend 3000)
- Start both services in the background (`--daemon`)

On a fresh machine, the script will install dependencies, then walk you through Clerk setup:

```
Checking Clerk authentication...
  ✗ No valid Clerk keys configured

  ╭──────────────────────────────────────────────────────╮
  │  Clerk Setup (free account — takes ~2 minutes)       │
  │                                                      │
  │  1. Sign up or log in at clerk.com                   │
  │  2. Create a new application                         │
  │  3. Go to "API Keys" in the sidebar                  │
  │  4. Copy both keys below                             │
  ╰──────────────────────────────────────────────────────╯

  Press Enter to open Clerk in your browser (or S to skip):
```

The script opens Clerk's dashboard in your browser, prompts you for both keys, validates them against Clerk's API, and writes them to both `backend/.env` and `frontend/.env` automatically.

:::tip Already Have Clerk Keys?
If you've set up Clerk before, just add `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `backend/.env` before running the script — it will detect them and skip the interactive setup.
:::

### 3. Open the Dashboard

Navigate to **http://localhost:5173** in your browser. You'll be redirected to Clerk's sign-in page. After authenticating, you'll see the Test Browser.

## Optional: Elasticsearch

The Analytics module requires an Elasticsearch connection. You can either:

**Option A — Use Elastic Cloud (recommended for production):**
1. Create a free trial at [elastic.co](https://www.elastic.co/cloud)
2. Add credentials to `backend/.env`:

```bash
ELASTICSEARCH_CLOUD_ID=your_cloud_id
ELASTICSEARCH_API_KEY=your_api_key
```

**Option B — Use local Elasticsearch via Docker:**

```bash
docker compose --profile elasticsearch up -d
```

This starts Elasticsearch 8.17 (single-node, security disabled) and seeds 1,000 synthetic test results.

The local ES instance is available at `http://localhost:9200` — no credentials needed.

## Optional: Test Library

To populate the Test Browser, configure a Git repository containing security tests:

```bash
# In backend/.env
TESTS_REPO_URL=https://github.com/your-org/your-test-library.git
```

The backend will clone and sync the test library on startup. **No GitHub token is needed for public repositories.** If your test library is in a private repo, also add:

```bash
GITHUB_TOKEN=ghp_your_pat_here
```

## Stopping Services

```bash
./scripts/start.sh --stop
```

## Troubleshooting

### Port Conflicts

If ports 5173 or 3000 are in use, the start script will automatically find the next available port. Check the script output for the actual ports used.

### Clerk Authentication Errors

- Ensure both `frontend/.env` and `backend/.env` have the correct keys
- The publishable key should start with `pk_test_` (development) or `pk_live_` (production)
- The secret key should start with `sk_test_` or `sk_live_`

### Dependency Auto-Install Issues

- **`sudo` password prompt**: The script uses `sudo` for system-level installs (apt, dnf, pacman). Ensure your user has sudo privileges.
- **nvm users**: If Node.js was installed via nvm, the script detects and sources `~/.nvm/nvm.sh` automatically. If it still isn't found, ensure nvm is installed correctly and restart your terminal.
- **Go PATH after install**: Go is installed to `/usr/local/go`. The script adds it to PATH for the current session, but to persist it, add to your shell profile:
  ```bash
  export PATH=/usr/local/go/bin:$PATH
  ```
- **macOS without Homebrew**: Install [Homebrew](https://brew.sh) first — the script requires it on macOS.
- **Unsupported distro**: Install Node.js 22+, npm, Git, and Go 1.24+ manually, then re-run the script.

### TypeScript Build Errors

Verify the project compiles cleanly:

```bash
cd frontend && npm run build
cd ../backend && npm run build
```

## Next Steps

- **[Quick Start — Docker](./quick-start-docker)** — Deploy with Docker Compose
- **[Features Overview](./features)** — Explore all platform capabilities
- **[Development Setup](../developer-guide/development-setup)** — Full contributor guide
