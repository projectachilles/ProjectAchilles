---
sidebar_position: 10
title: Data Storage & Clean Reset
description: Where ProjectAchilles stores runtime state, and how to reset an installation to a clean slate.
---

# Data Storage & Clean Reset

Runtime state (agents, tokens, settings, certificates, compiled binaries) is stored **outside the repository** — in the user's home directory or a persistent volume. This is intentional: it protects your data from `git pull`, re-clones, or accidental deletion of the repo folder.

:::info Why this matters
Deleting or renaming the `/ProjectAchilles` repo folder and doing a fresh `git clone` does **not** reset your installation. The backend starts up against the same `agents.db` and shows the same agents, tokens, schedules, and settings as before.

If that surprises you, this page is the page you need.
:::

## Where state lives

| Platform | Data directory |
|----------|----------------|
| Linux / macOS (local) | `~/.projectachilles/` |
| Windows (local) | `C:\Users\<user>\.projectachilles\` |
| Docker Compose | `/root/.projectachilles/` (inside container, backed by named volume `achilles-data`) |
| Render | `/root/.projectachilles/` (backed by persistent disk) |
| Fly.io | `/root/.projectachilles/` (backed by the `achilles_data` volume, 1 GB) |
| Vercel (serverless) | Turso database + Vercel Blob store (no filesystem state) |

## What's inside

| Path | Contents |
|------|----------|
| `agents.db` | SQLite database: agents, enrollment tokens, tasks, schedules, `agent_versions` |
| `analytics.json` | Encrypted Elasticsearch credentials (AES-256-GCM) |
| `integrations.json` | Encrypted Defender, Slack, and email credentials |
| `tests.json` | Test library configuration |
| `certs/cert-*/` | Code-signing PFX certificates (max 5, active cert tracked in `active-cert.txt`) |
| `binaries/<os>-<arch>/` | Compiled Go agents ready to download |
| `builds/<test-uuid>/` | Per-test compiled binaries |
| `signing/` | Agent API key signing keypair |
| `custom-tests/` | User-authored tests outside the git-synced library |

Additionally, test results and Defender alerts are stored in **Elasticsearch** (`achilles-results-*`, `achilles-defender` indices) — that data lives in your ES cluster, not on the local filesystem.

:::tip Design rationale
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
docker compose down --volumes   # removes the achilles-data volume
docker compose up -d
```

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
DELETE FROM agents;
DELETE FROM enrollment_tokens;
SQL
```

Restart the backend afterwards so it reopens the database cleanly.

:::warning Foreign keys
The `tasks` table references `agents` via FK. Delete in the order above (tasks → schedules → agents → enrollment_tokens) or disable foreign keys first with `PRAGMA foreign_keys = OFF;`.
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
