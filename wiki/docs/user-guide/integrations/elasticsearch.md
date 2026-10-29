---
sidebar_position: 1
title: "Elasticsearch Setup"
description: "Connect ProjectAchilles to Elasticsearch for analytics — Elastic Cloud or self-hosted."
---

# Elasticsearch Setup

## Overview

Elasticsearch powers the Analytics dashboard. ProjectAchilles requires Elasticsearch **8.x** — the client version must match the server major version.

:::danger[Client Version Must Match Server]
The `@elastic/elasticsearch` client must stay on version 8.x. Version 9.x sends `compatible-with=9` headers that ES 8.x rejects with HTTP 400.
:::

## Option 1: Elastic Cloud (Recommended)

1. Create a deployment at [elastic.co/cloud](https://www.elastic.co/cloud) (free trial available)
2. From the deployment dashboard, copy:
   - **Cloud ID** — Deployment section
   - **API Key** — Create under Security → API Keys
3. Configure in ProjectAchilles:
   - **Via UI**: Analytics → Setup → enter Cloud ID and API Key
   - **Via env vars**: Set `ELASTICSEARCH_CLOUD_ID` and `ELASTICSEARCH_API_KEY`

## Option 2: Self-Hosted (Docker)

```bash
docker compose --profile elasticsearch up -d
```

Then configure Analytics → Setup with:
- **Node URL**: `http://elasticsearch:9200` (Docker internal) or `http://localhost:9200` (host)
- No credentials needed

## Option 3: Existing Cluster

Set `ELASTICSEARCH_NODE` to your cluster URL:

```bash
ELASTICSEARCH_NODE=https://my-es-cluster.example.com:9200
```

## Index Pattern

Results are stored in indices matching `achilles-results-*` (configurable via `ELASTICSEARCH_INDEX_PATTERN`). The backend creates indices with the correct field mappings automatically.

## API key privileges for EDR integrations \{#edr-api-key-privileges}

If ProjectAchilles connects to Elasticsearch with a scoped API key (not a
superuser), each EDR integration you enable needs its own grants on that key:

| Integration | Indices | Privileges |
|-------------|---------|------------|
| Microsoft Defender | `achilles-defender` | `read`, `write`, `view_index_metadata`, `create_index` |
| CrowdStrike Falcon | `achilles-crowdstrike` | `read`, `write`, `view_index_metadata`, `create_index` |
| SentinelOne | `achilles-sentinelone`, `achilles-sentinelone-posture` | `read`, `write`, `view_index_metadata`, `create_index` |
| Sophos Central | `achilles-sophos` | `read`, `write`, `view_index_metadata`, `create_index` |
| **Every EDR** | your results index pattern (`achilles-results-*`) | `read`, `write` |

- **`write` on the results pattern** lets the integration mark test results as
  detected or prevented. Without it, the EDR's alerts show up but no test is
  ever marked Detected.
- **`create_index`** is only needed until the index exists. If an
  administrator creates the index first, the key can do without it.
- **`manage`** on the EDR index is recommended, not required. It lets a later
  release add fields to the existing index mapping.

**When you save an EDR integration**, ProjectAchilles checks the key and
creates the indices before it reports the result. If the key is missing a
grant, the integration is still saved, and its Settings card shows a red
**Saved, but not syncing** notice listing exactly what to grant. The notice
re-checks once a minute and clears on its own once the grants are in place;
you don't need to save again. **Test Connection** runs the same check without
creating anything. Credentials set through environment variables are checked
when the backend starts.

On a cluster with security disabled (the bundled Docker Elasticsearch), there
are no privileges to check: ProjectAchilles only confirms that Elasticsearch
is reachable.

Example role descriptor for a key used with Sophos (adjust the index names
for the integrations you enable):

```json
{
  "achilles": {
    "cluster": ["monitor"],
    "indices": [
      { "names": ["achilles-results-*"], "privileges": ["read", "write", "create_index", "view_index_metadata", "manage"] },
      { "names": ["achilles-sophos"], "privileges": ["read", "write", "create_index", "view_index_metadata", "manage"] }
    ]
  }
}
```
