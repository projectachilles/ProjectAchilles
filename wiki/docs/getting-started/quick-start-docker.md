---
sidebar_position: 5
title: Quick Start — Docker
description: Deploy ProjectAchilles with Docker Compose in one command, with optional local Elasticsearch.
---

# Quick Start — Docker Compose

Deploy ProjectAchilles using Docker Compose for a production-like environment. This guide covers Linux, macOS, and Windows.

## Prerequisites

- **Docker** 20.10+ and **Docker Compose** v2+
- **Git**
- A [Clerk](https://clerk.com) account with API keys (see [Local Dev Quick Start](./quick-start-local#2-start-the-development-stack))

## Linux / macOS

### 1. Clone and Configure

```bash
git clone https://github.com/projectachilles/ProjectAchilles.git
cd ProjectAchilles
```

### 2. Run the Setup Wizard

```bash
./scripts/setup.sh
```

The setup wizard will interactively configure your Clerk keys and other settings in `backend/.env`, and copy the Clerk publishable key into the root `.env` described in the next step.

**Or configure manually** by creating `backend/.env`:

```bash
cat > backend/.env << 'EOF'
CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CLERK_SECRET_KEY=sk_test_your_key_here
NODE_ENV=production
EOF
```

### 3. Create the Root `.env` for Docker Compose

**If you used the wizard**, it has already written `CLERK_PUBLISHABLE_KEY` to this file. Check that it's there (`cat .env`), and only add `CORS_ORIGIN` if you'll open the UI on a URL other than `http://localhost`. Don't recreate the file with the command below: that would replace your key with the placeholder.

**If you configured manually**, create a `.env` file in the **project root** (next to `docker-compose.yml`):

```bash
cat > .env << 'EOF'
CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CORS_ORIGIN=http://localhost
EOF
```

Docker Compose reads this file to fill in the variables it passes to the containers:

- **`CLERK_PUBLISHABLE_KEY`**: the frontend container reads it when it starts and writes it to `/env-config.js`. Without it, the UI loads a black page and the browser console shows `@clerk/clerk-react: Missing publishableKey`.
- **`CORS_ORIGIN`**: must be the exact URL you open in the browser, including the port if it isn't 80 (for example `http://localhost:9090` or `http://<server-ip>`). `docker-compose.yml` sets this value on the backend container, so it overrides any `CORS_ORIGIN` in `backend/.env`.

:::warning[`frontend/.env` is not used by Docker]
`frontend/.env` is only for the local Vite dev server (`npm run dev`). `frontend/.dockerignore` keeps it out of the image, and the Clerk key isn't baked in at build time. Rebuilding the image won't pick it up; set the key in the root `.env` instead.
:::

### 4. Start Services

```bash
# Backend + Frontend only
docker compose up -d

# Or include local Elasticsearch with synthetic data
docker compose --profile elasticsearch up -d
```

### 5. Access the Dashboard

Open **http://localhost** (frontend) in your browser.

To confirm the Clerk key reached the frontend:

```bash
curl -s http://localhost/env-config.js
```

The output should contain `VITE_CLERK_PUBLISHABLE_KEY: "pk_test_..."`. If the value is `""`, see [Missing publishableKey](#missing-publishablekey-black-page).

:::info[Port Mapping]
In Docker Compose mode, the frontend is served by nginx on port **80** (bound to `127.0.0.1`), not 5173. The backend runs on port **3000** internally but is proxied through nginx.
:::

### 6. Make Yourself Admin

A new account has no role, so it's read-only. In the Clerk Dashboard, add the
`metadata` claim to the session token, then set `{"role": "admin"}` in your
user's public metadata and sign in again. See
[session token claim](../deployment/clerk-setup#session-token-claim) and
[first admin](../deployment/clerk-setup#first-admin).

## Windows

### Prerequisites

1. **Windows 10/11** with virtualization enabled (BIOS/UEFI)
2. **WSL2** installed and configured
3. **Docker Desktop** for Windows
4. **Git for Windows** with Unix line endings

:::warning[Line Endings]
Git must be configured to preserve Unix line endings for shell scripts inside Docker containers:

```powershell
git config --global core.autocrlf input
```

If you've already cloned with Windows line endings, re-clone after changing this setting.
:::

### Quick Path — PowerShell Bootstrap

```powershell
git clone https://github.com/projectachilles/ProjectAchilles.git
cd ProjectAchilles
powershell -ExecutionPolicy Bypass -File .\scripts\Install-ProjectAchilles.ps1
```

`-ExecutionPolicy Bypass` applies only to that one PowerShell process. Windows blocks unsigned scripts by default ("running scripts is disabled on this system"), and this leaves your system policy unchanged. Windows PowerShell 5.1, built into Windows 10 and 11, is enough.

The PowerShell script will:
- Check prerequisites (Docker Desktop, WSL2, Git)
- Fix line endings if needed
- Configure `backend/.env` interactively, and copy the Clerk publishable key into the root `.env`
- Build Docker images
- Start services
- Open the dashboard in your browser

### Manual Path

If you prefer to configure manually, follow the Linux/macOS steps above using a WSL2 terminal or Git Bash.

## With Elasticsearch

The `elasticsearch` profile starts a local Elasticsearch 8.17 instance and seeds it with 1,000 synthetic test results:

```bash
docker compose --profile elasticsearch up -d
```

After startup, configure the Analytics module:

1. Navigate to **Analytics** in the sidebar
2. Click **Setup** (or go to `/analytics/setup`)
3. Enter `http://elasticsearch:9200` as the node URL (Docker internal DNS)
4. No credentials needed for the local instance

## Docker Compose Services

| Service | Port | Description |
|---------|------|-------------|
| `backend` | 3000 (internal) | Express API server |
| `frontend` | 80 | nginx serving the React SPA + API proxy |
| `elasticsearch` | 9200 | Elasticsearch 8.17 (optional profile) |
| `es-seed` | — | One-shot container that seeds synthetic data |

## Stopping Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (destroys data)
docker compose down -v
```

## Updating

```bash
git pull
docker compose build
docker compose up -d
```

## Troubleshooting

### Docker Daemon Not Running

Ensure Docker Desktop is running (Windows/macOS) or the Docker service is active:

```bash
sudo systemctl start docker   # Linux
```

### Port 80 Already In Use

Edit `docker-compose.yml` and change the frontend port mapping:

```yaml
frontend:
  ports:
    - "127.0.0.1:9090:80"  # Change 80 to 9090
```

Then set `CORS_ORIGIN=http://localhost:9090` in the root `.env` and recreate the containers (`docker compose up -d --force-recreate frontend backend`).

### Elasticsearch Fails to Start

ES requires `vm.max_map_count >= 262144`. On Linux:

```bash
sudo sysctl -w vm.max_map_count=262144
```

On Windows (WSL2):

```powershell
wsl -d docker-desktop sh -c "sysctl -w vm.max_map_count=262144"
```

### Missing publishableKey (Black Page)

The UI loads a black page and the browser console shows `@clerk/clerk-react: Missing publishableKey`. The frontend container started without `CLERK_PUBLISHABLE_KEY`.

1. Check that `.env` exists in the project root (next to `docker-compose.yml`) and contains `CLERK_PUBLISHABLE_KEY=pk_...`. Setting it in `frontend/.env` has no effect in Docker.
2. Recreate the containers. No rebuild is needed, because the key is read when the container starts:
   ```bash
   docker compose up -d --force-recreate frontend backend
   ```
3. Verify with `curl -s http://localhost/env-config.js`, then hard-refresh the browser (Ctrl+Shift+R).

### Clerk Authentication Loop or CORS Errors

Ensure `CORS_ORIGIN` in the **root** `.env` matches the exact URL you're accessing, including the port (e.g., `http://localhost` or `http://localhost:9090`). The value in `backend/.env` is overridden by `docker-compose.yml`. Also check that this URL is allowed in your Clerk application settings.

## Next Steps

- **[Deployment Overview](../deployment/overview)** — Compare all 5 deployment targets
- **[Production Checklist](../deployment/production-checklist)** — Harden your deployment
- **[Features Overview](./features)** — Explore all platform capabilities
