---
sidebar_position: 7
title: "Remote Uninstall"
description: "Remotely uninstall the ProjectAchilles agent from endpoints via the admin UI."
---

# Remote Uninstall

## Two-Phase Uninstall

Remote agent uninstall is a two-phase process:

### Phase 1: Stop Service
The backend sends a stop command via the next heartbeat. The agent:
1. Stops the system service (SCM/systemd/launchd)
2. Removes the service registration
3. Reports back that the service is stopped

### Phase 2: Cleanup
After service stop confirmation:
1. The agent deletes its binary
2. Removes configuration files
3. Removes working directories
4. Sends a final confirmation

## Initiating Remote Uninstall

1. Navigate to **Agents**
2. Select the target agent
3. Click **Uninstall**
4. Confirm the action

The agent must be **online** to receive the uninstall command. For offline agents, you'll need to manually remove the agent from the endpoint.
