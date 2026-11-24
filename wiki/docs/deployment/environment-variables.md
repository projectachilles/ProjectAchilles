---
sidebar_position: 11
title: Environment Variables Reference
description: Complete reference of all environment variables across all ProjectAchilles deployment targets.
---

# Environment Variables Reference

This page consolidates all environment variables used across all deployment targets.

## Backend Variables

### Required (All Targets)

| Variable | Description | Example |
|----------|-------------|---------|
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key | `pk_live_abc123...` |
| `CLERK_SECRET_KEY` | Clerk secret key | `sk_live_xyz789...` |
| `CORS_ORIGIN` | Allowed CORS origin (frontend URL) | `https://app.example.com` |

### Required (Production)

| Variable | Description | Notes |
|----------|-------------|-------|
| `ENCRYPTION_SECRET` | Key for the settings encrypted at rest (Elasticsearch, integration and certificate secrets) | At least 32 characters (`openssl rand -base64 32`). There is no fallback: without it, encrypted settings can be neither saved nor read. Keep it stable; if it changes, the saved settings can no longer be read |
| `CLI_AUTH_SECRET` | JWT signing key for CLI device-flow sign-in (`achilles login`) | `openssl rand -base64 32`. Without it CLI sign-in returns an error. Not used on Vercel (no CLI sign-in routes) |
| `AGENT_SERVER_URL` | External URL agents use to reach the backend. It is put in enrollment commands, and CLI tokens are bound to it: changing it invalidates outstanding CLI access tokens (the CLI gets a new one on its next refresh) | Must include `https://` |
| `SESSION_SECRET` | Not read by the backend today. The setup scripts, `render.yaml` and the installer still generate it, and it is harmless to keep | `openssl rand -base64 32` |

### Retention

| Variable | Description |
|----------|-------------|
| `TASK_OUTPUT_RETENTION_DAYS` | Days to keep full task output in SQLite. After that, finished tasks lose their stdout, keep the last 400 characters of stderr, and lose each stage's `details`; exit code, error and stage results are kept, and the Tasks page says the output was removed. Test results are compacted only once they are in Elasticsearch; agent update and uninstall output (never in Elasticsearch) is compacted after the window; admin shell-command (`execute_command`) output is never compacted. `0` disables. Default `90` |
| `AGENT_EVENT_RETENTION_DAYS` | Days to keep agent events (online/offline, task, key and version events). Each agent's latest went-offline event is always kept, so a long-offline agent is not reported offline again. `0` disables. Default `90` |

The SQLite file does not shrink (no VACUUM); freed pages are reused, so growth stops. Both jobs run hourly.

### Elasticsearch

| Variable | Description |
|----------|-------------|
| `ELASTICSEARCH_CLOUD_ID` | Elastic Cloud deployment ID |
| `ELASTICSEARCH_API_KEY` | API key for authentication (see required permissions below) |
| `ELASTICSEARCH_NODE` | Direct node URL (e.g., `http://localhost:9200`) |
| `ELASTICSEARCH_USERNAME` / `ELASTICSEARCH_PASSWORD` | Basic authentication, as an alternative to `ELASTICSEARCH_API_KEY` |
| `ELASTICSEARCH_CA_CERT` | CA certificate (PEM text) used to verify the Elasticsearch server certificate |
| `ELASTICSEARCH_TLS_INSECURE_SKIP_VERIFY` | `true` skips TLS certificate verification. For labs only |
| `ELASTICSEARCH_INDEX_PATTERN` | Read index pattern (default: `achilles-results-*`) |
| `ELASTICSEARCH_WRITE_INDEX_PREFIX` | Write index prefix (default: `achilles-results-`) |
| `ELASTICSEARCH_WRITE_INDEX_ROLLOVER` | Write index rollover mode: `none` (default), `daily`, or `monthly` |
| `ES_TIMING_LOG` | `off` stops the `[es-timing]` log line written for each API request that queried Elasticsearch (calls, client wait, and the `took` Elasticsearch reports; never the query string). The same numbers are always sent in the `Server-Timing` response header, visible in the browser's developer tools. Default: on |

:::info[Elasticsearch API Key Permissions]
When creating an API key manually (Kibana → Stack Management → API Keys), use these role descriptors:

```json
{
  "achilles_role": {
    "cluster": ["monitor"],
    "indices": [{
      "names": ["achilles-*", "archived-*"],
      "privileges": ["manage", "read", "write"],
      "allow_restricted_indices": false
    }]
  }
}
```

For local development, `start.sh` creates this key automatically from the `elastic` user password.
:::

### Test Library

| Variable | Description |
|----------|-------------|
| `TESTS_REPO_URL` | Git URL for the test library. Unset: the public `f0_library` (`https://github.com/ubercylon8/f0_library.git`). Set it to an empty value to turn Git sync off and use `TESTS_SOURCE_PATH` |
| `TESTS_REPO_BRANCH` | Branch to sync (default: `main`) |
| `TESTS_LOCAL_PATH` | Folder the test library is cloned into |
| `GITHUB_TOKEN` | PAT for private repos (test library and agent source) |
| `TESTS_SOURCE_PATH` | Local `tests_source` folder, used when Git sync is off |
| `CUSTOM_TESTS_PATH` | Folder for your own tests. They are listed before the synced library and win when two tests share a UUID (default: `~/.projectachilles/custom-tests`) |
| `TESTS_UPDATE_CHECK` | `off` turns off the timed check of the published test versions (2 minutes after start, then every 6 hours) and the check after a re-index of the library. **Check now** still works, and a Sync still records what it fetched as the published version. Restart the backend after changing it. Not used on Vercel. See [Test Versions](../user-guide/test-browser/test-versions#how-the-console-knows-what-is-published). Default: on |

### Test Builds

| Variable | Description |
|----------|-------------|
| `BUILD_NICE` | Niceness level (for example `15`) for build subprocesses (`go build`, `go mod`, `build_all.sh`), so a build cannot starve the API on a small instance. Unset or `off`: normal priority. `render.yaml` sets `15`. Ignored on Windows |
| `BUILD_ENV_PASSTHROUGH` | Comma-separated names of extra environment variables that build subprocesses may see. Builds get a fixed allowlist (path, Go toolchain, proxy and CA variables), never the backend's full environment, so test-library code cannot read the backend's secrets. Add a name here when a build on your install needs one more variable |

### Agent Build

| Variable | Description |
|----------|-------------|
| `AGENT_REPO_URL` | Git URL of the agent source. When set, the backend clones the `agent/` folder and refreshes the clone before every *Build from source* |
| `AGENT_REPO_BRANCH` | Branch to clone (default: `main`) |
| `AGENT_LOCAL_PATH` | Folder the agent source is cloned into |
| `AGENT_SOURCE_PATH` | Agent source folder used when `AGENT_REPO_URL` is unset or the clone fails. The compose files set it to `/agent-src`, the host checkout's `agent/` mounted read-only |
| `AGENT_SOURCE_GIT_DIR` | The `.git` folder of that checkout, so a build can record the commit it compiled. The compose files mount the host's `.git` read-only at `/agent-src-git`. Default: `.git` next to the agent source |

With the compose files (Docker Compose and server installs) and no `AGENT_REPO_URL`, *Build from source* compiles the host checkout: run `git pull` on the host before you build, or the old code is built under the new version. With `AGENT_REPO_URL` set, the backend builds from its own clone, which it refreshes before every build.

### Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Node environment | `development` |
| `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the backend (Express `trust proxy`). It decides which address the backend takes as the client IP | `1` |
| `CLUSTER_WORKERS` | `2` or more starts that many HTTP worker processes, and the primary process runs the background jobs. Unset, `0` or `1`: one process | Unset |
| `PUBLIC_APP_URL` | Console URL used for the sign-up link in user invitations | `CORS_ORIGIN` |
| `AGENT_DOWNLOAD_BUDGET_MB_PER_MIN` | Test binary handouts per minute, in MB. Once a minute's worth of test binaries has been handed out, other agents get "no task" and pick theirs up at the next poll (agent update tasks are not paced). At 1500 MB/min, a 30-minute pre-execution notice pickup window covers about 2,600 agents with a 17 MB binary (about 1,100 with 40 MB); raise the budget or the window beyond that. `0` disables pacing. Read once at startup. Not used on Vercel. | `1500` |

### Organization

| Variable | Description | Default |
|----------|-------------|---------|
| `ORGANIZATION_NAME` | The organization this deployment serves. The [execution report](../user-guide/analytics/execution-report) prints it on the cover, in the scope table and in every page header, unless `CONSOLE_ORG_NAME` is set or a [console identity](../user-guide/settings/console-identity) is saved in Settings → General (the saved full name wins). A name longer than 56 characters is cut with an ellipsis in the report. | Unset: the report says *All organizations* |
| `ORG_NAMES` | Display names for organization UUIDs (`routing.oid`) in Analytics, the execution report and the compliance export. JSON keyed by org UUID; each value is a short name or `{"shortName": "...", "fullName": "..."}`, for example `{"<org-uuid>": {"shortName": "ACME", "fullName": "Acme Corporation"}}`. | Unset: organizations show the first 8 characters of their UUID |
| `CONSOLE_ORG_CODE` | Organization code (2-6 letters or digits, uppercased) shown in the sidebar, page headers, colour ribbon, browser tab and favicon. See [console identity](../user-guide/settings/console-identity). A code saved in Settings → General replaces these three variables. Not supported on Vercel. | Unset: no console identity |
| `CONSOLE_ORG_NAME` | Optional full name shown beside the code (up to 80 characters), and printed as the organization name on the execution report. Falls back to `ORGANIZATION_NAME`. See [console identity](../user-guide/settings/console-identity). | Unset: no name |
| `REQUIRE_ORG_ISOLATION` | `true` rejects (403) every signed-in user or API key that belongs to no Clerk organization, on every organization-scoped route: agents, tasks, schedules, Analytics and reports, enrollment tokens, campaigns, pre-execution notices and alert settings. It also makes the shared EDR settings read-only from the UI. Users and keys that belong to an organization only ever see and act on their own organization's agents, tasks, schedules and results, whether this is set or not. Install-wide configuration (agent versions, the Elasticsearch connection and index creation, agent key auto-rotation) can only be changed by users without an organization, and they keep that access when this is set. This is defense in depth, not a tenant boundary: sharing one install between organizations is not supported (one install per organization is). | Unset: users without an organization see the whole install (single-organization installs) |
| `CONSOLE_ORG_COLOR` | Identity colour preset: `violet`, `indigo`, `blue`, `cyan`, `fuchsia`, `pink`, `orange`, `silver` or `none`. See [console identity](../user-guide/settings/console-identity). | `none` |

### EDR and Identity Integrations

Optional. Each integration can be configured in **Settings → Integrations** or with these variables. EDR settings apply to the whole install. With `REQUIRE_ORG_ISOLATION=true` the EDR settings are read-only in the UI, so use the variables there. While the variables are set, the integration cannot be disconnected from the UI. SentinelOne and Sophos are not available on Vercel.

| Variable | Description |
|----------|-------------|
| `DEFENDER_TENANT_ID`, `DEFENDER_CLIENT_ID` | Microsoft Defender app registration. Both are needed, plus a secret or a certificate |
| `DEFENDER_CLIENT_SECRET` | Client secret |
| `DEFENDER_CERT_THUMBPRINT`, `DEFENDER_PRIVATE_KEY_PEM` | Certificate authentication. Used instead of the secret when both are set |
| `DEFENDER_TENANT_LABEL` | Display label |
| `CROWDSTRIKE_CLIENT_ID`, `CROWDSTRIKE_CLIENT_SECRET` | CrowdStrike Falcon API client |
| `CROWDSTRIKE_REGION` | `us-1` (default), `us-2`, `eu-1` or `us-gov-1`. An invalid value is ignored |
| `CROWDSTRIKE_LABEL` | Display label |
| `SENTINELONE_BASE_URL`, `SENTINELONE_API_TOKEN` | SentinelOne console URL (`*.sentinelone.net` or `*.s1gov.net`) and API token |
| `SENTINELONE_PERMISSION_MODE` | `read_only` (default) or `response` |
| `SENTINELONE_LABEL` | Display label |
| `SOPHOS_CLIENT_ID`, `SOPHOS_CLIENT_SECRET` | Sophos Central tenant API credential |
| `SOPHOS_PERMISSION_MODE` | `read_only` (default) or `response` |
| `SOPHOS_LABEL` | Display label |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` | Azure / Entra ID app registration used by the identity tests. Both are needed, plus a secret or a certificate |
| `AZURE_CLIENT_SECRET` | Client secret |
| `AZURE_CERT_THUMBPRINT`, `AZURE_PRIVATE_KEY_PEM` | Certificate authentication. Used instead of the secret when both are set |
| `AZURE_TENANT_LABEL` | Display label |
| `F0_EDR_LAST_SEEN_HOURS` | How recently Sophos or SentinelOne must have seen an endpoint for its console data to be used as evidence for cyber-hygiene bundle controls. 1 to 720 hours. Default `24` |

### Vercel-Only

| Variable | Description |
|----------|-------------|
| `TURSO_DATABASE_URL` | Turso database URL (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | Turso authentication token |
| `SIGNING_PRIVATE_KEY_B64` | Ed25519 private key (base64, PKCS8 DER) |
| `SIGNING_PUBLIC_KEY_B64` | Ed25519 public key (base64, SPKI DER) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token (auto-provisioned when Blob integration is added via Vercel Marketplace) |
| `CRON_SECRET` | Protects the `/api/cron/*` routes. Vercel sets it and sends it with every cron call |

The Vercel backend does not read the retention, download budget, build, agent build, console identity, SentinelOne, Sophos or `CLI_AUTH_SECRET` variables: those features are not on Vercel.

### Server Install (Caddy)

The single-server install (`scripts/deploy-server.sh`, `achilles-installer`) reads its own settings from `deploy.config.env`: `ACHILLES_DOMAIN`, `TLS_MODE`, `ES_MODE`, `ADMIN_EMAIL`, `CADDY_BIND_IP`, `CA_ZONE` and others. The script writes `backend/.env` and the root `.env` from them. See the [Server Installer](./server-installer) guide and the comments in `deploy.config.env.example`.

### Local Tunnel (`./scripts/start.sh --tunnel`)

| Variable | Description |
|----------|-------------|
| `NGROK_FRONTEND_DOMAIN` | ngrok domain for frontend tunnel |
| `NGROK_BACKEND_DOMAIN` | ngrok domain for backend/agent tunnel |

## Frontend Variables

| Variable | Description | Notes |
|----------|-------------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | **Must** have `VITE_` prefix |
| `VITE_BACKEND_PORT` | Backend port for Vite proxy | Default: `3000` (dev only) |
| `VITE_API_URL` | Full backend URL | Production — direct CORS mode |
| `VITE_BRAND_WORDMARK` | Wordmark shown in the console header | Build time. Default: `f0_csv` |
| `VITE_BRAND_TAGLINE` | Tagline shown with the wordmark | Build time. Default: `continuous security testing` |

### PaaS Frontend Variables

| Variable | Description | Used By |
|----------|-------------|---------|
| `CLERK_PUBLISHABLE_KEY` | Clerk key (without `VITE_` prefix) | `docker-entrypoint.sh` injects as `window.__env__` |
| `BACKEND_HOST` | Backend internal hostname | nginx proxy mode (Standard+ Render) |
| `BACKEND_PORT` | Backend internal port | nginx proxy mode |

## Per-Target Summary

| Variable | Docker | Render | Fly.io | Vercel |
|----------|:------:|:------:|:------:|:------:|
| `CLERK_PUBLISHABLE_KEY` | Yes | Yes | Yes | Yes |
| `CLERK_SECRET_KEY` | Yes | Yes | Yes | Yes |
| `CORS_ORIGIN` | Yes | Yes | Yes | Yes |
| `ENCRYPTION_SECRET` | **Required** | **Required** | **Required** | **Required** |
| `AGENT_SERVER_URL` | Prod | Yes | Yes | Yes |
| `CLI_AUTH_SECRET` | Optional | Yes | Yes | Not used |
| `ELASTICSEARCH_*` | Optional | Optional | Optional | Optional |
| `TESTS_REPO_URL` | Optional | Optional | Optional | Optional |
| `ORGANIZATION_NAME` | Optional | Optional | Optional | Optional |
| `ORG_NAMES` | Optional | Optional | Optional | Optional |
| `CONSOLE_ORG_CODE` | Optional | Optional | Optional | Not supported |
| `CONSOLE_ORG_NAME` | Optional | Optional | Optional | Not supported |
| `CONSOLE_ORG_COLOR` | Optional | Optional | Optional | Not supported |
| `REQUIRE_ORG_ISOLATION` | Optional | Optional | Optional | Optional |
| `TASK_OUTPUT_RETENTION_DAYS`, `AGENT_EVENT_RETENTION_DAYS` | Optional | Optional | Optional | Not used |
| `AGENT_DOWNLOAD_BUDGET_MB_PER_MIN` | Optional | Optional | Optional | Not used |
| `BUILD_NICE`, `BUILD_ENV_PASSTHROUGH` | Optional | Optional (`render.yaml` sets `BUILD_NICE=15`) | Optional | Not used |
| `DEFENDER_*`, `CROWDSTRIKE_*`, `AZURE_*` | Optional | Optional | Optional | Optional |
| `SENTINELONE_*`, `SOPHOS_*` | Optional | Optional | Optional | Not supported |
| `TURSO_*` | — | — | — | **Required** |
| `SIGNING_*_B64` | — | — | — | **Required** |
| `BLOB_READ_WRITE_TOKEN` | — | — | — | Auto |
| `BACKEND_HOST` | Auto | No* | No | — |
| `VITE_API_URL` | — | Yes | Yes | Yes |

\* Render Standard plan supports `BACKEND_HOST`; Starter plan uses `VITE_API_URL` instead.
