---
sidebar_position: 1
title: "Architecture"
description: "Go agent architecture — internal packages, CLI entry points, and execution model."
---

# Architecture

## Overview

The agent is a single Go binary (`achilles-agent`) that runs as a system service. It follows the standard Go project layout with `internal/` for private packages.

## CLI Entry Points

```bash
achilles-agent --enroll --server <url> --token <token>  # Register with backend
achilles-agent --install                                 # Install as system service
achilles-agent --run                                     # Start polling loop
achilles-agent --status                                  # Show diagnostics
achilles-agent --uninstall                               # Remove service
```

## Internal Packages

| Package | Purpose |
|---------|---------|
| `config` | Configuration file management |
| `enrollment` | Token-based registration flow |
| `executor` | Test binary download, verify, execute |
| `httpclient` | HTTP client with auth headers and TLS |
| `poller` | Heartbeat and task polling loop |
| `reporter` | Result reporting to backend |
| `service` | OS service management |
| `store` | Encrypted credential storage (AES-256-GCM) |
| `sysinfo` | Platform-specific system information |
| `updater` | Self-update mechanism |

## Execution Model

1. Agent starts and loads encrypted config
2. Enters polling loop (60s interval ± 5s jitter)
3. Each poll: send heartbeat, check for tasks, check for updates
4. If task assigned: download binary → verify → execute → report
5. If update available: download → verify signature → atomic replace → restart
