---
sidebar_position: 7
title: "Remote Uninstall"
description: "Remotely uninstall the ProjectAchilles agent from endpoints via the admin UI."
---

# Remote Uninstall

Remote uninstall is a task, like a test run or an agent update. The agent picks it up on its next task poll (about 30 seconds), so no access to the endpoint is needed.

## What the agent does

1. **Report.** The agent first reports the task as done (`uninstall initiated`). The server then marks the agent **Uninstalled** and stops accepting its API key.
2. **Remove the service.** The agent stops its service and removes the registration: the `AchillesAgent` Windows service, the `achilles-agent.service` systemd unit, or the launchd plist under `/Library/LaunchDaemons/`.
3. **Delete files (optional).** Only when you tick **Also delete all agent files**: the agent folder (`C:\F0` on Windows, `/opt/f0` on Linux and macOS) with the binary, config, logs and task data. On Windows a detached process deletes the folder a few seconds after the agent exits, because a running binary is locked.

Without that option the service is removed and the files stay on the endpoint for inspection.

## Initiating Remote Uninstall

1. Navigate to **Agents**
2. Open the **⋯** menu on the agent's row and choose **Uninstall**. For several agents, select their rows and click **Uninstall Selected**
3. Optionally tick **Also delete all agent files**
4. Tick the confirmation box and click **Uninstall**

Uninstall needs the `endpoints:agents:delete` permission; the menu entry and the button are hidden without it. Agents that are already uninstalled or decommissioned are refused.

The uninstall shows on the **Tasks** page under the **Maintenance** pill. An uninstalled agent leaves the default agent list; set the status filter to **Uninstalled** to see it.

## Offline agents

The task waits for the agent for **24 hours**. An agent that comes back within that time uninstalls itself; after that the task expires and the agent stays installed. Queue the uninstall again, or remove the agent from the endpoint by hand.

**Uninstall** is not the same as **Delete**. Delete marks the agent **Decommissioned** on the server and stops accepting its API key; it changes nothing on the endpoint, where the service keeps running until you remove it.

To remove an agent by hand, run the installed binary with `--uninstall` as Administrator or root. It removes the service and the agent folder.
