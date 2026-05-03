# Elasticsearch Migration — Serverless → Self-Hosted DO (2026-05-02)

> **This is a transient runbook.** It documents the one-off migration from Elastic Cloud Serverless to the self-hosted Elasticsearch instance on a DigitalOcean droplet and the post-soak cleanup steps. After the soak window closes and cleanup is done, this document becomes purely historical — keep for audit trail or delete.

## Summary

| | |
|---|---|
| **Date** | 2026-05-02 |
| **From** | Elastic Cloud Serverless 9.5.0 (NorthEurope, Azure) — `achilles-test2` deployment |
| **To** | Self-hosted Elasticsearch 8.19.15 on DigitalOcean droplet (NYC1) — `rga.es.projectachilles.io` |
| **Why** | Reduce Elastic Cloud cost; consolidate ES + Caddy + DO Spaces backups under one provider; gain operator control |
| **Approach** | ES native `_reindex` from remote (read-only on source); Fly secret cutover; delta sync verification |
| **Total docs migrated** | 7,280 parent docs across 4 indices |
| **Wire transfer time** | ~12 s |
| **Cutover downtime on Fly** | ~30 s (single rolling restart) |
| **Data loss** | None (count parity verified post-cutover) |

## Architecture before / after

```
BEFORE                                    AFTER
                                          
Fly app (cdg)                             Fly app (cdg)
   ↓                                         ↓
ELASTICSEARCH_CLOUD_ID                    ELASTICSEARCH_NODE
   ↓                                         ↓
Elastic Cloud Serverless 9.5              rga.es.projectachilles.io (DO NYC1)
(NorthEurope, Azure)                         ↓ Caddy 443 → 127.0.0.1:9200
                                          Elasticsearch 8.19.15 (single-node)
                                             ↓ daily SLM
                                          DO Spaces NYC3 / rga-es-snapshots
```

## Indices migrated

| Index | Parent docs | Notes |
|---|---|---|
| `achilles-defender` | 1,146 | Has `control_scores: nested` (~24,906 internal Lucene docs) |
| `achilles-results-` | 5,932 | Note the trailing dash — preserved literally |
| `achilles-risk-acceptances` | 1 | |
| `archived-achilles-results` | 201 | Not in `init-elasticsearch.sh`; mapping copied from source |

## Phases executed

### Phase 1 — Inspect serverless

Connected with the read-only API key, listed all indices, captured per-index mappings to `/tmp/es-migration/<index>.mapping.json`, recorded ground-truth doc counts. All field types in source were 8.x-compatible (no `semantic_text`, no v9-only types) → safe to copy mappings as-is.

### Phase 2 — Prep DO instance

```bash
# /etc/elasticsearch/elasticsearch.yml — added one line
reindex.remote.whitelist: ["*.es.northeurope.azure.elastic.cloud:443"]

systemctl restart elasticsearch

# Created the 4 indices on DO with mappings copied from source,
# settings tuned for single-node:
#   number_of_shards: 1   (vs serverless's 6)
#   number_of_replicas: 0
#   refresh_interval: 5s

# Minted scoped API key for backend
POST /_security/api_key
{
  "name": "achilles-backend",
  "role_descriptors": {
    "achilles-rw": {
      "cluster": ["monitor"],
      "indices": [{
        "names": ["achilles-*", "archived-achilles-*"],
        "privileges": ["all"]
      }]
    }
  }
}
# → saved at /root/achilles-backend-api-key.txt (mode 600) on droplet
```

### Phase 3 — Initial reindex

For each index:

```bash
POST /_reindex?refresh=true&wait_for_completion=true&timeout=10m
{
  "source": {
    "remote": {
      "host": "https://addfe95ea95a47c686b5a85622c6424c.es.northeurope.azure.elastic.cloud:443",
      "headers": { "Authorization": "ApiKey <source-api-key>" },
      "socket_timeout": "60s",
      "connect_timeout": "30s"
    },
    "index": "<index-name>",
    "size": 500
  },
  "dest": { "index": "<index-name>" }
}
```

All four reindex jobs returned `created == total`, zero failures, zero version_conflicts. Total wall time ~12 s.

### Phase 4 — Cutover Fly secrets

```bash
flyctl secrets unset ELASTICSEARCH_CLOUD_ID --stage -a achilles-backend
flyctl secrets set \
  ELASTICSEARCH_NODE="https://rga.es.projectachilles.io" \
  ELASTICSEARCH_API_KEY="<new-do-api-key>" \
  -a achilles-backend
```

The `--stage` on the unset defers its restart; the subsequent `set` triggers one rolling restart that applies both changes atomically. Post-restart, `flyctl status` showed `1/1 passing` health checks within ~30 s. Backend logs immediately showed Defender enrichment writing to the new ES.

### Phase 5 — Delta resync + verify

Re-ran `_reindex` per index with a `range` filter on the index-specific timestamp field, using `op_type: create` + `conflicts: proceed` to safely skip already-migrated docs. Result: 0 new docs since cutover (defender returned 445 version_conflicts, all pre-existing in target).

Final source/target count parity verified — all four indices match exactly.

## Soak checklist

Mark items as done.

- [ ] **By 2026-05-03**: Confirm dashboards load with data; spot-check Analytics → Defense Score, Heatmap panels
- [ ] **By 2026-05-03**: Confirm new test results from agents are landing in `achilles-results-` (count should grow past 5,932)
- [ ] **By 2026-05-04**: Confirm Defender alert sync is writing to `achilles-defender` (check logs for `Alert sync result: <N> synced, 0 error(s)`)
- [ ] **By 2026-05-09**: Cancel Elastic Cloud Serverless subscription
- [ ] **By 2026-05-09**: Revoke source API key from the Elastic Cloud UI before subscription ends — defense in depth in case the subscription deletion grace period leaves the key briefly active

## Post-soak cleanup

After cancelling the serverless subscription, run:

```bash
# 1. Remove the reindex.remote.whitelist line from elasticsearch.yml
ssh -i ~/.ssh/DO root@192.241.131.142 \
  'sed -i "/reindex.remote.whitelist/d; /Reindex from remote — allow pulling from Elastic Cloud serverless source/d" /etc/elasticsearch/elasticsearch.yml \
   && systemctl restart elasticsearch'

# 2. Purge the migration working directory from the droplet
ssh -i ~/.ssh/DO root@192.241.131.142 'rm -rf /root/es-migration/'

# 3. Mark this doc historical — either move to docs/archive/ or delete entirely
git mv docs/ELASTICSEARCH_MIGRATION_2026_05.md docs/archive/ELASTICSEARCH_MIGRATION_2026_05.md
```

The new DO API key (`achilles-backend`) and Fly secrets (`ELASTICSEARCH_NODE`, `ELASTICSEARCH_API_KEY`) stay in place — they're the production config now.

## Quirks discovered, worth keeping

- **`_cat/indices` doc count differs from `_count`**: For indices with `nested` mappings, `_cat/indices` reports total Lucene docs (including hidden nested children) while `_count` returns parent docs only. The serverless Kibana UI shows `_count`-style numbers; the self-hosted Kibana UI shows `_cat`-style. They are *the same data* — `achilles-defender` shows 1,146 (parent) on serverless and 24,906 (with ~22 nested children each) on DO. Verify parity via `_count` API, never via the index management UI.

- **`achilles-results-` literal trailing dash**: The index name ends in `-` with no suffix. Looks like a bug in the writer at some point that produced an empty date suffix; the name was preserved verbatim. The backend's `ELASTICSEARCH_INDEX_PATTERN=achilles-results-*` matches it correctly. Don't try to "fix" the name — that would require reindex + alias gymnastics for no functional gain.

- **Timestamp field is `routing.event_time`** for `achilles-results-*` (not `@timestamp` and not `event.timestamp`). Use this when filtering test-result queries by time.

- **Storage on DO is significantly smaller than serverless** for the same data (e.g., `achilles-results-`: 3.49 MB → 1.14 MB). Three reasons combined: serverless replicates internally for durability, uses 6 primary shards by default with metadata overhead, and reports stored bytes including its tiered object-store layer. DO with `number_of_replicas: 0` and `number_of_shards: 1` carries none of that overhead.

- **Reindex API responses with no source matches return null fields in the response body** (rather than `total: 0`). Check `failures: []` and `_count` API directly to verify "0 new docs" outcomes — don't trust the reindex response alone.
