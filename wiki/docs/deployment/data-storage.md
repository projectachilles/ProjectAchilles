---
sidebar_position: 12
title: Data Storage & Clean Reset
description: Where ProjectAchilles stores runtime state, and how to reset an installation to a clean slate.
---

# Data Storage & Clean Reset

Runtime state (agents, tokens, settings, certificates, compiled binaries) is stored **outside the repository** — in the user's home directory or a persistent volume. This is intentional: it protects your data from `git pull`, re-clones, or accidental deletion of the repo folder.

:::info[Why this matters]
Deleting or renaming the `/ProjectAchilles` repo folder and doing a fresh `git clone` does **not** reset your installation. The backend starts up against the same `agents.db` and shows the same agents, tokens, schedules, and settings as before.

If that surprises you, this page is the page you need.
:::

## Where state lives

| Platform | Data directory |
|----------|----------------|
| Linux / macOS (local) | `~/.projectachilles/` |
| Windows (local) | `C:\Users\<user>\.projectachilles\` |
| Docker Compose | `/root/.projectachilles/` (inside container, backed by named volume `achilles-data`) |
| Server install (Caddy, `docker-compose.server.yml`) and the Hyper-V appliance | `/root/.projectachilles/` (inside the backend container, backed by the `achilles-data` volume of the compose project: `achilles-server_achilles-data` unless `COMPOSE_PROJECT_NAME` is set) |
| Render | `/root/.projectachilles/` (backed by persistent disk) |
| Fly.io | `/root/.projectachilles/` (backed by the `achilles_data` volume, 1 GB) |
| Vercel (serverless) | Turso database + Vercel Blob store (no filesystem state) |

## What's inside

| Path | Contents |
|------|----------|
| `agents.db` | SQLite database (see the table list below) |
| `analytics.json` | Encrypted Elasticsearch credentials (AES-256-GCM) |
| `integrations.json` | Integration settings with encrypted secrets: Defender, CrowdStrike, SentinelOne, Sophos, Azure, alerts (Slack, email) and pre-execution notices |
| `tests.json` | Test library configuration |
| `agent-settings.json` | Agent key auto-rotation settings |
| `console-identity.json` | [Console identity](../user-guide/settings/console-identity) saved in Settings → General (code, name, colour) |
| `certs/cert-*/` | Code-signing PFX certificates (max 5, active cert tracked in `active-cert.txt`) |
| `binaries/<os>-<arch>/` | Compiled Go agents ready to download |
| `builds/<test-uuid>/` | Per-test compiled binaries |
| `signing/` | Agent API key signing keypair |
| `custom-tests/` | User-authored tests outside the git-synced library |
| `go-cache/` | Go module cache used by agent builds |

Additionally, test results and EDR alerts are stored in **Elasticsearch**. That data lives in your ES cluster, not on the local filesystem:

| Index | Contents |
|-------|----------|
| `achilles-results-*` | Test results |
| `achilles-risk-acceptances` | Risk acceptances |
| `achilles-defender`, `achilles-crowdstrike`, `achilles-sentinelone`, `achilles-sophos` | Alerts and posture data synced from each EDR |
| `achilles-sentinelone-posture` | SentinelOne posture (policies, agents, exclusions, Endpoint Protection score) |

### Tables in `agents.db`

| Table | Contents |
|-------|----------|
| `agents`, `enrollment_tokens`, `agent_versions` | Enrolled agents, enrollment tokens, registered agent builds |
| `tasks`, `schedules` | Task runs with their results, and schedules |
| `deleted_tasks` | Tasks deleted from the Tasks page. The full row is archived here with who deleted it and when |
| `heartbeat_history`, `agent_events` | Agent heartbeat metrics and events (online, offline, task, key and version events) |
| `agent_key_digests` | A digest of each agent key the backend has already verified, so agent requests stay fast after a restart |
| `run_notices`, `notice_digests` | [Pre-execution notices](../user-guide/integrations/pre-execution-notices) and the daily advance digest |
| `campaigns`, `campaign_runs` | Saved [campaigns](../user-guide/agent-management/campaigns) and a snapshot of each run |
| `api_keys` | API keys (stored hashed) |
| `cli_auth_codes`, `cli_refresh_tokens`, `cli_session_revocations` | CLI sign-in state |

### What is pruned automatically

The backend prunes SQLite on its own, hourly:

- Heartbeat history older than 30 days is deleted.
- Task output older than `TASK_OUTPUT_RETENTION_DAYS` (default 90) is compacted: the exit code, error and stage results stay.
- Agent events older than `AGENT_EVENT_RETENTION_DAYS` (default 90) are deleted, except each agent's latest went-offline event.

See [Retention](./environment-variables#retention) for the exact rules. The database file does not shrink (no VACUUM); freed pages are reused, so growth stops. Elasticsearch data is not pruned by ProjectAchilles.

:::tip[Design rationale]
Storing runtime state outside the repo means `git pull`, re-clones, or even `rm -rf` on the repo folder can never destroy production data. That's a safety feature, not an oversight.
:::

## Clean reset (start from scratch)

Stop services and remove the data directory. The next startup will create an empty database.

### Linux / macOS (local install)

```bash
./scripts/start.sh --stop
rm -rf ~/.projectachilles

# optional: also wipe Elasticsearch test results
curl -X DELETE "$ELASTICSEARCH_NODE/achilles-results-*"
curl -X DELETE "$ELASTICSEARCH_NODE/achilles-defender"
```

### Windows (PowerShell)

```powershell
# Stop services first
.\scripts\start.sh --stop

Remove-Item -Recurse -Force $HOME\.projectachilles
```

### Docker Compose

```bash
docker compose down --volumes   # removes every volume: achilles-data, repo-cache, go-cache and esdata (local Elasticsearch)
docker compose up -d
```

On a server install, add `-f docker-compose.server.yml` (and `--profile elasticsearch` when Elasticsearch runs on the server), then run `./scripts/deploy-server.sh` again. Take a backup first with `achilles-installer backup` if you may need the data.

### Render

1. Dashboard → your backend service → **Disks**
2. Delete the persistent disk
3. Recreate the disk (same mount path: `/root/.projectachilles`)
4. Redeploy the service

### Fly.io

```bash
# List and destroy the volume
flyctl volumes list -a achilles-backend
flyctl volumes destroy <volume-id> -a achilles-backend

# Recreate and redeploy
flyctl volumes create achilles_data -s 1 -r cdg -a achilles-backend
flyctl deploy -a achilles-backend
```

### Vercel (serverless)

```bash
# Drop and recreate the Turso database
turso db destroy <database-name>
turso db create <database-name>
# Update TURSO_DATABASE_URL / TURSO_AUTH_TOKEN env vars in Vercel

# Clear the Blob store (via Dashboard or CLI)
vercel blob list
vercel blob rm <url>   # for each blob
```

## Selective reset (keep install, clear agents only)

If you want to keep your Clerk config, certificates, and ES credentials but remove all enrolled agents:

```bash
sqlite3 ~/.projectachilles/agents.db <<'SQL'
DELETE FROM tasks;
DELETE FROM schedules;
DELETE FROM heartbeat_history;
DELETE FROM agent_events;
DELETE FROM agent_key_digests;
DELETE FROM agents;
DELETE FROM enrollment_tokens;
SQL
```

Stop the backend first and start it afterwards, so it reopens the database cleanly. Campaigns, past campaign runs, notices and archived deleted tasks are left in place; a campaign that names a removed agent has to be edited before its next run.

:::warning[Foreign keys]
The `tasks`, `heartbeat_history` and `agent_events` tables reference `agents` via FK. Delete in the order above (agents after the tables that reference it) or disable foreign keys first with `PRAGMA foreign_keys = OFF;`.
:::

## Backing up state

Before a reset, you may want to capture current state:

```bash
# SQLite (safe hot backup)
sqlite3 ~/.projectachilles/agents.db ".backup ~/achilles-backup-$(date +%F).db"

# Full directory snapshot
tar czf ~/achilles-backup-$(date +%F).tar.gz -C ~ .projectachilles

# Elasticsearch (snapshot API, requires snapshot repository)
curl -X PUT "$ELASTICSEARCH_NODE/_snapshot/achilles/snapshot-$(date +%F)?wait_for_completion=true" \
  -H 'Content-Type: application/json' \
  -d '{"indices": "achilles-*"}'
```

Restoring is the reverse: stop services, copy the backup directory back into place, start services.

## Related

- [Docker Compose deployment](./docker-compose.md)
- [Fly.io deployment](./fly-io.md)
- [Render deployment](./render.md)
- [Vercel deployment](./vercel.md)
- [Environment variables reference](./environment-variables.md)
