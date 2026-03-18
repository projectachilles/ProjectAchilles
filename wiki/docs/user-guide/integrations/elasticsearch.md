---
sidebar_position: 1
title: "Elasticsearch Setup"
description: "Connect ProjectAchilles to Elasticsearch for analytics — Elastic Cloud or self-hosted."
---

# Elasticsearch Setup

## Overview

Elasticsearch powers the Analytics dashboard. ProjectAchilles requires Elasticsearch **8.x** — the client version must match the server major version.

:::danger Client Version Must Match Server
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
