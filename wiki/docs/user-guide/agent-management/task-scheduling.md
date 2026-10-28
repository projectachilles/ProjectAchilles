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
   - **Time** — Specific time, or randomized within office hours (fleet-wide or per machine)
   - **Platform/Architecture** for the binary
   - **Target ES index** (optional)

## Schedule Types

| Type | Description |
|------|-------------|
| **Once** | Execute once on a specific date, at a set time or a random time |
| **Daily** | Execute every day at the specified time |
| **Weekly** | Execute on specific days of the week |
| **Monthly** | Execute on a specific day of the month |

## Randomized Timing

Schedules support three timing modes:

| Mode | Behavior |
|------|----------|
| **Fixed time** | Executes at the exact time you set, every run |
| **Randomized (fleet together)** | One random time within office hours (9 AM – 5 PM) per run, shared by all targeted machines |
| **Randomized per machine** | Each targeted agent gets its own independent random time within office hours |

Randomization provides more realistic simulation of attacker behavior than executing at the same time every day. **Per-machine** randomization additionally avoids the whole fleet lighting up detection systems at once — useful for staggering load and for realistic dispersed activity.

**Once** schedules can be randomized too:
- **Fleet together:** every targeted machine runs together at one random time on that date.
- **Per machine:** each machine runs once at its own random time on that date.

Either way, the times fall in that date's window: weekdays 09:00–17:00, weekends any time, in the schedule's timezone. The schedule shows **Completed** after the last machine's turn.
- If the date is today, only the rest of today's window is used.
- A schedule for today is refused once today's window has closed.
- This option is not available on the Vercel (serverless) deployment, which runs Once schedules at a set time only.

A randomized daily, weekly or monthly schedule runs **at most once per day**: after it fires, its next random time is picked on the next eligible day, never later the same day. A run that was skipped or failed also waits for the next eligible day. Editing a schedule picks a new time and may choose later the same day.

The **Next run** shown in the list can sit in the past for up to 5 minutes. That is the scheduler's grace period: a schedule is only moved forward when it is more than 5 minutes overdue, so opening the Schedules or Dashboard page can never skip a run that is about to fire.

## Pre-execution Notices

When [pre-execution notices](../integrations/pre-execution-notices) are on, scheduled runs are announced by email like any other run:

- **Fixed-time and fleet-randomized schedules**: every schedule due in the same minute shares one notice listing all its tests and hosts.
- **Per-machine schedules**: one notice per schedule per day covers the day's randomization window; each machine still runs at its own random time inside it. A machine that comes due too close to the end of the window gets its own notice rather than joining a closed one.

Tests are held until the notice is accepted, so a scheduled run can start a few minutes after its scheduled time.

## Priority Queue

Higher-priority tasks are assigned before lower-priority ones when multiple tasks are pending for the same agent.

## Managing Schedules

- **Pause/Resume** — Temporarily disable a schedule without deleting it
- **Edit** — Modify any schedule parameter
- **Delete** — Permanently remove a schedule
