---
sidebar_position: 2
title: "Deploying Agents"
description: "Build, distribute, and install the ProjectAchilles Go agent on Windows, Linux, and macOS endpoints."
---

# Deploying Agents

## Building Agent Binaries

### From the Web UI

**Settings → Agent** offers two routes, and which you want depends on where the
binary should come from.

![Settings agent page — build agent binary, upload binaries, and registered versions table](/img/screenshots/settings-agent.png)

#### Upload a pre-built binary (recommended for releases)

Upload a binary from a tagged GitHub release and choose the certificate to sign
it with — the active certificate by default.

This is the safer route for a release, because it separates two things that are
easy to conflate:

- **Provenance** comes from the release artifact, which was built from a tagged
  commit and can be checked against the release's `SHA256SUMS`
- **Trust** comes from *your* certificate, which is what your endpoints are
  actually configured to accept

Nothing depends on which agent source happens to be deployed on the server.

Signing is **required by default**: if no certificate is available or signing
fails, the upload is rejected rather than quietly registering an unsigned
binary. Tick **Register unsigned if signing fails** only when you know the
target endpoints do not enforce application control.

| Platform | Signing |
|----------|---------|
| Windows | Authenticode, with the certificate you select |
| macOS | Ad-hoc — no certificate required |
| Linux | None; no ecosystem equivalent |

Re-signing is also how you roll a binary onto a **new certificate** without
rebuilding it: upload the same file again and pick the new cert.

#### Build from source

Cross-compiles on the server and signs Windows output with the **active**
certificate. Available where the Go toolchain is present (Docker Compose,
self-hosted and on-prem servers, Fly.io, Render).

:::warning[The version field and the source are independent]
The build compiles whatever `agent/` source is deployed **on that server**, and
stamps the version string from the form field. Nothing cross-checks them — so
building "0.6.3" on a server still running 0.6.2 source produces a binary that
claims a version it does not contain. Redeploy the instance first, or upload a
release artifact instead.

Signing failure on this path is non-fatal by design (the build still produced a
working binary), so check that **Registered Versions** shows the version as
signed. An unsigned Windows binary is flagged there in amber.
:::

### From Source

```bash
cd agent
make build-all    # Cross-compile for all platforms
```

| Target | Binary Name |
|--------|-------------|
| Windows amd64 | `achilles-agent-windows-amd64.exe` |
| Linux amd64 | `achilles-agent-linux-amd64` |
| macOS amd64 | `achilles-agent-darwin-amd64` |
| macOS arm64 | `achilles-agent-darwin-arm64` |

## Installing the Agent

The easiest way is the install command shown in **Agents → Enrollment** after you
create a token ([Enrollment](./enrollment)). It downloads the agent into its
install folder and runs `--install` from there.

The agent always installs into one fixed folder, which also holds its config and
work directory:

| Platform | Agent binary |
|----------|--------------|
| Windows | `C:\F0\achilles-agent.exe` |
| Linux, macOS | `/opt/f0/achilles-agent` |

`--install` copies the running binary there (unless it already runs from there)
and registers that copy as the service. The file you ran is left where it was and
can be deleted. The Defender ASR per-rule exclusion, the `C:\F0` folder lock and
the EDR guides all name these paths
([Endpoint Prerequisites](../../deployment/endpoint-prerequisites)).

### Windows

Use the Windows command from **Agents → Enrollment** in an elevated PowerShell.
Before it downloads the agent to `C:\F0\achilles-agent.exe`, it refuses a
`C:\F0` that a non-administrator created and locks the folder to SYSTEM and
Administrators ([why](../../deployment/endpoint-prerequisites#4-the-cf0-folder-lock)).
Don't replace it with a plain `New-Item -Force` and `Invoke-WebRequest`: that
would accept a folder another user owns. Then it runs:

```powershell
& 'C:\F0\achilles-agent.exe' --enroll <token> --server https://backend.example.com --install
```

The agent installs as a Windows Service (SCM) running as SYSTEM.

### Linux

```bash
sudo mkdir -p /opt/f0
sudo curl -fSL "https://backend.example.com/api/agent/download?os=linux&arch=amd64" -o /opt/f0/achilles-agent
sudo chmod 700 /opt/f0/achilles-agent
sudo /opt/f0/achilles-agent --enroll <token> --server https://backend.example.com --install
```

The agent installs as a systemd service.

### macOS

Same as Linux, with `os=darwin` and `arch=arm64` (Apple Silicon) or `arch=amd64`
(Intel). The agent installs as a launchd plist at `/Library/LaunchDaemons/`.

### Agent installed in another folder

Agents installed with an older enrollment command can run from the folder the
command was pasted in (on Windows often `C:\Windows\System32`). The agent logs a
`WARNING: the agent is running from …` line at startup when that happens; it
never moves itself. Run the binary the service uses with `--install` as
Administrator or root (agents later than 0.7.1; keeps the enrollment), or
re-run the current enrollment command (any version; enrolls the endpoint again).
See [Agent outside C:\F0](../../deployment/endpoint-prerequisites#agent-outside-cf0).

## Agent Diagnostics

```bash
./achilles-agent --status
```

Shows service state, connection health, configuration validation, and last heartbeat timestamp.
