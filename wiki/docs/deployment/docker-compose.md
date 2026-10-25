---
sidebar_position: 3
title: Docker Compose
description: Deploy ProjectAchilles with Docker Compose for local development or self-hosted production use.
---

# Docker Compose Deployment

Docker Compose is the recommended deployment method for local development, testing, and self-hosted production. It provides the full feature set including Go cross-compilation and code signing.

## Quick Start

```bash
git clone https://github.com/projectachilles/ProjectAchilles.git
cd ProjectAchilles
./scripts/setup.sh          # Interactive configuration (backend/.env + Clerk key in the root .env)
# Check the root .env (see "Root .env" below), then:
docker compose up -d        # Start services
```

:::warning[Set up roles in Clerk]
Every user without a role is read-only. In the Clerk Dashboard, add the
`metadata` claim to the session token, then give your own account
`{"role": "admin"}` in its public metadata and sign in again:
[session token claim](./prerequisites#session-token-claim) and
[first admin](./prerequisites#first-admin). Invite everyone else from
**Settings → Users**.
:::

## Services

| Service | Port | Description |
|---------|------|-------------|
| `backend` | 3000 (internal) | Express API server with SQLite |
| `frontend` | 80 | nginx serving React SPA + API proxy |
| `elasticsearch` | 9200 | ES 8.17 single-node (optional profile) |
| `es-seed` | — | Seeds 1,000 synthetic results (optional) |

## Configuration

### Environment Files

Create `backend/.env`:

```bash
CLERK_PUBLISHABLE_KEY=pk_test_your_key
CLERK_SECRET_KEY=sk_test_your_key
NODE_ENV=production
ENCRYPTION_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
CLI_AUTH_SECRET=$(openssl rand -hex 32)

# Agent server URL — only needed if agents connect from outside your network
# AGENT_SERVER_URL=https://your-backend.ngrok-free.app
```

:::tip[Generate All Secrets]
Use the helper script to generate all secrets at once:
```bash
./scripts/generate-secrets.sh --env-file backend/.env
```
:::

### Root `.env`

Docker Compose fills in the variables it passes to the containers from a `.env` file in the **project root** (next to `docker-compose.yml`). The setup wizards (`setup.sh`, `Install-ProjectAchilles.ps1`) write `CLERK_PUBLISHABLE_KEY` to it for you. If you configured manually, create it with at least:

```bash
CLERK_PUBLISHABLE_KEY=pk_test_your_key
CORS_ORIGIN=http://localhost
```

- **`CLERK_PUBLISHABLE_KEY`**: the frontend container reads it when it starts and writes it to `/env-config.js`. Without it, the UI loads a black page and the browser console shows `@clerk/clerk-react: Missing publishableKey`.
- **`CORS_ORIGIN`**: the exact URL you open in the browser, including the port if it isn't 80. `docker-compose.yml` sets it on the backend container, so it overrides any `CORS_ORIGIN` in `backend/.env`.

See `.env.example` in the project root for the other optional overrides.

:::warning[`frontend/.env` is not used by Docker]
`frontend/.env` is only for the local Vite dev server. `frontend/.dockerignore` keeps it out of the image, and the Clerk key isn't baked in at build time, so rebuilding won't pick it up. After changing the root `.env`, recreate the containers. No rebuild is needed:

```bash
docker compose up -d --force-recreate frontend backend
curl -s http://localhost/env-config.js   # should show VITE_CLERK_PUBLISHABLE_KEY: "pk_..."
```
:::

### With Elasticsearch

```bash
docker compose --profile elasticsearch up -d
```

This starts Elasticsearch 8.17 in single-node mode (security disabled) and seeds synthetic test results for the Analytics dashboard, into the `achilles-results-synthetic` index. The seed runs once: a later `docker compose up` skips it while that index holds documents.

Configure the Analytics module at `/analytics/setup` with:
- **Node URL:** `http://elasticsearch:9200`
- **No credentials** needed for the local instance

### With ngrok (Remote Agents)

To allow agents outside your local network to communicate with the backend:

```bash
# In backend/.env
NGROK_BACKEND_DOMAIN=your-backend.ngrok-free.app
AGENT_SERVER_URL=https://your-backend.ngrok-free.app
```

## Volume Storage

Docker Compose uses a named volume for persistent data:

```
~/.projectachilles/
├── agents.db           # SQLite database (agents, tasks, schedules)
├── analytics.json      # Encrypted Elasticsearch credentials
├── integrations.json   # Encrypted integration credentials
├── certs/              # Code signing certificates
│   ├── cert-1709000000/
│   └── active-cert.txt
├── binaries/           # Built test binaries (cache)
└── go-cache/           # Go module cache for agent builds
```

Go's compiler cache lives in the separate `go-cache` volume (`/root/go`, via `GOCACHE=/root/go/build-cache`), so test and agent builds stay fast after a container is recreated.

## Windows Docker Installation

Windows requires WSL2 and Docker Desktop. Key considerations:

:::warning[Line Endings]
Git must use Unix line endings for shell scripts:

```powershell
git config --global core.autocrlf input
```

If already cloned with Windows line endings, delete and re-clone.
:::

### PowerShell Bootstrap

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-ProjectAchilles.ps1
```

`-ExecutionPolicy Bypass` applies only to that one PowerShell process. Windows blocks unsigned scripts by default ("running scripts is disabled on this system"), and this leaves your system policy unchanged. Windows PowerShell 5.1, built into Windows 10 and 11, is enough.

The script checks prerequisites (Docker Desktop, WSL2, Git), fixes line endings, configures `.env` interactively, builds images, and starts services.

### WSL2 Requirements

- Windows 10 version 2004+ or Windows 11
- Virtualization enabled in BIOS/UEFI
- At least 8 GB RAM (Docker Desktop + ES)

```powershell
# Install WSL2 if not present
wsl --install

# Verify
wsl --version
```

### Elasticsearch on Windows

ES requires increased virtual memory:

```powershell
wsl -d docker-desktop sh -c "sysctl -w vm.max_map_count=262144"
```

## Updating

```bash
git pull
docker compose build
docker compose up -d
```

## Helper Scripts

```bash
# Generate all secrets at once and append to backend/.env
./scripts/generate-secrets.sh --target docker --env-file backend/.env

# Interactive setup wizard — configures Clerk, ES, test repo, secrets
./scripts/setup.sh    # Select: Docker

# Initialize Elasticsearch indices (for external ES — local Docker ES is auto-seeded)
./scripts/init-elasticsearch.sh --cloud-id "deploy:..." --api-key "..."

# Initialize local ES indices with synthetic demo data
./scripts/init-elasticsearch.sh --host http://localhost:9200 --seed
```

## Troubleshooting

### Port 80 Conflict

Change the frontend port in `docker-compose.yml`:

```yaml
frontend:
  ports:
    - "127.0.0.1:9090:80"
```

Then set `CORS_ORIGIN=http://localhost:9090` in the root `.env` and recreate the containers.

### Backend Logs

```bash
docker compose logs -f backend
```

### Rebuild From Scratch

```bash
docker compose down -v    # Remove volumes (destroys data!)
docker compose build --no-cache
docker compose up -d
```

### Elasticsearch Won't Start (Linux)

```bash
sudo sysctl -w vm.max_map_count=262144
# Make persistent:
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
```
