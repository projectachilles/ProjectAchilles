# Elasticsearch Migration — Serverless → Self-Hosted DO (tpsgl, 2026-05-02)

> **This is a transient runbook.** It documents the one-off migration of the tpsgl tenant's Elasticsearch from Elastic Cloud Serverless to a self-hosted DigitalOcean droplet and the post-soak cleanup steps. After soak ends and cleanup is done, this is purely historical — keep for audit trail or delete.
>
> Parallel structure to `ELASTICSEARCH_MIGRATION_2026_05.md` (which covers the rga tenant migration done the same day). Different source region, different number of indices, different downstream platform.

## Summary

| | |
|---|---|
| **Date** | 2026-05-02 |
| **Tenant** | tpsgl (Render-deployed backend serving `https://tpsgl.projectachilles.io`) |
| **From** | Elastic Cloud Serverless 9.5.0 (eu-west-2, AWS, London) — `achilles-tpsgl` deployment |
| **To** | Self-hosted Elasticsearch 8.19.15 on DigitalOcean droplet — `tpsgl.es.projectachilles.io` (144.126.203.60) |
| **Why** | Reduce Elastic Cloud cost; consolidate under one provider; gain operator control. Same rationale as the rga migration done the same day. |
| **Approach** | ES native `_reindex` from remote (read-only on source); Render env-var cutover (via dashboard, since Render CLI v2 has no env-var subcommand); delta sync verification |
| **Total docs migrated** | 4,913 parent docs across 5 indices |
| **Wire transfer time** | ~11 s |
| **Cutover downtime on Render** | ~30–60 s (single rolling redeploy after env-var update) |
| **Data loss** | None (count parity verified post-cutover) |

## Architecture before / after

```
BEFORE                                         AFTER

Render achilles-backend (oregon)              Render achilles-backend (oregon)
   ↓                                             ↓
ELASTICSEARCH_CLOUD_ID                        ELASTICSEARCH_NODE
   ↓                                             ↓
Elastic Cloud Serverless 9.5                  tpsgl.es.projectachilles.io
(eu-west-2, AWS, London)                         ↓ Caddy 443 → 127.0.0.1:9200
                                              Elasticsearch 8.19.15 (single-node)
                                                 ↓ daily SLM
                                              DO Spaces LON1 / tpsgl-es-snapshots
```

## Indices migrated

| Index | Parent docs | Notes |
|---|---|---|
| `achilles-defender` | 1,437 | Nested `control_scores` (~33k internal Lucene docs) |
| `achilles-results-` | 1,199 | Trailing dash — preserved literally (legacy artifact) |
| `achilles-results-tpsgl` | 1,984 | Tenant-named results index |
| `achilles-results-tpsgl-work` | 288 | Likely staging/work environment results |
| `achilles-risk-acceptances` | 5 | |

Backend's `ELASTICSEARCH_INDEX_PATTERN=achilles-results-*` matches all three results-pattern indices.

## Phases executed

### Phase 1 — Inspect serverless

Read source mappings + counts via the API key. All field types were 8.x-compatible (boolean, date, float, integer, keyword, nested, text) — safe to copy mappings as-is.

### Phase 2 — Prep DO instance

```bash
# /etc/elasticsearch/elasticsearch.yml — appended
reindex.remote.whitelist: ["*.es.eu-west-2.aws.elastic.cloud:443"]

systemctl restart elasticsearch

# Created the 5 indices on DO with mappings copied from source.
# Settings: number_of_shards=1, number_of_replicas=0, refresh_interval=5s.

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

For each of the 5 indices:

```bash
POST /_reindex?refresh=true&wait_for_completion=true&timeout=10m
{
  "source": {
    "remote": {
      "host": "https://f5de4d562ab6412aa11d62fe385fd0e2.es.eu-west-2.aws.elastic.cloud:443",
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

All 5 returned `created == total`, zero failures, zero version_conflicts. Total wall time ~11 s.

### Phase 4 — Cutover Render env vars

**Done in the Render dashboard** (Render CLI v2 has no env-var subcommand — different from `flyctl secrets set`). At <https://dashboard.render.com/web/srv-d6cse7bh46gs73b0qhvg> → **Environment**:

- Set `ELASTICSEARCH_NODE` = `https://tpsgl.es.projectachilles.io`
- Set `ELASTICSEARCH_API_KEY` = the new DO key (saved at `/root/achilles-backend-api-key.txt` on the droplet)
- Delete `ELASTICSEARCH_CLOUD_ID`
- **Save Changes** → triggers automatic redeploy

Render redeployed; `/api/health` returned 200 within ~60s. Render logs confirmed Defender enrichment running cleanly against the new ES.

### Phase 5 — Delta resync + verify

Re-ran `_reindex` per index with a `range` filter on the index-specific timestamp field, using `op_type: create` + `conflicts: proceed`. Conservative cutover marker: `2026-05-02T12:50:00Z` (well before reindex started — over-fetches harmlessly).

Result:
- `achilles-defender`: 445 docs matched the range filter; **all** were version-conflicts (pre-existing in target). 0 created.
- All 4 other indices: 0 source-side docs since cutover marker.

Final source/target count parity verified — all 5 indices match exactly.

## Soak checklist

- [ ] **By 2026-05-03**: Confirm tpsgl backend is healthy via `render logs -r srv-d6cse7bh46gs73b0qhvg | grep -iE 'error|fail' | head` — should be empty or pre-existing
- [ ] **By 2026-05-03**: Confirm new test results from agents are landing in `achilles-results-*` (counts grow past 1,199 / 1,984 / 288)
- [ ] **By 2026-05-04**: Confirm Defender alert sync runs cleanly (`[Defender] Alert sync result: <N> synced, 0 error(s)` in Render logs)
- [ ] **By 2026-05-09**: Cancel Elastic Cloud Serverless `achilles-tpsgl` subscription (eu-west-2)
- [ ] **By 2026-05-09**: Revoke source API key in the Elastic Cloud UI before subscription end

## Post-soak cleanup

After cancelling the serverless subscription:

```bash
# 1. Remove the reindex.remote.whitelist line from elasticsearch.yml on droplet
ssh -i ~/.ssh/DO root@144.126.203.60 \
  'sed -i "/reindex.remote.whitelist/d; /Reindex from remote — allow pulling from Elastic Cloud serverless source/d" /etc/elasticsearch/elasticsearch.yml \
   && systemctl restart elasticsearch'

# 2. Purge migration working directory on droplet
ssh -i ~/.ssh/DO root@144.126.203.60 'rm -rf /root/es-migration/'

# 3. Archive this runbook in the repo
cd ~/F0RT1KA/ProjectAchilles
mkdir -p docs/archive
git mv docs/ELASTICSEARCH_MIGRATION_2026_05_TPSGL.md docs/archive/
git commit -m 'docs: archive tpsgl ES migration runbook after soak'
git push
```

## Quirks discovered, worth keeping

- **DO Spaces bucket region was LON1, not NYC3** — for tpsgl, the bucket was created in London (LON1), close to the source data location. The rga migration used NYC3 (close to its NYC1 droplet). Both work; just specify the right `endpoint` in the snapshot repo settings: `endpoint: lon1.digitaloceanspaces.com` for tpsgl. **Lesson:** when sweeping DO Spaces regions for a missing bucket, include LON1 (and BLR1, TOR1, JNB1) — not just the NYC/SFO/AMS/SGP/SYD common set.

- **Bucket name typo at handoff** — the bucket was named `tpsgl-es-snapshots` (correct) but the user's text message had `tpsgl-es-snaphots` (missing an 's'). When debugging "bucket not found" errors with DO Spaces, verify the spelling in the DO panel directly rather than trusting the message.

- **Caddy install GPG signing mismatch** — a `sed` substitution in my install script (carried over from the rga install) caused `apt update` to fail with `NO_PUBKEY` on this droplet. The substitution rewrote the cloudsmith-generated `.list` file's host. Cloudsmith likely rotated their CDN URL or signing layout between the two installs. **Fix: do not `sed` the `cloudsmith-generated .list file at all** — trust what `debian.deb.txt` publishes. Removed from future install scripts.

- **Render CLI v2 has no env-var subcommand** — only `services`, `deploys`, `logs`, `restart`, `ssh`, `workflows`, `environments`, `projects`. Env-var changes go through the Render dashboard or the REST API (`PUT /v1/services/{id}/env-vars/{key}`). This is a sharp difference from `flyctl secrets set` used in the rga cutover.

- **Backend triggers full Defender re-sync on first boot against fresh ES** — the log message `[Defender] Sync version mismatch (none → 2) — forcing full re-sync` is normal first-boot behavior. The backend stores a sync version pointer somewhere in ES (likely in `.kibana_*` or app-internal index); when it doesn't find one, it re-syncs the full 90-day Defender alert window. The migrated `achilles-defender` index will grow past 1,437 baseline as a result. This is not data divergence from the migration — it's the backend correctly re-establishing its sync state on the new cluster.

- **Three distinct results indices** — `achilles-results-` (legacy trailing dash, low count), `achilles-results-tpsgl` (main tenant), `achilles-results-tpsgl-work` (probably staging). All migrated independently, all match `achilles-results-*` for backend queries.

- **Reindex API responses with no source matches return null fields in the response body** (same as rga finding). Use `_count` API directly to verify "0 new docs" outcomes; don't trust the reindex response.
