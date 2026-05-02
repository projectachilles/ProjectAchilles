# Elasticsearch — User Guide

Day-to-day operations for the production Elasticsearch cluster. Companion to [ELASTICSEARCH_INSTALL.md](ELASTICSEARCH_INSTALL.md).

## Placeholders

This guide uses placeholders so it can be shared without leaking install-specific values. Substitute your own values from the install:

| Placeholder | Meaning | Example |
|---|---|---|
| `<hostname>` | Public ES hostname behind Caddy | `es.example.com` |
| `<droplet-ip>` | Public IPv4 of the droplet | `192.0.2.10` |
| `<ssh-key>` | Path to SSH private key for `root@<droplet-ip>` | `~/.ssh/id_ed25519` |
| `<droplet-region>` | DO region the droplet runs in | `NYC1` |
| `<do-region>` | DO region for the Spaces snapshot bucket | `NYC3` |
| `<do-bucket>` | DO Spaces bucket name | `my-es-snapshots` |
| `<cluster-name>` | ES `cluster.name` from `elasticsearch.yml` | `rga` |
| `<kibana-compose-dir>` | Local directory holding `compose.yaml` and `.env` | `~/projects/kibana` |

`$ES_PW` is shorthand for the `elastic` superuser password — see [Where credentials live](#where-credentials-live) below.

---

## Quick reference

| | |
|---|---|
| **ES endpoint** | `https://<hostname>` (port 443) |
| **Kibana** | `http://localhost:5601` (run `docker compose up -d` in `<kibana-compose-dir>`) |
| **Login user** | `elastic` (superuser) — for Kibana UI and admin API calls |
| **Service user** | `kibana_system` — used by the Kibana process only, do not log in as this |
| **SSH** | `ssh -i <ssh-key> root@<droplet-ip>` |

### Where credentials live

| Secret | Location |
|---|---|
| `elastic` password | Droplet: `/root/elasticsearch-credentials.txt` (mode 600) |
| `kibana_system` password | Droplet: `/root/kibana-credentials.txt` and local `<kibana-compose-dir>/.env` |
| Kibana encryption key | Local `<kibana-compose-dir>/.env` |
| DO Spaces access/secret keys | ES keystore on droplet (`elasticsearch-keystore list`); not in any config file |

To grab the elastic password from the droplet:

```bash
ssh -i <ssh-key> root@<droplet-ip> \
  "grep ELASTIC_PASSWORD= /root/elasticsearch-credentials.txt | cut -d= -f2-"
```

The shell variable name shown below — `$ES_PW` — refers to that password. Set it once per terminal session:

```bash
export ES_PW=$(ssh -i <ssh-key> root@<droplet-ip> \
  "grep ELASTIC_PASSWORD= /root/elasticsearch-credentials.txt | cut -d= -f2-")
```

---

## Kibana

From `<kibana-compose-dir>/`:

| Action | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Logs (follow) | `docker compose logs -f kibana` |
| Restart after editing `.env` | `docker compose down && docker compose up -d` |
| Upgrade to a newer 8.x patch | edit `image:` tag in `compose.yaml` → `docker compose pull && docker compose up -d` |
| Memory in use | `docker stats --no-stream kibana` |

Kibana persists all dashboards/visualizations/alerts inside ES indices `.kibana_*`. Those are included in the daily snapshot, so wiping the container does not lose your work — pulling a fresh container reconnects to the same ES and the saved objects are still there.

### Logging in

URL: <http://localhost:5601>. User: `elastic`. Password: from the credentials file above.

### "Container is unhealthy" / "Kibana server is not ready yet"

Most common causes, in order:

1. ES is down → `ssh root@<droplet-ip> 'systemctl status elasticsearch'`
2. Network blip — give it 30 s after `docker compose up`
3. Wrong password in `.env` — check `docker compose logs kibana` for `License information could not be obtained` or `403`
4. Encryption key changed — Kibana refuses to decrypt saved objects encrypted with a previous key. Recover by restoring the old key in `.env`, OR wipe `.kibana_*` indices on ES (loses dashboards) and re-bootstrap

---

## Snapshots

A snapshot of the entire cluster runs daily at **01:30 UTC** to DigitalOcean Spaces (`<do-region>`, bucket `<do-bucket>`). Retention: 30 days, with a floor of 5 and ceiling of 50 snapshots.

### Manual snapshot now

```bash
curl -u "elastic:$ES_PW" -X POST \
  https://<hostname>/_slm/policy/daily/_execute
```

Returns `{"snapshot_name": "..."}`.

### List snapshots

```bash
curl -s -u "elastic:$ES_PW" \
  https://<hostname>/_snapshot/spaces/_all \
  | jq '.snapshots[] | {snapshot, state, start_time, duration: .duration_in_millis, shards: .shards.successful}'
```

### Inspect SLM execution history

```bash
curl -s -u "elastic:$ES_PW" \
  https://<hostname>/_slm/stats | jq
# Look at: total_snapshots_taken, total_snapshots_failed, last_success, last_failure
```

### Restore (DESTRUCTIVE)

Restoring overwrites existing indices. Always close them or rename on restore. Easiest path is via the Kibana UI: **Stack Management → Snapshot and Restore → Restore wizard**.

API equivalent — restore a single snapshot, renaming indices to avoid collisions:

```bash
curl -u "elastic:$ES_PW" -X POST -H 'Content-Type: application/json' \
  https://<hostname>/_snapshot/spaces/<snapshot-name>/_restore \
  -d '{
    "indices": "myindex-*",
    "rename_pattern": "(.+)",
    "rename_replacement": "restored-$1"
  }'
```

### Spaces footprint

```bash
ssh root@<droplet-ip> 's3cmd du s3://<do-bucket>/'
```

> Snapshots are **incremental** at the Lucene-segment level. The wire size of each daily snapshot is roughly your day's delta, not the full dataset. SLM retention pruning is gradual — a deleted snapshot only frees segments no other surviving snapshot references.

### Disabling automatic snapshots

If you need to pause SLM (e.g., during a major migration):

```bash
# pause
curl -u "elastic:$ES_PW" -X POST https://<hostname>/_slm/stop

# resume
curl -u "elastic:$ES_PW" -X POST https://<hostname>/_slm/start
```

---

## TLS certificate

Caddy on the droplet auto-fetches and renews the Let's Encrypt cert via TLS-ALPN-01 on port 443. There is **no manual renewal step**. Renewal runs automatically when the cert is within 30 days of expiry.

### Check current cert

```bash
echo | openssl s_client -connect <hostname>:443 \
  -servername <hostname> 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

### Force a renewal (rare)

```bash
ssh root@<droplet-ip> '
  systemctl restart caddy
  journalctl -u caddy -f
'
# Caddy logs cert acquisition. Look for "certificate obtained successfully".
```

### Cert renewal failed

If a cert failed to renew (extremely rare with Caddy), check:

1. Port 443 still reachable from public internet (`nc -z -w3 <droplet-ip> 443`)
2. Caddy logs: `journalctl -u caddy --since '24 hours ago' | grep -E 'error|obtain'`
3. Disk full on `/var/lib/caddy` (`df -h`)
4. ACME rate limits — Let's Encrypt allows 5 failed validations per hostname per hour

---

## Users and API keys

### Create a new human user

```bash
curl -u "elastic:$ES_PW" -X POST -H 'Content-Type: application/json' \
  https://<hostname>/_security/user/alice \
  -d '{
    "password": "<set-strong-password>",
    "roles": ["kibana_admin", "monitoring_user"],
    "full_name": "Alice Example",
    "email": "alice@example.com"
  }'
```

Built-in roles worth knowing:

| Role | Use for |
|---|---|
| `superuser` | Full admin (only `elastic` should have this) |
| `kibana_admin` | Kibana UI access — manages spaces, dashboards, users |
| `editor` | Read/write all data, edit dashboards |
| `viewer` | Read-only |
| `monitoring_user` | Read access to monitoring data |

### Create an API key for an application

API keys are the right credential for programmatic access — narrower scope, easier to rotate than user passwords.

```bash
curl -u "elastic:$ES_PW" -X POST -H 'Content-Type: application/json' \
  https://<hostname>/_security/api_key \
  -d '{
    "name": "ingest-pipeline-prod",
    "expiration": "365d",
    "role_descriptors": {
      "ingest-only": {
        "cluster": ["monitor"],
        "indices": [
          {
            "names": ["events-*"],
            "privileges": ["write", "create_index"]
          }
        ]
      }
    }
  }'
```

The response includes `id` and `api_key`. The application uses them as `Authorization: ApiKey base64(id:api_key)`. Save them immediately — `api_key` cannot be retrieved later.

### Reset a user's password

```bash
ssh root@<droplet-ip> \
  /usr/share/elasticsearch/bin/elasticsearch-reset-password -u <username> -b -i \
  --url http://127.0.0.1:9200
```

`-i` prompts for the password; omit it for an auto-generated one.

### Revoke an API key

```bash
curl -u "elastic:$ES_PW" -X DELETE -H 'Content-Type: application/json' \
  https://<hostname>/_security/api_key \
  -d '{"ids": ["<api-key-id>"]}'
```

---

## Cluster operations

### Health

```bash
curl -s -u "elastic:$ES_PW" \
  https://<hostname>/_cluster/health | jq
```

| Status | Meaning | Action |
|---|---|---|
| `green` | All shards allocated | None |
| `yellow` | Replicas missing | Expected on a single-node cluster — replicas can't allocate elsewhere. Ignore unless multi-node |
| `red` | Primary shards unassigned | Investigate immediately |

### List indices and disk usage

```bash
curl -s -u "elastic:$ES_PW" \
  "https://<hostname>/_cat/indices?v&s=store.size:desc&h=index,docs.count,store.size,health,status"
```

### Disk and memory on the droplet

```bash
ssh root@<droplet-ip> 'df -h /var/lib/elasticsearch; echo; free -h'
```

### JVM heap pressure

```bash
curl -s -u "elastic:$ES_PW" \
  https://<hostname>/_nodes/stats/jvm | jq '.nodes[].jvm.mem.heap_used_percent'
# Sustained > 75% on a single-node = consider raising heap or upgrading the box
```

### Hot threads (diagnose slow queries)

```bash
curl -s -u "elastic:$ES_PW" \
  https://<hostname>/_nodes/hot_threads
```

### Delete an index (DESTRUCTIVE — name match required)

```bash
# action.destructive_requires_name=true means wildcards are rejected
curl -u "elastic:$ES_PW" -X DELETE \
  https://<hostname>/myindex-2026.04
```

---

## Logs

| Component | Where |
|---|---|
| Elasticsearch app log | Droplet: `/var/log/elasticsearch/<cluster-name>.log` |
| Elasticsearch GC log | Droplet: `/var/log/elasticsearch/gc.log` |
| Elasticsearch slow log | Droplet: `/var/log/elasticsearch/<cluster-name>_index_search_slowlog.log` (when enabled) |
| Caddy access + errors | Droplet: `journalctl -u caddy` |
| ES service journal | Droplet: `journalctl -u elasticsearch` |
| Kibana | Local: `docker compose logs kibana` |

Tail the ES log live during an investigation:

```bash
ssh root@<droplet-ip> 'tail -F /var/log/elasticsearch/<cluster-name>.log'
```

Enable the search slow log for a specific index (logs queries slower than the threshold):

```bash
curl -u "elastic:$ES_PW" -X PUT -H 'Content-Type: application/json' \
  https://<hostname>/myindex/_settings -d '{
    "index.search.slowlog.threshold.query.warn": "5s",
    "index.search.slowlog.threshold.query.info": "2s"
  }'
```

---

## Capacity

### Headroom on a 2 GB droplet

| Resource | Used | Headroom | When to act |
|---|---|---|---|
| RAM (ES) | ~1.5 GB | ~400 MB | Heap pressure > 75% sustained, or OOM kills in journal |
| Disk | varies | of 65 GB | At 70% disk usage, plan to upgrade or trim |
| Snapshot transfer | tiny | DO bandwidth pool | Same-region (`<droplet-region>` ↔ `<do-region>`) is free; only cross-region triggers fees |

### Upgrade triggers

- **Daily heap > 75%** → bump droplet to 4 GB; raise heap to ~1.5 GB.
- **Disk > 70%** → either resize droplet or attach DO Block Storage and `path.data` it.
- **Query latency p95 > 500 ms** → check hot threads first; CPU is the bottleneck on a 1-vCPU box for aggregations.
- **Need HA** → add 2 more nodes (3 master-eligible total), enable replicas, set `discovery.seed_hosts`, drop `discovery.type: single-node`.

### Resizing the DO droplet

DO supports CPU+RAM resize without losing data — droplet shuts down briefly during resize. Disk resize on the same volume is one-way (cannot shrink). Before resizing:

```bash
# 1. Take a snapshot to Spaces
curl -u "elastic:$ES_PW" -X POST \
  https://<hostname>/_slm/policy/daily/_execute

# 2. Stop ES cleanly
ssh root@<droplet-ip> 'systemctl stop elasticsearch'
```

Resize via the DO panel, boot the droplet, then:

```bash
ssh root@<droplet-ip> '
  systemctl start elasticsearch
  curl -u "elastic:$ES_PW" -k http://127.0.0.1:9200/_cluster/health | jq .
'
```

If you bumped to 4 GB+, raise the JVM heap accordingly:

```
# /etc/elasticsearch/jvm.options.d/heap.options
-Xms2g
-Xmx2g
```

Then `systemctl restart elasticsearch`.

---

## Troubleshooting recipes

### "I can't reach the cluster"

```bash
# Layer 1 — DNS
dig +short <hostname>                  # expect <droplet-ip>

# Layer 2 — TCP
nc -zv <droplet-ip> 443                # expect "succeeded"

# Layer 3 — TLS
curl -v https://<hostname>/ 2>&1 | grep -E 'subject|verify'

# Layer 4 — auth
curl -u "elastic:$ES_PW" https://<hostname>/_cluster/health
```

### "ES won't start"

```bash
ssh root@<droplet-ip> '
  systemctl status elasticsearch -l
  journalctl -u elasticsearch --since "10 minutes ago" | tail -50
  tail -50 /var/log/elasticsearch/<cluster-name>.log
'
```

Common culprits:
- `vm.max_map_count` reset after kernel upgrade → `sysctl -p /etc/sysctl.d/99-elasticsearch.conf`
- Disk full → `df -h`
- Heap too small for a new feature → bump `heap.options`
- Corrupt translog after unclean shutdown → see ES docs `elasticsearch-shard remove-corrupted-data`

### "Snapshot failing"

```bash
curl -s -u "elastic:$ES_PW" \
  https://<hostname>/_slm/stats | jq .
# look at last_failure
```

If `last_failure.message` contains `S3 403` → Spaces key was rotated or scope reduced. Re-add to keystore (see [ELASTICSEARCH_INSTALL.md Step 9](ELASTICSEARCH_INSTALL.md)).
If it contains `repository_missing` → repo was deleted. Re-register.
If it contains `concurrent_snapshot_execution_exception` → previous snapshot still running. Usually clears itself; otherwise `_snapshot/spaces/_status` to inspect.

### "Caddy keeps logging cert errors"

```bash
ssh root@<droplet-ip> 'journalctl -u caddy --since "1 hour ago" | grep -E "error|fail" | tail -20'
```

Most likely: ACME rate limit hit (5 fails per hostname per hour at LE). Fix the underlying issue (DNS, port 443 reachability, disk full on `/var/lib/caddy`), wait an hour, retry.

### "Kibana login screen rejects my password"

- Confirm you're using `elastic`, not `kibana_system`.
- Confirm you're using the password in `/root/elasticsearch-credentials.txt`, not the original auto-generated one (which was reset).
- If the password file is gone, reset: `ssh root@<droplet-ip> '/usr/share/elasticsearch/bin/elasticsearch-reset-password -u elastic --url http://127.0.0.1:9200'`.
