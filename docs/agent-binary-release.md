# Agent Binary: Build, Register & Distribute

## Prerequisites

- Go 1.21+ installed
- `make` utility
- ProjectAchilles backend running
- A valid Clerk JWT (for the admin API), or direct SQLite access for dev

## 1. Build the Binaries

```bash
cd agent/

# Build both Linux and Windows (amd64) + SHA256SUMS
make build-all

# Or individually:
make build-linux
make build-windows
```

Output in `agent/dist/`:

| File | Platform |
|------|----------|
| `achilles-agent-linux-amd64` | Linux x86_64 |
| `achilles-agent-windows-amd64.exe` | Windows x86_64 |
| `SHA256SUMS` | Checksums for both |

### Custom version

```bash
make build-all VERSION=0.2.0
```

### Optional: sign the Windows binary

Requires a code-signing certificate at `~/.projectachilles/certs/cert.pfx`:

```bash
make sign-windows
```

## 2. Register Binaries with the Backend

> **Prefer the UI:** Settings → Agent → **Build Agent Binary** (compiles the latest `AGENT_REPO_URL` commit and records it in the release notes) or **Upload Agent Binary**. See [Agent Self-Updates](../wiki/docs/user-guide/agent-management/self-updates.md). The options below are for automation and development.

> **⚠️ The registered version must equal the version compiled into the binary.** If they differ, every agent that installs it restarts still reporting the old version, is offered the "new" one again, and reinstalls it in a loop. The backend enforces this for **Upload Agent Binary** and for **Option A** (both return 422 on a mismatch or an unstamped binary). **Option B (direct SQLite) bypasses it**, so check first:
>
> ```bash
> go version -m build/achilles-agent-windows-amd64.exe | grep ldflags
> #   build   -ldflags="-s -w -X main.version=0.2.0"   ← must equal "version" below
> ```

The backend stores a reference to the binary file on disk (not a copy). The file must remain at the registered path.

### Option A: Admin API (production)

Requires a Clerk JWT with admin access. Register each platform separately:

```bash
# Linux
curl -X POST http://localhost:3000/api/agent/admin/versions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -d '{
    "version": "0.1.0",
    "os": "linux",
    "arch": "amd64",
    "binary_path": "/absolute/path/to/agent/dist/achilles-agent-linux-amd64",
    "release_notes": "Initial release",
    "mandatory": false
  }'

# Windows
curl -X POST http://localhost:3000/api/agent/admin/versions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -d '{
    "version": "0.1.0",
    "os": "windows",
    "arch": "amd64",
    "binary_path": "/absolute/path/to/agent/dist/achilles-agent-windows-amd64.exe",
    "release_notes": "Initial release",
    "mandatory": false
  }'
```

### Option B: Direct SQLite (dev only)

```bash
cd agent/dist/

# Linux
SHA=$(sha256sum achilles-agent-linux-amd64 | cut -d' ' -f1)
SIZE=$(wc -c < achilles-agent-linux-amd64)
sqlite3 ~/.projectachilles/agents.db \
  "INSERT OR REPLACE INTO agent_versions
   (version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory)
   VALUES ('0.1.0', 'linux', 'amd64', '$(pwd)/achilles-agent-linux-amd64', '$SHA', $SIZE, 'Initial release', 0);"

# Windows
SHA=$(sha256sum achilles-agent-windows-amd64.exe | cut -d' ' -f1)
SIZE=$(wc -c < achilles-agent-windows-amd64.exe)
sqlite3 ~/.projectachilles/agents.db \
  "INSERT OR REPLACE INTO agent_versions
   (version, os, arch, binary_path, binary_sha256, binary_size, release_notes, mandatory)
   VALUES ('0.1.0', 'windows', 'amd64', '$(pwd)/achilles-agent-windows-amd64.exe', '$SHA', $SIZE, 'Initial release', 0);"
```

### Verify registration

```bash
sqlite3 ~/.projectachilles/agents.db \
  "SELECT version, os, arch, binary_size, substr(binary_sha256,1,16)||'...' FROM agent_versions;"
```

## 3. How Users Get the Binary

Once registered, binaries are available via the public download endpoint (no auth required, rate-limited to 10 req / 15 min per IP):

```
GET /api/agent/download?os={linux|windows}&arch={amd64|arm64}
```

### One-liner install commands

These are shown in the UI when a user generates an enrollment token (Endpoints > Agents > Enroll Agent).

**Linux (amd64):**
```bash
curl -fSL "https://YOUR_SERVER/api/agent/download?os=linux&arch=amd64" -o achilles-agent \
  && chmod +x achilles-agent \
  && sudo ./achilles-agent --enroll TOKEN --server https://YOUR_SERVER --install
```

**Linux (arm64):**
```bash
curl -fSL "https://YOUR_SERVER/api/agent/download?os=linux&arch=arm64" -o achilles-agent \
  && chmod +x achilles-agent \
  && sudo ./achilles-agent --enroll TOKEN --server https://YOUR_SERVER --install
```

**Windows (PowerShell):**
```powershell
Invoke-WebRequest -Uri "https://YOUR_SERVER/api/agent/download?os=windows&arch=amd64" -OutFile achilles-agent.exe
.\achilles-agent.exe --enroll TOKEN --server https://YOUR_SERVER --install
```

### Server URL for remote/tunneled deployments

Set `AGENT_SERVER_URL` in `backend/.env` so the install commands show the correct URL:

```bash
AGENT_SERVER_URL=https://abc123.ngrok-free.app
```

The frontend fetches this from `GET /api/agent/config` and substitutes it into the install commands automatically.

## 4. Updating to a New Version

1. Bump the version and rebuild:
   ```bash
   make clean && make build-all VERSION=0.2.0
   ```
2. Verify the embedded version (`go version -m … | grep ldflags`), then register the new binaries (same commands as step 2; `INSERT OR REPLACE` overwrites per version+os+arch).
3. Connected agents pick up the update on their next check of `GET /api/agent/version`: at startup, every `update_interval` (default 1 h), or immediately via **Update** on the Agents page.
4. Roll out one platform first and watch one or two online agents keep heartbeating on the new version. To stop a rollout, delete the version. On Windows endpoints with Defender ASR in Block mode, add the per-rule exclusion for `C:\F0\achilles-agent.exe` first (see [Agent Self-Updates → Endpoint security](../wiki/docs/user-guide/agent-management/self-updates.md#endpoint-security-microsoft-defender-asr)).

Set `"mandatory": true` to force agents to update before executing any further tasks.

## 5. Verify Everything Works

```bash
# Config endpoint returns the server URL
curl -s http://localhost:3000/api/agent/config

# Download returns a binary (check headers)
curl -sI "http://localhost:3000/api/agent/download?os=linux&arch=amd64"
# Expect: Content-Type: application/octet-stream
#         X-Agent-Version: 0.1.0

# Download the actual binary
curl -fSL "http://localhost:3000/api/agent/download?os=linux&arch=amd64" -o /tmp/test-agent
sha256sum /tmp/test-agent  # should match SHA256SUMS
```

## Quick Reference

| What | Where |
|------|-------|
| Go source | `agent/` |
| Build output | `agent/dist/` |
| Runtime DB | `~/.projectachilles/agents.db` |
| DB table | `agent_versions` |
| Download endpoint | `GET /api/agent/download?os=...&arch=...` |
| Config endpoint | `GET /api/agent/config` |
| Register endpoint | `POST /api/agent/admin/versions` (auth required) |
| Version check endpoint | `GET /api/agent/version?os=...&arch=...` |
| Server URL env var | `AGENT_SERVER_URL` in `backend/.env` |
