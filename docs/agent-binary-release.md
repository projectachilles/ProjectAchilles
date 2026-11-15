# Agent Binary: Build, Register & Distribute

## Prerequisites

- Go 1.26+ installed (`agent/go.mod`)
- `make` utility
- ProjectAchilles backend running
- A valid Clerk JWT (for the admin API), or direct SQLite access for dev

## 1. Build the Binaries

```bash
cd agent/

# Build Windows, Linux and macOS + SHA256SUMS
make build-all

# Or individually:
make build-linux
make build-windows
make build-darwin-amd64
make build-darwin-arm64
```

Output in `agent/dist/`:

| File | Platform |
|------|----------|
| `achilles-agent-linux-amd64` | Linux x86_64 |
| `achilles-agent-windows-amd64.exe` | Windows x86_64 |
| `achilles-agent-darwin-amd64` | macOS Intel |
| `achilles-agent-darwin-arm64` | macOS Apple Silicon |
| `SHA256SUMS` | Checksums for all four |

The Makefile has no Linux arm64 target. For that platform use **Build Agent Binary** in the UI, or run `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build` with the same `-ldflags`.

### Custom version

```bash
make build-all VERSION=0.2.0
```

Without `VERSION`, the build is stamped with the version in `agent/Makefile` (currently `0.7.4`).

### Optional: sign the binaries

```bash
# Windows (Authenticode, needs osslsigncode)
export F0_SIGN_CERT_PATH=/path/to/cert.pfx
export F0_SIGN_CERT_PASS='<pfx password>'
make sign-windows

# macOS (ad-hoc, needs rcodesign)
make sign-darwin
```

`sign-windows` also accepts the legacy layout (`~/.projectachilles/certs/cert.pfx` plus `cert-pass.txt`). It can't use a certificate uploaded in the UI by itself: that password is stored encrypted, so either export the two variables or let the UI build and sign. With no certificate (or no `rcodesign`) the target prints a notice and leaves the binary unsigned.

## 2. Register Binaries with the Backend

> **Prefer the UI:** Settings → Agent → **Build Agent Binary** (compiles the latest `AGENT_REPO_URL` commit and records it in the release notes) or **Upload Agent Binary**. See [Agent Self-Updates](../wiki/docs/user-guide/agent-management/self-updates.md). The options below are for automation and development.

> **⚠️ The registered version must equal the version compiled into the binary.** If they differ, every agent that installs it restarts still reporting the old version, is offered the "new" one again, and reinstalls it in a loop. The backend enforces this for **Upload Agent Binary** and for **Option A** (both return 422 on a mismatch or an unstamped binary). **Option B (direct SQLite) bypasses it**, so check first:
>
> ```bash
> go version -m dist/achilles-agent-windows-amd64.exe | grep ldflags
> #   build   -ldflags="-s -w -X main.version=0.2.0"   ← must equal "version" below
> ```

The backend stores a reference to the binary file on disk (not a copy). The file must remain at the registered path.

### Option A: Admin API (production)

Requires a Clerk JWT or API key with `endpoints:versions:create` (operator or admin role).

**`binary_path` must be a file inside `~/.projectachilles/binaries/` on the backend host** (the home directory of the user running the backend; `/root/.projectachilles/binaries/` in the Docker images). Anything else, including a symlink or `..` path that resolves outside that directory, is rejected with **400**. Registered paths are streamed to every agent and deleted with the version, so the backend will not reference files elsewhere on the host. Copy the binary into place first, then register it:

```bash
mkdir -p ~/.projectachilles/binaries/linux-amd64
cp agent/dist/achilles-agent-linux-amd64 ~/.projectachilles/binaries/linux-amd64/achilles-agent-0.1.0
```

If the binary is built somewhere other than the backend host, use **Upload Agent Binary** (or `POST /api/agent/admin/versions/upload`) instead; it stores the file in the right place for you.

Register each platform separately:

```bash
# Linux
curl -X POST http://localhost:3000/api/agent/admin/versions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -d '{
    "version": "0.1.0",
    "os": "linux",
    "arch": "amd64",
    "binary_path": "/root/.projectachilles/binaries/linux-amd64/achilles-agent-0.1.0",
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
    "binary_path": "/root/.projectachilles/binaries/windows-amd64/achilles-agent-0.1.0.exe",
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

Once registered, binaries are available via the public download endpoint (no auth required, rate-limited to 300 requests / 15 min per IP):

```
GET /api/agent/download?os={linux|windows|darwin}&arch={amd64|arm64}
```

### One-liner install commands

These are shown in the UI when a user generates an enrollment token on the **Agents** page (**Enroll agent** dialog → **Generate Enrollment Token**), one per platform: Windows, Linux amd64 / arm64, macOS Apple Silicon / Intel. Copy them from there. They install the agent into one fixed folder, `C:\F0` on Windows and `/opt/f0` elsewhere, because the service runs the binary from where `--install` runs it and the endpoint guides name that path.

**Linux and macOS** (change `os` and `arch` as needed):
```bash
sudo mkdir -p /opt/f0 && \
  sudo curl -fSL "https://YOUR_SERVER/api/agent/download?os=linux&arch=amd64" -o /opt/f0/achilles-agent && \
  sudo chmod 700 /opt/f0/achilles-agent && \
  sudo /opt/f0/achilles-agent --enroll TOKEN --server https://YOUR_SERVER --install
```

**Windows (elevated PowerShell):** the UI command first creates `C:\F0`, or refuses an existing one that is a link or not owned by SYSTEM or Administrators, and locks it to SYSTEM and Administrators. Then it downloads and enrolls:
```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://YOUR_SERVER/api/agent/download?os=windows&arch=amd64" -OutFile C:\F0\achilles-agent.exe
& C:\F0\achilles-agent.exe --enroll TOKEN --server https://YOUR_SERVER --install
```
Use the full command from the UI rather than these two lines alone: without the folder checks, a `C:\F0` created earlier by a non-administrator would let that user replace the binary the service runs as SYSTEM.

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
4. Roll out one platform first and watch one or two online agents keep heartbeating on the new version. To stop a rollout, delete the version. On Windows endpoints with Defender ASR in Block mode, add the per-rule exclusion for `C:\F0` (that rule only) first (see [Endpoint Prerequisites](../wiki/docs/deployment/endpoint-prerequisites.md)).

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
| Download endpoint | `GET /api/agent/download?os=...&arch=...` (public, 300 / 15 min per IP) |
| Config endpoint | `GET /api/agent/config` |
| Register endpoint | `POST /api/agent/admin/versions` (auth required) |
| Version check endpoint | `GET /api/agent/version?os=...&arch=...` |
| Server URL env var | `AGENT_SERVER_URL` in `backend/.env` |
