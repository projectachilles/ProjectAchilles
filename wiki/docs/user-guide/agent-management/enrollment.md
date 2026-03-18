---
sidebar_position: 1
title: "Agent Enrollment"
description: "Enroll agents with ProjectAchilles using time-limited, usage-limited enrollment tokens."
---

# Agent Enrollment

## Overview

Agent enrollment is a token-based registration process. An admin creates an enrollment token via the web UI, then provides it to the agent binary at install time.

## Creating Enrollment Tokens

1. Navigate to **Agents** → **Enrollment Tokens**
2. Click **Create Token**
3. Configure:
   - **TTL** — How long the token is valid (hours/days)
   - **Max Uses** — Maximum number of agents that can enroll with this token
4. Click **Create**

The token string is displayed once — copy it and provide it to the person installing the agent.

## Enrolling an Agent

```bash
# Linux/macOS
sudo ./achilles-agent --enroll --server https://your-backend.example.com --token <enrollment-token>

# Windows (PowerShell as Administrator)
.\achilles-agent.exe --enroll --server https://your-backend.example.com --token <enrollment-token>
```

During enrollment:
1. The agent sends system information (hostname, OS, architecture) to the backend
2. The backend validates the token (TTL, max uses, not revoked)
3. The backend creates an agent record and returns an API key + server public key
4. The agent encrypts the API key with a machine-bound key and saves it to disk
5. The agent starts its heartbeat loop

## Token Security

- Tokens use **constant-time bcrypt comparison** to prevent timing oracles
- A dummy hash is compared when no matching token exists (prevents distinguishing "no tokens" from "wrong token")
- Tokens are revocable through the admin UI
- Enrollment is rate-limited to **5 requests per 15 minutes** per IP

## Revoking Tokens

In the Enrollment Tokens list, click **Revoke** to immediately invalidate a token. Agents already enrolled are unaffected.
