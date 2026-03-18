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
