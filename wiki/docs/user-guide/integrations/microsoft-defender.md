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

## Architecture

The Defender integration is composed of four backend services that work together to pull data from Microsoft Graph, store it in Elasticsearch, and expose analytics to the frontend.

```mermaid
graph TB
    subgraph "Microsoft Graph API"
        SS[Secure Scores]
        CP[Control Profiles]
        AL[Security Alerts v2]
    end

    subgraph "Defender Integration Services"
        GC[Graph Client<br/>graph-client.ts]
        SYNC[Sync Service<br/>sync.service.ts]
        AN[Analytics Service<br/>analytics.service.ts]
        IM[Index Management<br/>index-management.ts]
    end

    subgraph "Storage"
        ES[(Elasticsearch<br/>achilles-defender)]
    end

    subgraph "API Layer"
        DR[Defender Routes<br/>/api/analytics/defender/*]
        IR[Integration Routes<br/>/api/integrations/defender/*]
    end

    subgraph "Frontend"
        DASH[Analytics Dashboard<br/>Defender Panels]
        CFG[Settings → Integrations<br/>Defender Card]
    end

    SS --> GC
    CP --> GC
    AL --> GC
    GC --> SYNC
    SYNC --> IM
    AN --> IM
    IM --> ES
    AN --> DR
    SYNC --> DR
    SYNC --> IR
    DR --> DASH
    IR --> CFG
```

### Graph Client

The Graph client (`graph-client.ts`) is a lightweight, SDK-free HTTP client for Microsoft Graph API. It handles the full OAuth2 lifecycle internally.

**OAuth2 Client Credentials Flow:**

```mermaid
sequenceDiagram
    participant GC as Graph Client
    participant AAD as Azure AD
    participant Graph as Microsoft Graph

    GC->>GC: Check cached token (5-min refresh margin)
    alt Token expired or missing
        GC->>AAD: POST /oauth2/v2.0/token<br/>(client_credentials grant)
        AAD-->>GC: access_token + expires_in
        GC->>GC: Cache token with expiry
    end
    GC->>Graph: GET /security/secureScores<br/>Authorization: Bearer <token>
    alt 429 Too Many Requests
        Graph-->>GC: Retry-After header
        GC->>GC: Exponential backoff
        GC->>Graph: Retry request
    end
    alt 401 Unauthorized
        GC->>GC: Invalidate cached token
        GC->>AAD: Re-acquire token
        GC->>Graph: Retry with new token
    end
    Graph-->>GC: OData response (possibly paginated)
    GC->>GC: Follow @odata.nextLink if present
```

**Key behaviors:**
- **Token caching** with a 5-minute refresh margin before actual expiry
- **Automatic OData pagination** — follows `@odata.nextLink` until all pages are retrieved
- **429 retry** with exponential backoff using `Retry-After` header
- **401 recovery** — invalidates the cached token and re-authenticates on the next call

### Sync Service

The sync service (`sync.service.ts`) orchestrates data flow from Graph API to Elasticsearch using type-specific strategies:

| Data Type | Strategy | Frequency | Details |
|-----------|----------|-----------|---------|
| Secure Scores | Upsert by date | Every 6 hours | One document per day, keyed by date |
| Control Profiles | Full replacement | Every 6 hours | Relatively static; entire set is re-indexed |
| Alerts | Incremental | Every 5 minutes | Uses `lastUpdateDateTime` filter to fetch only new/updated alerts |

Each Graph API response is normalized into a consistent document structure with a `doc_type` discriminator field before indexing.

### Elasticsearch Storage Model

All Defender data is stored in a single index (`achilles-defender`) using a **sparse document** pattern with a `doc_type` discriminator:

| Field | Type | Used By | Description |
|-------|------|---------|-------------|
| `doc_type` | keyword | All | `secure_score`, `control_profile`, or `alert` |
| `timestamp` | date | All | Ingestion or event timestamp |
| `score_current` | float | secure_score | Current score value |
| `score_max` | float | secure_score | Maximum possible score |
| `score_percentage` | float | secure_score | `current / max * 100` |
| `control_name` | keyword | control_profile | Control display name |
| `control_category` | keyword | control_profile | Category grouping |
| `implementation_cost` | keyword | control_profile | `low`, `moderate`, `high` |
| `alert_id` | keyword | alert | Microsoft alert identifier |
| `severity` | keyword | alert | `low`, `medium`, `high`, `critical` |
| `status` | keyword | alert | `new`, `inProgress`, `resolved` |
| `mitre_techniques` | keyword[] | alert | MITRE ATT&CK technique IDs (e.g., `T1566.001`) |

:::info Index Design Rationale
A single sparse index is used instead of three separate indices because the total document volume is low (typically hundreds, not millions) and it simplifies cross-document queries and index lifecycle management.
:::

### Cross-Correlation Logic

The analytics service provides three types of cross-correlation between Achilles test results and Defender data:

**1. Detection Rate Analysis**

Correlates attack simulation executions with Defender security alerts within a configurable time window:

```mermaid
graph LR
    A[Test Execution<br/>in achilles-results] -->|Time window<br/>default: 60 min| B[Defender Alerts<br/>in achilles-defender]
    B --> C{Matching<br/>MITRE technique?}
    C -->|Yes| D[Detected]
    C -->|No| E[Undetected]
    D --> F[Detection Rate %]
    E --> F
```

- Queries both indices with overlapping time ranges
- Matches on MITRE ATT&CK technique IDs
- Excludes cyber-hygiene bundle controls (configuration checks, not attack simulations)
- Returns per-technique detection coverage

**2. Technique Coverage Overlap**

Maps MITRE ATT&CK techniques present in both datasets to identify:
- Techniques tested by Achilles **and** detected by Defender (validated coverage)
- Techniques tested by Achilles but **not** detected (detection gaps)
- Techniques detected by Defender but **not** tested (untested detections)

**3. Defense Score vs. Secure Score Trending**

Compares the internal Defense Score (from test results) with Microsoft Secure Score over time using aligned date histograms, enabling teams to see whether improving their Secure Score configuration also improves real detection effectiveness.

### Conditional Frontend Display

All Defender dashboard elements are conditionally rendered based on the `useDefenderConfig` hook:

```
useDefenderConfig() → { configured: boolean, loading: boolean }
```

When `configured` is `false`, Defender panels, tabs, and cross-correlation widgets are hidden entirely — the dashboard shows only Achilles-native analytics. This prevents empty states and confusion for users who have not set up the integration.

## Deployment Variants

| Aspect | Docker / Fly.io / Railway | Vercel (Serverless) |
|--------|--------------------------|---------------------|
| Backend path | `backend/src/services/defender/` | `backend-serverless/src/services/defender/` |
| Settings access | Synchronous file read | Async Vercel Blob read |
| Sync trigger | `setInterval` at server startup | Vercel Cron (`/api/cron/defender-sync`) |
| Credentials | Encrypted file or env vars | Env vars or encrypted blob |

Both variants expose identical API endpoints and analytics capabilities.

## Troubleshooting

:::warning Common Issues
- **"Test Connection" fails with 401**: Verify that admin consent has been granted for the `SecurityEvents.Read.All` permission in Azure AD. Application permissions (not delegated) are required.
- **No data after saving credentials**: The first sync runs on the next interval (up to 6 hours for scores, 5 minutes for alerts). Click **Sync Now** in the integration settings to trigger an immediate sync.
- **Missing alerts**: Alerts require `SecurityEvents.Read.All`. The `SecurityActions.Read.All` and `SecurityReports.Read.All` permissions are needed for control profiles and scores respectively.
:::
