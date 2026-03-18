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
- A [Clerk](https://clerk.com) account with API keys (see [Local Dev Quick Start](./quick-start-local#2-configure-clerk-authentication))

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

The setup wizard will interactively configure your Clerk keys and other settings.

**Or configure manually** by creating `backend/.env`:

```bash
cat > backend/.env << 'EOF'
CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CLERK_SECRET_KEY=sk_test_your_key_here
CORS_ORIGIN=http://localhost:8080
NODE_ENV=production
EOF

cat > frontend/.env << 'EOF'
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
EOF
```

### 3. Start Services

```bash
# Backend + Frontend only
docker compose up -d

# Or include local Elasticsearch with synthetic data
docker compose --profile elasticsearch up -d
```

### 4. Access the Dashboard

Open **http://localhost:8080** (frontend) in your browser.

:::info Port Mapping
In Docker Compose mode, the frontend runs on port **8080** (via nginx), not 5173. The backend runs on port **3000** internally but is proxied through nginx.
:::

## Windows

### Prerequisites

1. **Windows 10/11** with virtualization enabled (BIOS/UEFI)
2. **WSL2** installed and configured
3. **Docker Desktop** for Windows
4. **Git for Windows** with Unix line endings

:::warning Line Endings
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
.\scripts\Install-ProjectAchilles.ps1
```

The PowerShell script will:
- Check prerequisites (Docker Desktop, WSL2, Git)
- Fix line endings if needed
- Configure `backend/.env` interactively
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
| `frontend` | 8080 | nginx serving the React SPA + API proxy |
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

### Port 8080 Already In Use

Edit `docker-compose.yml` and change the frontend port mapping:

```yaml
frontend:
  ports:
    - "9090:80"  # Change 8080 to 9090
```

### Elasticsearch Fails to Start

ES requires `vm.max_map_count >= 262144`. On Linux:

```bash
sudo sysctl -w vm.max_map_count=262144
```

On Windows (WSL2):

```powershell
wsl -d docker-desktop sh -c "sysctl -w vm.max_map_count=262144"
```

### Clerk Authentication Loop

Ensure `CORS_ORIGIN` in `backend/.env` matches the actual URL you're accessing (e.g., `http://localhost:8080`).

## Next Steps

- **[Deployment Overview](../deployment/overview)** — Compare all 5 deployment targets
- **[Production Checklist](../deployment/production-checklist)** — Harden your deployment
- **[Features Overview](./features)** — Explore all platform capabilities
