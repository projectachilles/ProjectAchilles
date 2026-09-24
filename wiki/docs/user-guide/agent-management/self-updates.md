---
sidebar_position: 6
title: "Agent Self-Updates"
description: "How ProjectAchilles agents update themselves, how to publish a new agent version safely, and how to keep endpoint security from blocking updates."
---

# Agent Self-Updates

Agents keep themselves current: publish a new version for a platform, and every agent on that platform installs it on its next update check. This page covers how an update runs, how to publish versions, and what to do when endpoint security gets in the way.

## When agents check for updates

An agent asks the server for the latest version (`GET /api/agent/version`):

- **On startup**, right after its first successful heartbeat
- **Every hour** while running (`update_interval` in the agent config, default `1h`)
- **On demand**, when you click **Update** on an agent (or **Update All** on the Agents page)

The server answers with the newest version registered for the agent's OS and architecture, or `204 No Content` when the agent is already on it. Agents never downgrade unless the version is marked **mandatory**.

## How an update runs

1. **Download.** The new binary is saved to a temporary file next to the current one.
2. **Verify.** Its SHA256 hash and size must match what the server advertised. If the agent has an `update_public_key` (set at enrollment), the Ed25519 signature over the hash must also verify. Unsigned or tampered binaries are rejected.
3. **Swap.** The new binary takes the agent's path, and the previous one is kept next to it as `achilles-agent.exe.old` (Windows) or `achilles-agent.old` (Linux/macOS).
4. **Launch check.** The agent runs the new binary once, *at its final path*, with `--version`. It must start, and it must report the version it was advertised as.
5. **Commit or roll back.**
   - If the check passes, the agent reports the result, exits, and the service manager (SCM, systemd or launchd) starts the new binary.
   - If the check fails, the agent **restores the `.old` binary**, keeps running on its current version, and reports the update as failed with the reason.

:::info Launch check requires agent 0.6.6 or later
The launch check (steps 4–5) arrived in agent 0.6.6. The binary doing the update runs this logic, so the update *to* 0.6.6 still ran without it; every update after that is protected. Older agents exit straight after the swap. If Windows then refuses to start the new binary, the agent stays offline until someone starts it by hand (see [Troubleshooting](#troubleshooting)).
:::

On Windows, Service Control Manager recovery actions restart the service after it exits. They don't cover a service that **fails to start**, so the agent also registers a one-time scheduled task (`AchillesAgentRestart`) that starts the service about two minutes later and then deletes itself.

### Update tasks

Clicking **Update** creates an `update_agent` task. It finishes as:

| Status | Output | Meaning |
|---|---|---|
| Completed | `update applied, restart pending` | Installed; the agent restarts on the new version |
| Completed | `already up to date` | The agent was already on the latest version |
| Failed | the reason (e.g. launch check failed, rolled back) | Nothing changed; the agent is still running its previous version |

Each agent has **at most one** open update task: clicking **Update** again while one is pending reuses it instead of queueing another. Judge success by the **Version** column on the Agents page, which comes from the agent's own heartbeat.

## Publishing a new version

Go to **Settings → Agent**. There are two ways to publish.

### Build Agent Binary (recommended)

The server compiles the agent from the git repository in `AGENT_REPO_URL` (branch `AGENT_REPO_BRANCH`, default `main`). Before every build it **fetches the latest commit**, so a build always uses the current branch and doesn't depend on when the server was last deployed. Windows builds are signed with the active code-signing certificate.

- The version you type is compiled into the binary, so its label and what it reports always match.
- The version's release notes record the source commit, e.g. `Built from source (windows/amd64) at 1bbe749`. Check it against your repository before agents pick the version up.
- If the server can't reach the repository, the build **fails** rather than compiling possibly stale code.

### Upload Agent Binary

Upload a binary you built yourself, e.g. a CI release artifact. The server reads the version **compiled into the file** and rejects the upload (HTTP 422) unless it matches the version you entered:

> Version mismatch: this binary was built as 0.6.3 but is being registered as 0.6.4.

Binaries built without a version stamp are rejected too, because the version they would report can't be verified. Build with `make build-all VERSION=<version>`, and check a file before uploading with:

```bash
go version -m achilles-agent-windows-amd64.exe | grep ldflags
#   build   -ldflags="-s -w -X main.version=0.6.6"
```

:::warning Why the version must match
If a binary's embedded version differs from the version it's registered as, every agent that installs it restarts still reporting the old version, is offered the "new" version again, and reinstalls it in a loop until it hits rate limits. The upload check prevents this. Agents 0.6.5 and later also refuse to reinstall the same file (same SHA256) that didn't change their version.
:::

### Rolling out safely

- **Publish one platform first** (usually Windows), watch one or two online agents update and keep heartbeating, then publish the other platforms.
- **To stop a rollout**, delete the version under **Registered Versions**. Agents that haven't updated yet stay on their current version.
- Build versions for **every platform** you run. Agents only see versions registered for their own OS and architecture.

## Endpoint security (Microsoft Defender ASR)

Every new build is a binary no endpoint has seen before. The Defender attack surface reduction (ASR) rule **"Block executable files from running unless they meet a prevalence, age, or trusted list criterion"** (`01443614-cd74-433a-b99e-2ecdc07bfc25`) blocks exactly that. In **Block** mode, Windows refuses to start the updated agent ("Access is denied", Defender event **1121**). Agents 0.6.6 and later detect this and roll back. Older agents go offline.

Add a **per-rule exclusion** for the agent binary. In Intune: **Endpoint security → Attack surface reduction →** your ASR policy **→** the rule above **→ ASR Only Per Rule Exclusions → Add**:

```
C:\F0\achilles-agent.exe
```

:::danger Keep the exclusion narrow
- **Exclude the exact file, not `C:\F0\`.** Security tests run from `C:\F0\tasks\`, and ASR has to keep judging them. Excluding the folder makes blocked tests pass and inflates the Defense Score.
- **Use the per-rule list, not the global "ASR Only Exclusions".** The global list exempts the path from every ASR rule.
- **Don't use a Defender for Endpoint certificate "Allow" indicator.** The agent and all test binaries are signed with the same certificate, so trusting it would let every test through.
:::

To confirm on an endpoint:
- A Defender **event 5007** (configuration changed) naming `achilles-agent.exe` shows the policy arrived.
- The best proof is the next update: the agent keeps heartbeating on the new version.
- To confirm tests are still covered, run a test ASR normally blocks and check that event 1121 names the **test binary**.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Agent goes offline right after an update; the service is `STOPPED` with SCM event 7000 "Access is denied" | Endpoint security blocked the new binary (agents before 0.6.6) | Add the ASR exclusion above, let the policy sync, then run `sc start AchillesAgent` |
| Update task **Failed**: "new agent binary failed its launch check … rolled back" | Same block, caught by a 0.6.6+ agent, which stays on its current version | Add the exclusion. The next update check retries |
| An agent downloads the same version every few seconds and never changes version | The binary's embedded version doesn't match its registered version | Delete that version under **Registered Versions**, then publish a correctly built one |
| Upload rejected with **422** | Embedded version missing or different from the one entered | Rebuild with `VERSION=<version>`, or register it as the version it reports |
| Build fails: "Could not refresh agent source from git" | Server can't reach `AGENT_REPO_URL` | Check network access and `GITHUB_TOKEN`, then retry |
| Update task stuck in **Executing** | Agents before 0.6.5 sent a result the server rejected | Cosmetic: check the Version column. Fixed in 0.6.5 and later |
