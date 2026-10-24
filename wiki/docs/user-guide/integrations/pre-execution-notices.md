---
sidebar_position: 5
title: "Pre-execution Notices"
description: "Email your security engineers before every test run, and hold the tests until the mail server has accepted the notice."
---

# Pre-execution Notices

Pre-execution notices tell your security engineers, by email, that ProjectAchilles is about to run security tests. They can then tell the SOC "that's us" instead of triaging simulated attacks as real ones.

When the feature is on, tests **wait** until the mail server has accepted the notice for every recipient. Then they wait a short lead time (0 to 5 minutes) before they start.

The feature is **off by default**. With it off, nothing about task creation, pickup or expiry changes.

:::note
Pre-execution notices work on Docker Compose, Render, Fly.io, Railway and server installs. They are **not available on Vercel** (the serverless backend), and the settings card is hidden there.
:::

## Turn it on

1. Set up SMTP first. Go to **Settings → Integrations → Alerts & Notifications → Email** and save a working SMTP host, credentials and from-address. Notices reuse this configuration. Notices count SMTP as set up once a host and a from-address are saved.
2. Open **Settings → Integrations → Pre-execution notices**.
3. Enter the recipients (comma or newline separated, up to 50). This list is separate from the alert recipients, because the audience is different. Use plain addresses such as `secops@example.com`, not `Name <address>`.
4. Tick **Enable pre-execution notices** and save. You can only enable it when SMTP is configured and there is at least one recipient. If SMTP is removed or breaks later, runs still wait for a notice: the notice fails to send and the [failure alerts](#when-delivery-fails) fire, so no test runs unannounced. The same holds if stored credentials can no longer be decrypted (for example after `ENCRYPTION_SECRET` changed): notices stay on and the sends fail loudly, rather than the setting reading as off.
5. Click **Send test notice** to send a sample email. The card shows which addresses the mail server accepted and which it rejected.

The settings apply to your organization. Each organization has its own recipients, settings and notice log, and its notices are sent through the SMTP server saved in that organization's Alerting settings, or through the deployment-wide Alerting settings if that organization has none. An organization that has never saved its own settings uses the deployment-wide defaults. A notice belongs to the organization whose tests it announces, and users only see and release their own organization's notices.

## Settings

![Pre-execution notices settings — enable switch, recipients, lead time, max wait for delivery, pickup window and the finished-email option](/img/screenshots/settings-notices.png)

| Setting | Default | Range | What it does |
|---------|---------|-------|--------------|
| **Lead time** | 5 minutes | 0 to 5 | Delay between the mail server accepting the notice and tests starting. The countdown starts at acceptance, so the engineers always get the full lead time. |
| **Max wait for delivery** | 60 minutes | 15 to 1440 | How long a run may wait for the notice to be accepted. After that the run is marked **Not run**. |
| **Pickup window** | 120 minutes | 30 to 1440 | How long, after the tests are released, hosts may still pick them up. |
| **Send finished email** | On | on/off | Sends a second email when the run is over. |

## What triggers a notice

Every test run is covered: **Run Now**, a **manual retry**, every **schedule**, and every **campaign run**. Only test runs are covered. **Run Command**, agent updates and uninstalls never send a notice and never wait for one.

:::caution Run Command is not announced
A command runs immediately as root/SYSTEM on the host, and no email is sent. Commands such as PowerShell one-liners or `whoami /priv` can look like attacker activity to your EDR. If you run commands on monitored hosts, tell your SOC yourself.
:::

- **Run Now and manual retry:** one notice per click. Running several selected tests at once from the test browser is still one click and one notice, which lists every test. A manual retry sends a new notice, because a person decided to run it again.
- **Fleet and fixed-time schedules:** all schedules that come due in the same minute share one notice that lists every test and host.
- **Per-machine (randomized) schedules:** one notice **per schedule per day**, in the schedule's timezone. It covers the day's randomization window (for example 09:00 to 17:00), and each machine runs at its own random time inside it. Machines that come due later the same day join the notice that was already sent, so they do not wait again. A machine that comes due too late to fit the announced window (fewer than 10 minutes left before it closes, or after a backend restart once it has closed) does not silently join it. Its run is announced in a separate email instead, with the normal lead time and pickup window. That one email also covers every other machine of the schedule still due before the window closes, so a busy window end sends one extra email, not one per minute. Those machines may start up to about 10 minutes before their own random time, but never before the email is accepted. Their results arrive in that separate email's Finished message, not the day notice's. Runs caught up after a restart may happen outside the day window.
- **Automatic retries** (after an agent drops or a task times out) belong to the same announced run. They do not send another email.

## What the email contains

The subject looks like `[ProjectAchilles] Security testing starts 2026-10-23 09:05 AST (13:05 UTC) — 3 tests on 12 hosts`. When the timezone is UTC, the time is shown once: `2026-10-23 13:05 UTC`.

The body has:

- A **run tag** such as `PA-RUN-7f3c9a`. It identifies the run in ProjectAchilles (emails, calendar entry, campaign evidence) but never reaches the hosts, so it won't appear in EDR telemetry.
- A **Finding this activity in your security tools** section: on the listed hosts, during the window, the tests run from `C:\F0\tasks` (Windows) or `/opt/f0/tasks` (Linux, macOS), and their files and processes are named after the test UUIDs in the email (for example `c37d6a01-….exe`, or `c37d6a01-…-T1105.exe` for a stage). These are the agent's default folders; an agent configured with a different `work_dir` uses that instead.
- The earliest start time, in the schedule's timezone and in UTC, and the time after which nothing new starts. Per-machine notices show the day's window instead.
- Who or what triggered the run: the user's name and email for Run Now or a manual retry, or the schedule name. The name is looked up when the email is sent. If the lookup fails, the email shows the user ID instead.
- A table of tests: each test's name with its UUID underneath, its number of **stages**, and its MITRE ATT&CK techniques and tactics. A single-binary test counts as 1 stage. A cyber-hygiene bundle shows its number of **controls**, taken from its most recent completed run on your deployment. Before a bundle has run once, it shows `bundle`. A test no longer in the library shows `—`.
- A table of hosts: hostname, operating system, and whether each is online. Offline hosts run only if they reconnect before the window ends. Past 50 hosts, the first 50 are listed and the full list is attached as a CSV file.
- An EDR section for the integrations you have configured (Microsoft Defender, CrowdStrike Falcon). It says which alerts to expect and whether auto-resolve is on, in dry-run, or off. With neither configured, it lists techniques and hosts in vendor-neutral wording.
- A link to the Tasks page.

A calendar file (`.ics`) is attached so the window shows up in the engineers' calendars.

The **finished email** is sent once the window is over and every task has ended. It repeats the run tag, shows the actual start and finish, and counts outcomes with the same labels as Analytics → All Executions and the campaign evidence page: **Protected**, **Prevented**, **Detected**, **Unprotected**, **Error** and **Not run**. Prevented and Detected come from Microsoft Defender or CrowdStrike Falcon alerts that match the test. The email goes out after the pickup window closes, by which time the EDR sync has caught up. If Elasticsearch can't be reached, the email says the counts use test exit codes only. It also updates the calendar entry to end at the real finish time. If it cannot be sent, nothing is held back by that.

## What the Tasks page shows

| Badge | Meaning |
|-------|---------|
| **Sending notice…** | ProjectAchilles is sending the notice email and the task is held until your mail server accepts it. This normally takes seconds; if it lasts longer, sending is failing — hover to see the last SMTP error. No action is needed from the recipients. |
| **Starting soon** | The notice was accepted and the lead time is counting down. |
| **Not run** | The task was never executed. Hover for the reason. |

A task that is held is still in the `pending` state. The agents are unchanged: the server simply does not hand the task out until it is allowed to start.

## Not run: the two reasons

A task that does not run is marked **Expired** with one of these reasons. It is never sent to Elasticsearch, so it does not affect the Defense Score.

- **Not run: notice not delivered.** The mail server did not accept the notice for every recipient within the max wait. A partial rejection counts as a failure, and the whole list is sent again on the next attempt. Attempts back off: the first retry comes 1 minute after a failure, then 2, 4 and 8 minutes, then every 15 minutes until it succeeds or the max wait runs out. Each attempt uses the recipient list currently saved in Settings, so fixing a mistyped address takes effect on the next attempt.

- **Not run: host offline during notice window.** The host did not pick up the task before the window ended. Automatic retries share the original window, so a retry created after it also expires.

If every task in a one-off run is cancelled while its notice is still waiting, the notice is dropped and no email is sent. A schedule's day notice that holds no task simply keeps waiting: it is sent when a later machine's task joins it, and it never raises the banner.

## When delivery fails

A stuck notice must never go unnoticed, because an old Defense Score can look healthy while testing has stopped.

- A **banner** appears at the top of the app when a notice has been pending for more than 5 minutes, or when any notice was not delivered in the last 7 days. It also appears when the daily SMTP check failed. In that case it reads "The daily notice email check failed." You can dismiss it for the current session. It points back to the Settings card.
- The Settings card shows the result of the **daily SMTP check**, which catches an expired mail password before it blocks a real run. The check only runs while notices are enabled. After you turn notices off, a past check failure no longer raises the banner, but notices that were still pending or not delivered do.
- If Slack is configured under Alerting, one message is posted the first time a notice fails to send, and one when it becomes undelivered.

## Release a notice without sending it

When the mail server is down, held tests wait until the max wait runs out. If the SOC has been told some other way, you can let a run start without its email:

1. Open **Settings → Integrations → Pre-execution notices**. When tests are held, the card starts with **"N runs are waiting for their notice email"**, listing each run's tag, how it was started, how long it has waited, how many tests it holds, and the last send error.
2. Click **Release without notice** on the run, type a **reason** (required, for example `Mail server down; SOC informed by phone, ticket CHG-1234`), and click **Release now**.

The held tests start immediately, with no lead time, and the recipients are not emailed. The notice records who released it, when and why, and campaign evidence shows `released without notice by <user> at <time>: <reason>`. It needs the permission that creates tasks. The same action is available through the API (`POST /api/notices/:id/release`); see the [API reference](../../api-reference/alerting#pre-execution-notices).

## Audit record

Every notice is stored with its recipients, which addresses were accepted or rejected, the number of attempts, the last error, the send and release times, and any override. Notices are kept for audit and to prevent duplicate emails after a restart.
