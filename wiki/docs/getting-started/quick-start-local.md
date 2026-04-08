---
sidebar_position: 4
title: Quick Start — Local Dev
description: Get ProjectAchilles running locally or on a remote server in under 5 minutes with a single command.
---

# Quick Start — Local Development

Get ProjectAchilles running on your machine or a remote server with a single command. The startup script handles everything: installs system dependencies, walks you through authentication setup, and starts the platform. Add `--tunnel` to expose it via HTTPS for remote access and agent enrollment.

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

## Remote Access

If you're running ProjectAchilles on a remote server (cloud VM, VPS, headless machine), you have two options to access the dashboard and enable agent communication.

### Option A — SSH Tunnel (quickest, personal use)

Forward the ports to your local machine. No extra tools or accounts needed:

```bash
# From your local machine (not the server)
ssh -L 5173:localhost:5173 -L 3000:localhost:3000 user@your-server
```

Then open **http://localhost:5173** in your local browser. Clerk auth works because it sees `localhost`.

:::note
SSH tunnels are great for verifying the app works, but agents on other machines can't reach the backend through your SSH tunnel. Use Cloudflare Tunnels (Option B) for agent enrollment.
:::

### Option B — Cloudflare Tunnels (full setup with agents, ~5 minutes)

Exposes both frontend and backend via free HTTPS tunnel URLs. Agents can enroll from any network. No account or credit card required.

```bash
./scripts/start.sh -k --daemon --tunnel
```

The script will:
1. Install `cloudflared` if not present (single binary, ~30 MB)
2. Start two HTTPS tunnels (frontend + backend)
3. Register the tunnel URL with Clerk's allowed origins automatically
4. Set `AGENT_SERVER_URL` so enrollment one-liners use the tunnel address

```
Starting Cloudflare tunnels...
  Waiting for tunnel URLs...
  ✓ Dashboard:  https://random-words.trycloudflare.com
  ✓ Agent API:  https://other-words.trycloudflare.com

Registering tunnel with Clerk allowed_origins...
  ✓ Clerk allowed_origins updated

╔══════════════════════════════════════════════════════╗
║   Dashboard:   https://random-words.trycloudflare.com ║
║   Agent API:   https://other-words.trycloudflare.com  ║
║                                                       ║
║   Agent enrollment URL (use this in agent config):    ║
║     https://other-words.trycloudflare.com             ║
╚══════════════════════════════════════════════════════╝
```

Open the Dashboard URL in your browser to access the platform. Use the Agent API URL when enrolling agents — the one-liner install commands on the Agents page will use it automatically.

:::warning Ephemeral URLs
Cloudflare quick tunnel URLs change every time the server restarts. For persistent URLs, use a [named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (free, requires a Cloudflare account) or deploy with [Docker](./quick-start-docker) behind a reverse proxy.
:::

:::tip ngrok users
If you prefer ngrok, set your custom domains in `backend/.env` and the script will auto-detect it:
```bash
NGROK_FRONTEND_DOMAIN=your-app.ngrok.app
NGROK_BACKEND_DOMAIN=your-api.ngrok.app
```
Or force the provider: `TUNNEL_PROVIDER=ngrok ./scripts/start.sh -k --daemon --tunnel`
:::

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

The Test Browser displays security tests from a Git-synced repository. To populate it, add the repo URL to `backend/.env`:

```bash
# In backend/.env
TESTS_REPO_URL=https://github.com/your-org/your-test-library.git
```

The backend will clone and sync the test library on startup. **No GitHub token is needed for public repositories.** For private repos, also add:

```bash
GITHUB_TOKEN=ghp_your_pat_here
```

:::note Coming Soon
The default test library ([f0_library](https://github.com/ubercylon8/f0_library)) will be configured automatically once its repository access restrictions are resolved. Until then, the Test Browser will show "No tests in library" — the rest of the platform (Analytics, Agent management) works independently.
:::

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
