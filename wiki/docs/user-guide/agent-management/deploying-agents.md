---
sidebar_position: 2
title: "Deploying Agents"
description: "Build, distribute, and install the ProjectAchilles Go agent on Windows, Linux, and macOS endpoints."
---

# Deploying Agents

## Building Agent Binaries

### From the Web UI

1. Navigate to **Agents** → **Versions**
2. Upload a pre-built binary for the desired platform/architecture
3. Or build from source if the deployment target supports it (Docker, Fly.io, Render)

![Settings agent page — build agent binary, upload binaries, and registered versions table](/img/screenshots/settings-agent.png)

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

### Windows

```powershell
# Run as Administrator
.\achilles-agent.exe --enroll --server https://backend.example.com --token <token>
.\achilles-agent.exe --install
.\achilles-agent.exe --run
```

The agent installs as a Windows Service (SCM) running as SYSTEM.

### Linux

```bash
sudo ./achilles-agent --enroll --server https://backend.example.com --token <token>
sudo ./achilles-agent --install
sudo ./achilles-agent --run
```

The agent installs as a systemd service.

### macOS

```bash
sudo ./achilles-agent --enroll --server https://backend.example.com --token <token>
sudo ./achilles-agent --install
sudo ./achilles-agent --run
```

The agent installs as a launchd plist at `/Library/LaunchDaemons/`.

## Agent Diagnostics

```bash
./achilles-agent --status
```

Shows service state, connection health, configuration validation, and last heartbeat timestamp.
