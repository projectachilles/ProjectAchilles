# ProjectAchilles — Windows Installation Guide (Docker)

Complete guide for installing and running ProjectAchilles on Windows using Docker Desktop.

**Estimated time:** 20–30 minutes (plus Docker image build)

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install Docker Desktop](#2-install-docker-desktop)
3. [Install Git for Windows](#3-install-git-for-windows)
4. [Clone the Repository](#4-clone-the-repository)
5. [Create a Clerk Account](#5-create-a-clerk-account)
6. [Configure Environment](#6-configure-environment)
7. [Build and Start Services](#7-build-and-start-services)
8. [Verify Installation](#8-verify-installation)
9. [Optional: Local Elasticsearch](#9-optional-local-elasticsearch)
10. [Stopping and Restarting](#10-stopping-and-restarting)
11. [Updating](#11-updating)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Windows | 10 (21H2+) or 11 | Windows 11 |
| PowerShell | 7.0+ | Latest version |
| RAM | 8 GB | 16 GB (32 GB if using Elasticsearch) |
| Disk | 10 GB free | 20 GB free |
| CPU | 64-bit with virtualization | 4+ cores |

**Verify virtualization is enabled:**
1. Open Task Manager (`Ctrl+Shift+Esc`)
2. Go to **Performance** → **CPU**
3. Check that **Virtualization** shows **Enabled**

If disabled, enable it in your BIOS/UEFI settings (usually called "Intel VT-x" or "AMD-V").

---

## 2. Install Docker Desktop

### 2.1 Install WSL2 (Required)

Docker Desktop on Windows requires WSL2 (Windows Subsystem for Linux 2).

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

Restart your computer when prompted. After restart, WSL will finish setting up — you may be asked to create a Linux username and password (this is for WSL only, not ProjectAchilles).

Verify WSL2 is active:

```powershell
wsl --version
```

### 2.2 Install Docker Desktop

1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/
2. Run the installer — keep all default options
3. When prompted, ensure **"Use WSL 2 instead of Hyper-V"** is checked
4. Restart your computer if prompted
5. Launch Docker Desktop from the Start menu
6. Wait for the Docker engine to start (the whale icon in the system tray will stop animating)

Verify Docker is working — open PowerShell or Command Prompt:

```powershell
docker --version
docker compose version
```

Both commands should return version information without errors.

### 2.3 Docker Desktop Settings (Recommended)

Open Docker Desktop → **Settings** (gear icon):

- **General** → Ensure "Use the WSL 2 based engine" is checked
- **Resources** → **WSL Integration** → Enable integration with your default WSL distro
- **Resources** → **Advanced** → Allocate at least:
  - **CPUs:** 2 (4 recommended)
  - **Memory:** 4 GB (8 GB if using Elasticsearch)

Click **Apply & restart**.

---

## 3. Install Git for Windows

1. Download Git for Windows from: https://git-scm.com/download/win
2. Run the installer with these important settings:
   - **Line ending conversions:** Select **"Checkout as-is, commit as-is"** or **"Checkout as-is, commit Unix-style line endings"**
     > This prevents CRLF line ending issues that break shell scripts inside Docker containers.
   - All other options can stay at defaults
3. Verify installation:

```powershell
git --version
```

> **Already have Git installed?** Configure line endings for this project:
> ```powershell
> git config --global core.autocrlf input
> ```

---

## 4. Clone the Repository

Open PowerShell or Git Bash and run:

```powershell
cd $HOME
git clone https://github.com/your-org/ProjectAchilles.git
cd ProjectAchilles
```

> **Important:** Clone to a path **without spaces** (e.g., `C:\Users\YourName\ProjectAchilles`). Paths with spaces can cause issues with Docker volume mounts.

### Verify Line Endings

The `docker-entrypoint.sh` file **must** have Unix (LF) line endings, not Windows (CRLF). Verify and fix if needed:

```powershell
# In Git Bash:
file frontend/docker-entrypoint.sh
# Should say: "POSIX shell script, ASCII text executable"
# If it says "CRLF" anywhere, fix with:
sed -i 's/\r$//' frontend/docker-entrypoint.sh
```

Or in PowerShell:

```powershell
# Check for CRLF
(Get-Content frontend/docker-entrypoint.sh -Raw) -match "`r`n"
# If True, fix with:
(Get-Content frontend/docker-entrypoint.sh -Raw) -replace "`r`n", "`n" | Set-Content -NoNewline frontend/docker-entrypoint.sh
```

---

## 5. Create a Clerk Account

ProjectAchilles uses [Clerk](https://clerk.com) for authentication. You need a free Clerk account.

1. Go to https://clerk.com and sign up
2. Create a new application:
   - **Name:** `ProjectAchilles` (or any name you prefer)
   - **Sign-in options:** Enable at least **Email** (optionally add Google, Microsoft, GitHub)
3. After creation, go to **API Keys** in the Clerk dashboard
4. Copy these two values — you will need them in the next step:

   | Key | Looks like | Description |
   |-----|-----------|-------------|
   | **Publishable key** | `pk_test_abc123...` | Public key (safe to expose in frontend) |
   | **Secret key** | `sk_test_xyz789...` | Private key (backend only, keep secret) |

---

## 6. Configure Environment

### Option A: PowerShell Bootstrap Script (Recommended)

The all-in-one PowerShell script handles configuration **and** building/launching in a single step:

```powershell
.\scripts\Install-ProjectAchilles.ps1
```

The script will:
- Check that Git, Docker, and Docker Compose are installed and running
- Fix CRLF line endings in shell scripts (prevents Docker build failures)
- Ask for your Clerk keys (with input masking for the secret key)
- Ask about Elasticsearch and test repository configuration
- Generate secure secrets (SESSION_SECRET, ENCRYPTION_SECRET)
- Write everything to `backend/.env`
- Build and start Docker containers
- Wait for services to become healthy
- Open `http://localhost` in your browser

**Quick mode** (minimal prompts — just provide Clerk keys):

```powershell
.\scripts\Install-ProjectAchilles.ps1 -Quick -ClerkPublishableKey pk_test_YOUR_KEY -ClerkSecretKey sk_test_YOUR_KEY
```

**With local Elasticsearch** (skips the ES prompt):

```powershell
.\scripts\Install-ProjectAchilles.ps1 -WithElasticsearch
```

> If you use the bootstrap script, skip to [Section 8: Verify Installation](#8-verify-installation) — the script handles Sections 6 and 7 automatically.

### Option B: Setup Wizard (Git Bash)

The interactive setup wizard configures `backend/.env` (but does not build or launch containers).

**Using Git Bash** (installed with Git for Windows):

```bash
cd ~/ProjectAchilles
bash scripts/setup.sh
```

The wizard will:
- Detect Docker and choose Docker mode automatically
- Ask for your Clerk keys
- Ask about Elasticsearch (choose "Skip" for now — you can configure later)
- Ask about the test repository and GitHub token
- Generate secure secrets (SESSION_SECRET, ENCRYPTION_SECRET)
- Write everything to `backend/.env`

After the wizard completes, continue to [Section 7](#7-build-and-start-services) to build and start services.

### Option C: Manual Configuration

If you prefer manual setup or the wizard doesn't work:

1. Copy the example environment file:

```powershell
copy backend\.env.example backend\.env
```

2. Open `backend\.env` in a text editor (Notepad, VS Code, etc.) and set these values:

```env
# === Required: Clerk Authentication ===
CLERK_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
CLERK_SECRET_KEY=sk_test_YOUR_KEY_HERE

# === Server ===
PORT=3000
NODE_ENV=production

# === CORS (for Docker deployment) ===
CORS_ORIGIN=http://localhost

# === Secrets (generate unique values — see below) ===
SESSION_SECRET=REPLACE_ME
ENCRYPTION_SECRET=REPLACE_ME
```

3. Generate secure secrets — run in PowerShell:

```powershell
# Generate SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Generate ENCRYPTION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Or if you don't have Node.js installed locally, use Python:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Or use this online generator: https://generate-secret.vercel.app/32

Replace both `REPLACE_ME` values with the generated strings.

### Optional: Test Repository

If you have access to a private test library repository, also set:

```env
TESTS_REPO_URL=https://github.com/your-org/f0_library.git
GITHUB_TOKEN=ghp_YOUR_PERSONAL_ACCESS_TOKEN
```

Generate a GitHub PAT at: https://github.com/settings/tokens (scopes: `repo`)

---

## 7. Build and Start Services

### 7.1 Build and Launch

Open PowerShell in the project directory and run:

```powershell
docker compose up -d --build
```

This will:
1. **Build the backend image** — installs Node.js 22, Go 1.24, compiles TypeScript (~3–5 minutes first time)
2. **Build the frontend image** — compiles React app, creates nginx image (~2–3 minutes first time)
3. **Start both services** — backend on port 3000, frontend on port 80

> **First build takes 5–10 minutes** depending on your internet speed and CPU. Subsequent starts are much faster since Docker caches the build layers.

### 7.2 Monitor Build Progress

Watch the build and startup logs:

```powershell
docker compose logs -f
```

Press `Ctrl+C` to stop following logs (services continue running).

### 7.3 Check Service Status

```powershell
docker compose ps
```

You should see both services running:

```
NAME                    STATUS                   PORTS
projectachilles-backend-1   Up (healthy)         0.0.0.0:3000->3000/tcp
projectachilles-frontend-1  Up                   0.0.0.0:80->80/tcp
```

> The backend has a health check — it may show `(health: starting)` for up to 90 seconds before becoming `(healthy)`.

---

## 8. Verify Installation

### 8.1 Open the Dashboard

Open your browser and navigate to:

**http://localhost**

You should see the Clerk sign-in page. Sign in with the method you configured (email, Google, etc.).

### 8.2 Test the API

Open PowerShell and run:

```powershell
# Health check (should return JSON with status: "ok")
curl http://localhost:3000/api/health

# Or via the frontend proxy
curl http://localhost/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "ProjectAchilles",
  "version": "1.0.0",
  "timestamp": "2026-02-08T..."
}
```

### 8.3 Verify Modules

After signing in, check each module:

| Module | What to verify |
|--------|----------------|
| **Browser** | Test library loads (if test repo configured) |
| **Analytics** | Shows setup/configuration page (configure Elasticsearch later) |
| **Agents** | Agent management page loads |
| **Settings** | Certificate management and build settings accessible |

---

## 9. Optional: Local Elasticsearch

To enable the Analytics dashboard with sample data, start the Elasticsearch profile:

```powershell
docker compose --profile elasticsearch up -d
```

This adds:
- **Elasticsearch 8.17** on `localhost:9200` (~2 GB RAM)
- **Seed container** that loads ~1,000 sample test results then exits

Wait about 60 seconds for Elasticsearch to start and the seed data to load, then verify:

```powershell
curl http://localhost:9200/_cluster/health
```

The analytics module will auto-detect the local Elasticsearch instance. If not, configure it via **Settings** → **Analytics** in the UI, or set these in `backend/.env` and restart:

```env
ELASTICSEARCH_NODE=http://elasticsearch:9200
ELASTICSEARCH_INDEX_PATTERN=achilles-results-*
```

Then restart the backend:

```powershell
docker compose restart backend
```

---

## 10. Stopping and Restarting

### Stop all services (preserves data)

```powershell
docker compose down
```

### Stop including Elasticsearch

```powershell
docker compose --profile elasticsearch down
```

### Restart services

```powershell
docker compose up -d
```

### Full reset (removes volumes and all data)

```powershell
docker compose --profile elasticsearch down -v
```

> **Warning:** The `-v` flag deletes all persistent data (agent database, certificates, Elasticsearch data, build caches). Only use this for a clean reinstall.

### View logs

```powershell
# All services
docker compose logs -f

# Backend only
docker compose logs -f backend

# Frontend only
docker compose logs -f frontend
```

---

## 11. Updating

To update to the latest version:

```powershell
# Pull latest code
git pull origin main

# Rebuild and restart
docker compose up -d --build
```

If there are database schema changes, the backend handles migrations automatically on startup.

---

## 12. Troubleshooting

### Port 80 already in use

**Symptom:** `Bind for 0.0.0.0:80 failed: port is already allocated`

Windows services that commonly use port 80: IIS, Apache, Skype, World Wide Web Publishing Service.

**Fix — find and stop the conflicting service:**

```powershell
netstat -ano | findstr :80
# Note the PID, then:
tasklist /FI "PID eq <PID>"
```

**Fix — or change the port:** Edit `docker-compose.yml` and change the frontend port mapping:

```yaml
frontend:
  ports:
    - "8080:80"   # Changed from "80:80"
```

Then access the dashboard at `http://localhost:8080` instead.

### Port 3000 already in use

Same approach as above. Common culprits: Node.js dev servers, React dev servers.

```powershell
netstat -ano | findstr :3000
```

### Backend shows "unhealthy"

```powershell
# Check backend logs for errors
docker compose logs backend

# Common causes:
# 1. Missing or invalid Clerk keys in backend/.env
# 2. Syntax error in .env file
# 3. Port conflict
```

### CRLF / Line Ending Errors

**Symptom:** Frontend container fails to start with errors like:
```
/docker-entrypoint.sh: line 2: $'\r': command not found
```

**Fix:**

```powershell
# In Git Bash:
sed -i 's/\r$//' frontend/docker-entrypoint.sh

# Then rebuild:
docker compose up -d --build frontend
```

**Prevent future issues:**

```powershell
# Set Git to not convert line endings
git config --global core.autocrlf input

# Or add a .gitattributes rule (already included in the repo):
# *.sh text eol=lf
```

### Docker build fails with "no space left on device"

```powershell
# Clean unused Docker resources
docker system prune -a

# Check Docker disk usage
docker system df
```

### "Cannot connect to the Docker daemon"

1. Ensure Docker Desktop is running (check system tray for the whale icon)
2. If Docker Desktop won't start, restart your computer
3. Verify WSL2 is working: `wsl --status`

### Slow performance / High CPU

Docker on Windows can be resource-intensive. Recommendations:

1. In Docker Desktop → Settings → Resources → Advanced:
   - Reduce memory if you're not using Elasticsearch
   - Set CPU limit to half your cores
2. Store the project in the Windows filesystem (`C:\Users\...`), not inside WSL (`\\wsl$\...`)
3. Close other heavy applications during Docker builds

### Elasticsearch won't start

**Symptom:** `achilles-es` container keeps restarting.

```powershell
docker compose --profile elasticsearch logs elasticsearch
```

Common fixes:

1. **Insufficient memory** — Elasticsearch needs at least 2 GB. Increase Docker memory in Settings.
2. **vm.max_map_count too low** — Open WSL terminal and run:

```bash
wsl -d docker-desktop
sysctl -w vm.max_map_count=262144
```

To make it permanent, add to `/etc/sysctl.conf` inside WSL.

### Cannot access http://localhost

1. Check services are running: `docker compose ps`
2. Check Windows Firewall isn't blocking Docker
3. Try `http://127.0.0.1` instead of `http://localhost`
4. Disable any VPN software temporarily

### Clerk authentication not working

1. Verify `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `backend/.env` are correct
2. In the Clerk dashboard, ensure your application's authorized origins include `http://localhost`
3. Check backend logs: `docker compose logs backend | findstr -i clerk`

---

## Architecture Overview

When running with Docker Compose, the services are networked as follows:

```
┌──────────────────────────────────────────────────────────┐
│                    Docker Network                         │
│                                                          │
│   ┌──────────────┐         ┌──────────────────────────┐  │
│   │   Frontend    │────────▶│       Backend            │  │
│   │   (nginx)     │  /api/  │   (Express + Go + SQLite)│  │
│   │   Port 80     │  /ws    │   Port 3000              │  │
│   └──────┬───────┘         └──────────┬───────────────┘  │
│          │                            │                   │
│          │                  ┌─────────▼──────────────┐   │
│          │                  │   Elasticsearch (opt)   │   │
│          │                  │   Port 9200             │   │
│          │                  └────────────────────────┘   │
└──────────┼───────────────────────────────────────────────┘
           │
    ┌──────▼──────┐
    │   Browser    │
    │ localhost:80 │
    └─────────────┘
```

### Docker Volumes (Persistent Data)

| Volume | Purpose | Location inside container |
|--------|---------|--------------------------|
| `achilles-data` | Agent database, certificates, settings | `/root/.projectachilles` |
| `repo-cache` | Cached test library (Git) | `/app/data` |
| `go-cache` | Go module cache (faster builds) | `/root/go` |
| `esdata` | Elasticsearch indices (if enabled) | `/usr/share/elasticsearch/data` |

These volumes persist across container restarts and rebuilds. Only `docker compose down -v` removes them.

---

## Quick Reference

| Action | Command |
|--------|---------|
| Start services | `docker compose up -d` |
| Start with Elasticsearch | `docker compose --profile elasticsearch up -d` |
| Stop services | `docker compose down` |
| View logs | `docker compose logs -f` |
| Rebuild after code changes | `docker compose up -d --build` |
| Check service health | `docker compose ps` |
| Full reset (deletes data) | `docker compose down -v` |
| API health check | `curl http://localhost:3000/api/health` |
| Open dashboard | http://localhost |

---

## Next Steps

After installation is complete:

1. **Configure the test library** — Go to Settings in the UI to connect a Git repository with security tests
2. **Set up Elasticsearch** — Either use the local Docker profile or connect to Elastic Cloud for analytics
3. **Upload certificates** — Go to Settings → Certificates to upload code signing certificates for Windows binary signing
4. **Deploy agents** — Create enrollment tokens in the Agents module and deploy the Go agent to target endpoints
5. **Explore the API** — See the [API Reference](README.md#api-reference) for all available endpoints
