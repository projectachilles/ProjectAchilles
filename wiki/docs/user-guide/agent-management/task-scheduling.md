---
sidebar_position: 5
title: "Task Scheduling"
description: "Automate recurring test execution with flexible scheduling options."
---

# Task Scheduling

## Creating a Schedule

1. Navigate to **Scheduling**
2. Click **Create Schedule**
3. Configure:
   - **Test** to execute
   - **Target agents** (specific agents or all)
   - **Frequency** — Once, daily, weekly, monthly
   - **Time** — Specific time or randomized within office hours
   - **Platform/Architecture** for the binary
   - **Target ES index** (optional)

## Schedule Types

| Type | Description |
|------|-------------|
| **Once** | Execute at a specific date and time |
| **Daily** | Execute every day at the specified time |
| **Weekly** | Execute on specific days of the week |
| **Monthly** | Execute on a specific day of the month |

## Randomized Timing

Enable **randomized timing** to execute within office hours (9 AM - 5 PM) at a random time. This provides more realistic simulation of attacker behavior rather than executing at the same time every day.

## Priority Queue

Higher-priority tasks are assigned before lower-priority ones when multiple tasks are pending for the same agent.

## Managing Schedules

- **Pause/Resume** — Temporarily disable a schedule without deleting it
- **Edit** — Modify any schedule parameter
- **Delete** — Permanently remove a schedule
