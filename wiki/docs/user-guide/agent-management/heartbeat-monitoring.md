---
sidebar_position: 3
title: "Heartbeat & Monitoring"
description: "Monitor agent health with heartbeat status, system metrics, and online/offline detection."
---

# Heartbeat & Monitoring

## How Heartbeats Work

Each enrolled agent sends a heartbeat to the backend every **60 seconds** (±5s jitter to prevent thundering herd). The heartbeat includes:

- **System metrics** — CPU usage, memory usage, disk usage, uptime
- **Agent version** — Current binary version
- **Hostname** and **OS** information

## Agent Status

| Status | Meaning |
|--------|---------|
| **Online** | Heartbeat received within the last 2 minutes |
| **Offline** | No heartbeat for more than 2 minutes |

## Agent Management UI

The Agents page displays:
- Agent hostname and IP
- Operating system and architecture
- Current status (online/offline)
- Last heartbeat timestamp
- CPU, memory, and disk usage meters
- Agent version
- Custom tags

## Stale Task Detection

If an agent goes offline while executing a task, the task is automatically marked as **failed** with a stale detection message. This prevents tasks from hanging indefinitely.

## Disconnect Reason Reporting

When an agent reconnects after being offline, it reports **why** it was disconnected. The reason appears in the Event Log tab on the agent detail page, next to the "Came Online" event.

| Reason | Icon | Meaning |
|--------|------|---------|
| **Service Restart** | ↻ | Agent process crashed and the OS service manager (SCM/systemd/launchd) restarted it |
| **Machine Reboot** | ⏻ | The host machine was rebooted |
| **Network Recovery** | 📶 | Agent process was running but couldn't reach the server (network outage, VPN disconnect) |
| **Update Restart** | ⬇ | Agent was restarted after applying a self-update |
| **Unknown** | ? | Reason could not be determined (typically agents running an older version) |

The reason is computed by comparing process start time, OS uptime, and the last successful heartbeat timestamp. Agents running versions prior to 0.5.11 will show "Unknown" since they don't send the `reconnect_reason` field.

## Adaptive Heartbeat Backoff

During extended server outages, the agent automatically reduces its heartbeat and polling frequency to minimize wasted network requests:

| Consecutive Failures | Heartbeat Interval | Task Poll Interval |
|---------------------|--------------------|--------------------|
| 0–5 | Normal (60s) | Normal (30s) |
| 6–10 | 5 minutes | 5 minutes |
| 11–20 | 15 minutes | 15 minutes |
| 21+ | 30 minutes (cap) | 30 minutes (cap) |

On the first successful heartbeat after an outage, both intervals **snap back to normal immediately**. The agent logs the recovery: `connectivity recovered after N consecutive failures, resetting intervals`.

## Agent Health Score

Each agent is assigned a **health score** (0–100) visible in the Agents list and on the agent detail page. The score is computed from three metrics over the past 7 days:

| Component | Weight | Description |
|-----------|--------|-------------|
| **Heartbeat Consistency** | 40% | Ratio of received heartbeats to expected heartbeats |
| **Task Success Rate** | 30% | Completed tasks ÷ (completed + failed tasks) |
| **Stability** | 30% | Fewer disconnections = higher score (10+ disconnects in 7 days = 0% stability) |

The score is color-coded in the UI:
- **Green** (80–100) — Healthy agent
- **Amber** (50–79) — Some reliability issues
- **Red** (0–49) — Unreliable, investigate

The fleet average health score is also shown on the Endpoints Dashboard.
