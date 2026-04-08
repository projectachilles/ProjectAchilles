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
./scripts/setup.sh          # Interactive configuration
docker compose up -d        # Start services
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| `backend` | 3000 (internal) | Express API server with SQLite |
| `frontend` | 8080 | nginx serving React SPA + API proxy |
| `elasticsearch` | 9200 | ES 8.17 single-node (optional profile) |
| `es-seed` | — | Seeds 1,000 synthetic results (optional) |

## Configuration

### Environment Files

Create `backend/.env`:

```bash
CLERK_PUBLISHABLE_KEY=pk_test_your_key
CLERK_SECRET_KEY=sk_test_your_key
CORS_ORIGIN=http://localhost:8080
NODE_ENV=production
ENCRYPTION_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
CLI_AUTH_SECRET=$(openssl rand -hex 32)

# Agent server URL — only needed if agents connect from outside your network
# AGENT_SERVER_URL=https://your-backend.ngrok-free.app
```

:::tip Generate All Secrets
Use the helper script to generate all secrets at once:
```bash
./scripts/generate-secrets.sh --env-file backend/.env
```
:::

Create `frontend/.env`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
```

### With Elasticsearch

```bash
docker compose --profile elasticsearch up -d
```

This starts Elasticsearch 8.17 in single-node mode (security disabled) and seeds synthetic test results for the Analytics dashboard.

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
└── go-cache/           # Go build cache
```

## Windows Docker Installation

Windows requires WSL2 and Docker Desktop. Key considerations:

:::warning Line Endings
Git must use Unix line endings for shell scripts:

```powershell
git config --global core.autocrlf input
```

If already cloned with Windows line endings, delete and re-clone.
:::

### PowerShell Bootstrap

```powershell
.\scripts\Install-ProjectAchilles.ps1
```

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

## Troubleshooting

### Port 8080 Conflict

Change the frontend port in `docker-compose.yml`:

```yaml
frontend:
  ports:
    - "9090:80"
```

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
