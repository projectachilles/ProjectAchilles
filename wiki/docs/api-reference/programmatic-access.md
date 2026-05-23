---
sidebar_position: 2
title: "Programmatic Access Guide"
description: "End-to-end guide for using ProjectAchilles API keys — auth, environment setup, common recipes, alerting integrations, and security best practices."
---

# Programmatic Access Guide

This guide walks you through using ProjectAchilles **API keys** to read and act on data from external applications — dashboards, CI pipelines, SIEM forwarders, monitoring scripts, anything that isn't a browser session.

For an endpoint catalog see the per-module references ([Analytics](./analytics.md), [Agent Admin](./agent-admin.md), [Defender](./defender.md), etc.). This page is the **how-to-actually-use-them** complement.

:::tip Reference vs. guide
- The per-module pages answer *"what does this endpoint do?"* — use them as a lookup.
- This page answers *"how do I build X using these endpoints?"* — read it top-to-bottom the first time, then jump to the cookbook for recipes.
:::

## Prerequisites

- A user account with the `admin` role (only admins can create API keys).
- The ability to reach your deployment's backend (see [Two-host architecture](#2-two-host-architecture-important)).
- `curl` and `jq` for the examples below. The patterns transfer to any HTTP client.

## 1. Create a key

1. Sign in to your ProjectAchilles deployment as an admin.
2. Open **Settings → API Keys**.
3. Click **Generate**, give it a descriptive name (e.g. `splunk-exporter`, `ci-gate`), and choose a scope:
   - **`read`** — all `*:read` permissions. Read analytics, executions, agents, tasks, schedules, test library. Cannot mutate anything. **Pick this by default** — least privilege.
   - **`read-write`** — operator-equivalent. Can create builds, dispatch tasks, manage schedules. **No** destructive actions, **no** user or cert management.
4. **Copy the key immediately.** The full plaintext (a `pa_…` string) is shown exactly once. You cannot retrieve it again — only its short prefix.

API keys cannot create or revoke other API keys — that requires a human admin via the UI.

## 2. Two-host architecture (important)

ProjectAchilles deployments use **two subdomains** per tenant:

| Subdomain | Purpose | Use for API calls? |
|---|---|---|
| `<tenant>.projectachilles.io` | Single-page app (the dashboard you sign into) | **No** |
| `<tenant>.agent.projectachilles.io` | Backend API (Express) | **Yes** |

The SPA reads `VITE_API_URL` from `/env-config.js` at runtime and calls the backend directly via CORS — it never proxies through itself. If you point your client at the SPA host's `/api/*` path, you may hit a vestigial nginx config that returns 502.

If you don't know the backend URL for your deployment, fetch it from the SPA:

```bash
curl -s https://<tenant>.projectachilles.io/env-config.js
# returns: window.__env__ = { VITE_API_URL: "https://<tenant>.agent.projectachilles.io", ... }
```

## 3. Set up your shell

Save the key and base URL once per session:

```bash
export PA_KEY='pa_…'                                          # the full key shown at creation
export BACKEND='https://<tenant>.agent.projectachilles.io/api' # backend host, not SPA host
```

All examples below assume these variables are set.

## 4. Smoke test

A trivial read to confirm the key works and the backend is reachable:

```bash
curl -s -H "Authorization: Bearer $PA_KEY" "$BACKEND/analytics/defense-score" | jq
```

Expected: a JSON object with `score`, `protectedCount`, etc. If you see `score: 0` with `totalExecutions: 0`, see [§5 — the time-window default](#5-the-time-window-default-very-common-gotcha) below.

If the call hangs or returns HTTP 502, your `$BACKEND` is probably pointing at the SPA host — re-check §2.

## 5. The time-window default (very common gotcha)

**Every `/api/analytics/*` endpoint defaults to the last 7 days** when no `from` / `to` is specified. The dashboard UI defaults to **Last 30 days**. Same data, two different windows — so a quiet 7-day stretch can produce zero rows in the API while the UI still shows healthy numbers.

**Always pass `from` (and optionally `to`) explicitly.** Three accepted formats:

```bash
# 1. Date math (relative to now — convenient for cron jobs)
"$BACKEND/analytics/defense-score?from=now-30d"

# 2. Absolute ISO timestamp (reproducible across multiple calls)
FROM=$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)
TO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
"$BACKEND/analytics/defense-score?from=$FROM&to=$TO"

# 3. Calendar dates
"$BACKEND/analytics/defense-score?from=2026-04-01&to=2026-05-01"
```

## 6. Defense Score — what the fields mean

The defense-score response carries three score variants. Each answers a different question:

| Field | Numerator | Risk-acceptance | Use it for |
|---|---|---|---|
| `score` | EDR-protected **OR** Defender-detected | Excluded | Day-to-day dashboard headline |
| `realScore` | EDR-protected **only** | Excluded | Alerting on real EDR coverage regressions |
| `rawScore` | EDR-protected **OR** Defender-detected | **Not** excluded | Auditing for risk-acceptance creep |

Companion counts:

```jsonc
{
  "score": 54.59,            // headline
  "realScore": 53.21,        // EDR-only, risk-adjusted
  "rawScore": 53.83,         // combined, no risk adjustment
  "protectedCount": 1391,    // caught by EDR (strict)
  "detectedCount": 36,       // ONLY Defender caught it (EDR missed)
  "unprotectedCount": 1187,  // neither
  "totalExecutions": 2614,   // = protected + detected + unprotected
  "riskAcceptedCount": 37    // explicitly accepted; excluded from totalExecutions
}
```

Two useful derived metrics:

- **`score − realScore`** = your "Defender lifeline" gap. If this is large, a meaningful chunk of your coverage relies on Defender catching what EDR missed. If Defender ingestion ever breaks, your operational reality is closer to `realScore`.
- **`score − rawScore`** = your "risk-acceptance creep" gap. A growing gap over time means more results are being dismissed via Accept Risk. Worth a periodic audit.

**Recommended alerting:** page on **`realScore`** drops (no masking from either Defender or risk-acceptance — purest signal). Show **`score`** on dashboards. Watch **`rawScore`** drift as a hygiene metric.

## 7. Reading test executions

The platform offers **two different shapes** for test results, and choosing the right one matters:

| Shape | Endpoint | Has | Lacks |
|---|---|---|---|
| **Enriched (analytics)** | `/api/analytics/executions*` | `is_protected`, MITRE techniques, severity, score, Defender flags | `stdout`, `stderr`, timing, binary hash, OS, arch |
| **Raw (admin)** | `/api/agent/admin/tasks*` | `stdout`, `stderr`, `execution_duration_ms`, `binary_sha256`, `os`, `arch` | All catalog/MITRE enrichment, scoring |

### Recent enriched executions

```bash
curl -s -H "Authorization: Bearer $PA_KEY" \
  "$BACKEND/analytics/executions?from=now-7d&limit=10" \
  | jq '.[] | {test_name, hostname, is_protected, timestamp}'
```

### Paginated enriched executions with filters

`/executions/paginated` accepts a long filter vocabulary (see [Analytics](./analytics.md) for the full list). Common filters:

```bash
# All runs of one specific test in the last 30 days, grouped per host+run
TEST_UUID='paste-from-/analytics/executed-test-uuids'
curl -s -H "Authorization: Bearer $PA_KEY" \
  "$BACKEND/analytics/executions/paginated?tests=$TEST_UUID&from=now-30d&pageSize=25" \
  | jq '.groups[] | {host: .representative.hostname, protected: .protectedCount, unprotected: .unprotectedCount, total: .totalCount}'

# Only unprotected results of a specific MITRE technique
curl -s -H "Authorization: Bearer $PA_KEY" \
  "$BACKEND/analytics/executions/paginated?techniques=T1486&result=unprotected&from=now-30d" \
  | jq '.groups[]'

# Critical-severity tests on a specific host
curl -s -H "Authorization: Bearer $PA_KEY" \
  "$BACKEND/analytics/executions/paginated?hostnames=workstation-01&severities=critical&from=now-30d" \
  | jq
```

### Raw task results (stdout, stderr, timing)

Different endpoint, different shape. The agent admin path returns the agent's verbatim `TaskResult` from SQLite:

```bash
curl -s -H "Authorization: Bearer $PA_KEY" "$BACKEND/agent/admin/tasks?limit=5" \
  | jq '.data.tasks[] | {
      id,
      host: .agent_hostname,
      status,
      exit_code: .result.exit_code,
      duration_ms: .result.execution_duration_ms,
      stdout_preview: (.result.stdout // "")[0:200]
    }'
```

Use this path when you need execution-level forensic data — what the binary printed, how long it took, which exact binary ran (verifiable by SHA-256).

## 8. Reading the agent fleet

```bash
# All enrolled agents with current status
curl -s -H "Authorization: Bearer $PA_KEY" "$BACKEND/agent/admin/agents" \
  | jq '.data[] | {id, hostname, status, last_heartbeat_at, os, version}'

# Just the agents that haven't heartbeated in 24h
curl -s -H "Authorization: Bearer $PA_KEY" "$BACKEND/agent/admin/agents" \
  | jq --arg cutoff "$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)" \
       '.data[] | select(.last_heartbeat_at < $cutoff) | {hostname, last_heartbeat_at}'
```

## Cookbook

### Recipe — CI gate that fails on Defense Score regression

Fail a build if `realScore` dropped more than a configured threshold versus the prior 7 days:

```bash
#!/usr/bin/env bash
# defense-score-gate.sh
set -euo pipefail

: "${PA_KEY:?set PA_KEY}"
: "${BACKEND:?set BACKEND}"
THRESHOLD_PP="${THRESHOLD_PP:-5}"  # percentage-point drop that fails the build

PREV=$(curl -fsS -H "Authorization: Bearer $PA_KEY" \
  "$BACKEND/analytics/defense-score?from=now-14d&to=now-7d" | jq -r '.realScore')
NOW=$(curl -fsS -H "Authorization: Bearer $PA_KEY" \
  "$BACKEND/analytics/defense-score?from=now-7d" | jq -r '.realScore')

DROP=$(echo "$PREV - $NOW" | bc -l)
echo "realScore previous=$PREV current=$NOW drop=${DROP}pp threshold=${THRESHOLD_PP}pp"

if (( $(echo "$DROP > $THRESHOLD_PP" | bc -l) )); then
  echo "::error::Defense Score (real) dropped ${DROP}pp — exceeds threshold ${THRESHOLD_PP}pp"
  exit 1
fi
```

Drop this into a GitHub Actions step:

```yaml
- name: ProjectAchilles defense-score gate
  env:
    PA_KEY: ${{ secrets.PROJECTACHILLES_API_KEY }}
    BACKEND: https://<tenant>.agent.projectachilles.io/api
    THRESHOLD_PP: 5
  run: ./scripts/defense-score-gate.sh
```

### Recipe — SIEM exporter (paginate and forward)

Pull all enriched executions for the last hour and forward as NDJSON. Pattern works for Splunk HEC, Elastic ingest pipelines, anything that consumes JSON-per-line:

```bash
#!/usr/bin/env bash
# export-executions-ndjson.sh — emit recent results to stdout as NDJSON
set -euo pipefail

: "${PA_KEY:?}"
: "${BACKEND:?}"
FROM=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)

page=1
while :; do
  body=$(curl -fsS -H "Authorization: Bearer $PA_KEY" \
    "$BACKEND/analytics/executions/paginated?from=$FROM&page=$page&pageSize=100")
  echo "$body" | jq -c '.groups[].members[]'
  has_next=$(echo "$body" | jq -r '.pagination.hasNext')
  [ "$has_next" = "true" ] || break
  page=$((page + 1))
done
```

Run on a cron, pipe to `curl` against your HEC endpoint or `eventgen` etc.

### Recipe — Risk-acceptance creep watcher

Page when `score − rawScore` exceeds a threshold for too many days in a row:

```bash
CREEP=$(curl -fsS -H "Authorization: Bearer $PA_KEY" \
  "$BACKEND/analytics/defense-score?from=now-7d" \
  | jq '.score - .rawScore')
echo "current creep: ${CREEP}pp"
# Alert if > 2pp — too many results are being hand-waved via Accept Risk.
```

### Recipe — Per-host drill-down

For a specific endpoint, list which tests it failed in the last week:

```bash
HOST='workstation-01'
curl -s -H "Authorization: Bearer $PA_KEY" \
  "$BACKEND/analytics/executions/paginated?hostnames=$HOST&result=unprotected&from=now-7d&pageSize=50" \
  | jq -r '.groups[] | "\(.representative.test_name)\t\(.representative.severity)\t\(.unprotectedCount)/\(.totalCount)"'
```

## Rate limits

| Surface | Limit | Notes |
|---|---|---|
| `Bearer pa_…` authentication | 60 attempts / minute per IP | Counts every request bearing such a header, even unauthenticated probes |
| Global `/api/*` | 1000 / 15 minutes per IP | Applies after auth attaches |
| Agent device endpoints (`/api/agent/*`) | Separate (per-agent) limiter | Not relevant for API keys |

A naive polling script at 1 req/s sits right at the API-key auth ceiling. **Drop to one request every 2–3 seconds** for safety, or batch with `pageSize=` to fetch more per call.

## Error handling

| Code | Meaning | Common cause |
|---|---|---|
| `200` | Success | — |
| `201` | Created | POST to `/api/api-keys` (admin-only) |
| `400` | Bad request | Invalid query parameter or body schema |
| `401` | Unauthenticated | Missing / malformed / revoked / expired key |
| `403` | Forbidden | Key valid but lacks the required permission for this endpoint (e.g. `read` key trying to POST) |
| `429` | Rate-limited | Either auth or global limiter; back off |
| `502` | Bad gateway | Backend reachable through wrong host (see §2) or transient infra |
| `503` | Service unavailable | Backend healthy but a downstream (e.g. Elasticsearch) isn't configured or reachable |

**Response envelope** for failures:

```json
{ "success": false, "error": "human-readable message" }
```

Note: a bad / unknown / revoked API key returns **401** without revealing *which* of those it was — the response body is identical for all four cases. This is intentional, to prevent leaking whether a particular key value existed.

## Revocation

Revoke from **Settings → API Keys → Revoke**. The next request bearing the key gets a `401` — there is no cache to invalidate.

```bash
# After revocation in the UI, this prints 401:
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $PA_KEY" "$BACKEND/analytics/defense-score"
```

## Security best practices

- **Pick `read` scope** unless you genuinely need writes. Most automations need only reads.
- **Use a distinct name per consumer.** "Splunk forwarder (prod)", "CI defense-gate", etc. Makes the `last_used_at` audit column meaningful.
- **Never commit a key.** The `pa_` prefix is intentionally chosen to be greppable in git history scanners — but the right answer is not to commit in the first place. Store in a secret manager (GitHub Actions secrets, Vercel env vars, HashiCorp Vault, AWS Secrets Manager, etc.).
- **Rotate keys when staff churn.** A key outlives its creator's tenure — revoke and regenerate when team members leave or roles change.
- **Each deployment has its own keys.** A key created against one environment will not authenticate against another — by design. Don't reuse keys across environments.
- **TLS-only.** Keys are sent in plaintext on every request. Never call the API over plain HTTP.

## See also

- [Overview & Authentication](./overview.md) — full auth model and tier table
- [Analytics Endpoints](./analytics.md) — full parameter reference for `/api/analytics/*`
- [Agent Admin Endpoints](./agent-admin.md) — `/api/agent/admin/*` reference
- [Defender Endpoints](./defender.md) — Microsoft Defender integration analytics
