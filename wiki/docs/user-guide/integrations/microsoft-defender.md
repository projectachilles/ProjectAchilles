---
sidebar_position: 2
title: "Microsoft Defender"
description: "Configure Microsoft 365 Defender integration for Secure Score sync and alert cross-correlation."
---

# Microsoft Defender

## Prerequisites

- Microsoft 365 with Defender enabled
- Azure AD App Registration with `SecurityEvents.Read.All` (Application type, admin consent)

## Azure AD Setup

1. Go to [Azure Portal](https://portal.azure.com) → App Registrations → New Registration
2. Name: "ProjectAchilles Defender Integration"
3. Under **API Permissions**, add:
   - `SecurityEvents.Read.All` (Application type)
   - Click **Grant admin consent**
4. Under **Certificates & Secrets**, create a client secret
5. Note the **Application (client) ID**, **Directory (tenant) ID**, and **Client Secret**

## Configuration

1. Navigate to **Settings** → **Integrations** → **Microsoft Defender**
2. Enter:
   - **Tenant ID** — Azure AD Directory (tenant) ID
   - **Client ID** — Application (client) ID
   - **Client Secret** — The secret you created
3. Click **Save** and then **Test Connection**

Credentials are encrypted at rest with AES-256-GCM.

## Sync Behavior

| Data | Sync Interval |
|------|--------------|
| Secure Score + Control Profiles | Every 6 hours |
| Alerts | Every 5 minutes |

In Docker deployments, sync runs via `setInterval`. On Vercel, sync runs via Cron at `/api/cron/defender-sync`.
