---
sidebar_position: 9
title: "Sophos"
description: "Configure the Sophos Central integration: alerts, SIEM prevention evidence, XDR detections and the Account Health Check, read-only by default, with opt-in auto-resolve."
---

# Sophos

The Sophos integration connects ProjectAchilles to one **Sophos Central** tenant
(Intercept X; Sophos Central is also branded Sophos Fusion) and matches what Sophos saw and did
to each test execution. It pulls three kinds of records into the
`achilles-sophos` Elasticsearch index, in the same alert document shape as the
Defender, CrowdStrike and SentinelOne integrations, so Executions, stage
verdicts, campaigns, notice emails, the execution report and the Defense Score
treat Sophos like any other EDR:

| Source | API | What it gives Achilles |
|--------|-----|------------------------|
| **Common Alerts** | `GET /common/v1/alerts` | One row per Sophos alert (title, severity, host, status). First sync backfills 90 days. |
| **SIEM events** | `GET /siem/v1/events` | Sophos' own automatic response: Core Detection events carry the remedy items (process killed, file deleted) that decide **Prevented**. |
| **XDR detections** | GraphQL `api.taegis.sophos.com` (REST v1 fallback) | Detections with **MITRE ATT&CK techniques**. Needs a Sophos EDR, XDR or MDR licence. |

The posture side comes from the Sophos **Account Health Check**, an endpoint
inventory, the threat-protection policies and the exclusion / allow lists.
Everything appears in the [Analytics → Sophos](../analytics/sophos) tab. The
opt-in write pass is described in
[Sophos Auto-Resolve](./sophos-auto-resolve).

The integration is available on Docker-style backends only. On Vercel
(`backend-serverless/`) `GET /api/capabilities` reports `sophos: false` and
there are no Sophos routes or Settings card.

:::info[One Sophos tenant per Achilles install]
Achilles takes a **tenant** API credential. Partner and organization
credentials (the ones an MSP or an enterprise dashboard use to manage many
tenants) are rejected by **Test Connection** with a message to use a tenant
credential. To cover several Sophos tenants, run one Achilles install per
tenant.
:::

## Create the credential in Sophos Central

1. In Sophos Central open **Global Settings → Access Control → API Credentials**
   (tenant level, not Partner or Enterprise).
2. **Add Credential**, give it a name, and pick the role.
3. Copy the **client ID** and the **client secret** (the secret is shown once). Sophos allows up to 50 credentials per tenant.

| Role | Use it for | Notes |
|------|-----------|-------|
| **Service Principal Read-Only** | Sync, correlation and posture | Everything Achilles reads. This is all you need until you turn on auto-resolve. |
| **Service Principal Management** (or **Super Admin**) | Auto-resolve writes only | Acknowledging alerts and resolving XDR detections needs a role that can act on them. Pair it with **Response** permission mode. |

A **Service Principal Read-Only** credential reads everything the sync and
posture passes need: the tenant identity (`whoami`), Common Alerts, XDR
detections (GraphQL search and by-id, and REST v1), the Health Check and its
history, endpoints, policies and their settings, scanning exclusions and
allowed items. This was confirmed on a live tenant. If a capability still shows
**forbidden** after **Test Connection**, the credential's role is lower than
that; the error names the role needed.

:::note[Write role: pending validation]
Which role can acknowledge alerts and resolve XDR detections is still being
confirmed on a proof-of-concept tenant. Service Principal Management (or Super
Admin) is the expectation; the `403` message in the Sophos tab is the final
word.
:::

## Configure

**Settings → Integrations → Sophos**

| Field | Description |
|-------|-------------|
| Client ID | The Sophos API credential's client ID. |
| Client secret | Stored AES-256-GCM encrypted, never returned or logged. |
| Label | Optional display name (for example "Production tenant"). |
| Permission mode | **Read-only** (default) or **Response**, see below. |
| Polling interval | Minutes between syncs (1-1440, default 5). |
| Initial detection backfill | Days of XDR detections pulled on the first sync (1-90, default 30). Alerts always backfill 90 days. |

- Saving a **new client ID requires its secret**. The saved secret is only ever
  used with the saved client ID.
- **Test Connection** signs in, identifies the tenant and probes each API
  surface once: alerts, SIEM events, XDR detections (GraphQL, then REST v1) and
  the Health Check. It shows the data region and one line per capability.
  `forbidden` means the credential's role is too low; `not licensed` means
  Sophos reported that the feature isn't part of your licence; `unknown`
  means the probe failed for another reason (the error is shown).
- Environment variables `SOPHOS_CLIENT_ID`, `SOPHOS_CLIENT_SECRET`,
  `SOPHOS_PERMISSION_MODE` (`read_only`|`response`) and `SOPHOS_LABEL` can be
  used instead of the UI. While they are set, saving from the UI is refused
  (`POST /api/integrations/sophos` returns 400), because a saved section would
  shadow them. Env-configured installs can't be disconnected from the UI.
- Sophos has no console URL to enter. Achilles asks Sophos which regional API
  host belongs to the tenant, and refuses any host outside Sophos' own
  domains.

:::warning[Multi-tenant installs]
With `REQUIRE_ORG_ISOLATION=true` the Sophos configuration is shared by every
organization, so every write route is **403 from the UI**: saving, deleting,
**Test connection** (with new or stored credentials alike), **Sync Now** and
the auto-resolve mode. Configure Sophos through the `SOPHOS_*` environment
variables there.
:::

:::info[Elasticsearch API key]
With a scoped Elasticsearch API key, this integration needs grants on its own
index and `write` on the results index. Saving checks them and shows a red
**Saved, but not syncing** notice if one is missing. See
[API key privileges for EDR integrations](./elasticsearch.md#edr-api-key-privileges).
:::

## What the tab needs from your licence

| Feature | Needs | Without it |
|---------|-------|------------|
| Alerts, SIEM prevention evidence, Health Check, endpoint health, policies, exclusions | Sophos Central endpoint protection (Intercept X) | Tab sections stay empty; the capability line shows what was refused. |
| **XDR detections** and **ATT&CK techniques** | Sophos EDR, XDR or MDR | Everything else still works. Technique views say **ATT&CK techniques come from Sophos XDR detections**; Sophos rows carry no techniques and Achilles never guesses one from the detection type. |

## Sync behavior

- Every poll runs, in order: Common Alerts, SIEM events, XDR detections, then
  correlation with the Achilles results, the EDR-killed-agent check and
  auto-resolve. The Health Check, endpoint inventory, policies and exclusion
  lists are refreshed every 6 hours.
- Documents are upserted by id, so re-fetches never duplicate, and receipts
  Achilles wrote on an alert survive re-syncs.
- A source's checkpoint advances only after a clean run. A `429`, `5xx` or
  network error pins it and the next poll re-reads the window; a permanent
  per-document error (a mapping problem) is reported but doesn't pin it.
- Changing the client ID resets the checkpoints. **Re-backfill** does so on
  demand, and so does a document-schema change (once, at the next sync).
- `POST /sync` returns **202** and the sync runs in the background.

### The 24-hour SIEM window and the sync-gap warning

Sophos keeps **24 hours** of SIEM events and rejects a start date older than
that. If Achilles hasn't polled for more than about 23 hours (the backend was
down, the credential was revoked, a long outage), it restarts collection at
now minus 23 hours, and the events in between are gone for good. (How Sophos
behaves with an already-expired cursor is pending validation.) Achilles does not hide that: the Sophos tab shows a
**Sophos sync gap** warning with the exact missing period ("Sophos events
between X and Y were not collected; Sophos keeps 24 hours").

The gap stays visible until you reset (**Re-backfill**) or until a clean poll
that is at least 24 hours after the gap was recorded. Common Alerts and XDR
detections keep longer history and are re-read as normal, so only the
**prevention evidence from SIEM events** for that period can be missing: a test
that ran in the gap may show Detected where Sophos actually Prevented it.

### One row per Sophos detection

A blocked test usually produces a SIEM Core Detection event *and* a Common
Alert for the same thing. Achilles shows it as **one** row: the alert is the
row, and the SIEM evidence (remedy items, file path, SHA-256) is merged into it,
even when the two arrive in different polls. A SIEM event with no matching alert
becomes its own row; when its alert arrives later, the row is folded into it and
any link to an Achilles test the row already had moves with it, so auto-resolve
still sees the alert. When the prevention evidence arrives after a test was
already marked **Detected**, Achilles re-checks that test for 24 hours and
upgrades it to **Prevented**. Legacy cleanup events (`Threat::CleanedUp`) never become
rows; they only enrich a detection within 15 minutes of it. XDR detections are
their own rows.

## How Sophos evidence becomes a verdict \{#how-sophos-evidence-becomes-a-verdict}

| Sophos evidence | Achilles verdict |
|-----------------|------------------|
| Core Detection with a **successful remedy** (process killed, file deleted or quarantined) | **Prevented** (Sophos' own automatic response) |
| Blocked before it ran, with no remedy items (for example an AMSI block, a blocklisted file, a prevented exploit) | **Prevented** |
| Legacy `Threat::CleanedUp` within 15 minutes of the detection | **Prevented** |
| Cleanup failed (`FAILED_TO_DELETE`, `Threat::CleanupFailed`) | **Detected** only, shown as "cleanup failed" |
| Remedy item allow-listed or file not found | No prevention evidence |
| An alert or XDR detection with no response evidence | **Detected** |
| **XDR detection** | **Detected** only. Sophos documents detections as activity that was *not* blocked ([Sophos: Detections](https://docs.sophos.com/central/customer/help/en-us/ManageYourProducts/ThreatAnalysisCenter/Detections/)), so they never count as prevented. |

Only Sophos' own immediate response counts. A later analyst action, or anything
Achilles does itself, is never credited as Sophos prevention. Achilles
auto-resolve only acknowledges alerts; it never cleans, quarantines or
allow-lists anything.

## Permission modes

| Mode | Allowed |
|------|---------|
| Read-only | GETs, the sign-in, and read-only GraphQL queries. The API client itself refuses everything else, before it is sent. |
| Response | Read-only plus the two writes of **[auto-resolve](./sophos-auto-resolve)**: acknowledge a Common Alert, and mark an XDR detection `TRUE_POSITIVE_BENIGN`. Both stay off until you enable auto-resolve. |

There are no manual response actions (isolate, scan, clean, allow-list) in this
release, and the client never sends them. Achilles also never reads a
per-endpoint tamper-protection password: tamper state comes from the endpoint
list.

## Rate limit

Sophos allows **100 API requests per minute** per tenant, shared by every
integration on it, including your own SIEM connector. Achilles limits itself to
**50 per minute** (a sliding window) and backs off with jitter on `429` and
`5xx`, so it leaves the other half of the budget to your other tools.

## Health Check and posture

The tab's headline is the **Achilles average of Sophos Health Check scores**:
the mean of the four Health Check categories (protection, policy, exclusions,
tamper protection), each category being the mean of its computer / server (or
global) scores. A category Sophos doesn't return is skipped, never counted as
zero. It is our number built from Sophos' scores, not a Sophos metric.

Sophos keeps 30 days of Health Check history. Achilles imports those 30 days at
the first sync so the trend isn't empty, then stores a snapshot every 6 hours.
The Health Check API returns **counts, not device names** ("2 of 5 servers
not fully protected"); per-device detail comes from the endpoint inventory.

Two posture checks are **critical** because they would exempt every Achilles
test (see [Endpoint Prerequisites](../../deployment/endpoint-prerequisites#sophos-intercept-x)):

- an allowed-items **certificate** entry that matches the active Achilles
  signing certificate (by common name or SHA-256);
- a **folder exclusion** covering `C:\F0` or `/opt/f0`, or a **process
  exclusion** of the agent.

## When the EDR kills the agent

If Sophos ends the agent in the middle of a test, the task fails with `Agent
went offline during execution` or `Task exceeded execution timeout`, and **it
stays a failed task**, on every tenant, with or without XDR. Sophos currently
supplies no evidence for the EDR-killed-agent conversion
([Exit Codes & Outcomes](../analytics/exit-codes-and-outcomes#6-agent-terminated-by-the-edr)):
that check needs one alert with both a prevention action and an ATT&CK technique
overlap. Sophos alerts and SIEM events carry the prevention but no techniques,
and XDR detections carry techniques but never a prevention action, so no Sophos
row qualifies. The check still runs after every Sophos poll; it just finds no
Sophos evidence.

:::note[Follow-up]
Accepting the technique overlap from a same-host XDR detection in the same run
window, next to a Sophos prevention row, would let a Sophos kill count as
**Protected**. That is not implemented yet. Whether Sophos ever terminates the
Achilles agent during a test is also still being checked on a proof-of-concept
tenant; Sophos doesn't document it.
:::

Don't add an agent exclusion in Sophos to stop a kill: see
[Endpoint Prerequisites](../../deployment/endpoint-prerequisites#sophos-intercept-x).

## API

All routes require Clerk auth; reads need `integrations:read`, writes
`integrations:write`, and the analytics routes `analytics:dashboards:read`.

- `/api/integrations/sophos`: settings, connection test, sync (`POST /sync`
  returns **202**; poll `GET /sync/status`), auto-resolve status, mode and
  receipts.
- `/api/analytics/sophos`: alerts, correlation, technique coverage and posture
  (Health Check, endpoint health, policies, exclusion gaps).

See [Sophos API endpoints](../../api-reference/sophos) for every route.
