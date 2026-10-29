# Sophos Central PoC capture runbook

Purpose: capture real, redacted Sophos Central API responses from a proof-of-concept tenant. They become the verbatim test fixtures for the Sophos Intercept X integration, so the shapes (and the fields Achilles correlates on) must be genuine.

The capture script (`backend/scripts/sophos-capture.ts`) is read-only. It makes no write calls: its client runs in `read_only` mode, which refuses every non-GET request locally (apart from the two read-only POSTs the API requires: the OAuth token request and GraphQL query documents). It reads the credential from the environment only and never prints or writes the secret or the access token.

## Credentials and roles

| Step | Sophos Central role |
|------|---------------------|
| All captures in this runbook | **Service Principal Read-Only** |
| Later: dry-run auto-resolve check | Service Principal Management (not used by this script) |

Create the credential in Sophos Central under *Global Settings > API Credentials Management*, and use a **tenant** credential (not a partner or organization one). Keep the secret out of shell history where you can (for example read it from a password manager into the environment for the session).

## Prerequisites

- A PoC Sophos Central tenant with **XDR** enabled (the XDR detections and health check APIs need it).
- A Windows endpoint running Sophos Intercept X, enrolled in that tenant.
- An Achilles agent installed on that endpoint, working from `C:\F0`.
- Node 22 and `npm ci` already run in `backend/`.

## Running the script

Run from the `backend/` directory (that is where `tsx` resolves from):

```bash
cd backend
export SOPHOS_CLIENT_ID='<client-id>'
export SOPHOS_CLIENT_SECRET='<client-secret>'
npx tsx scripts/sophos-capture.ts --out ./sophos-capture-1-baseline
```

`--help` prints usage. `--days <n>` changes the look-back window (default 7, max 90). If either variable is missing the script exits with a usage message and does nothing.

Each run writes one redacted `<endpoint>.json` per call (whoami, alerts, alert-by-id, siem-events, xdr-detection-search, xdr-detection-by-id, detections-v1, health-check, health-history, endpoints, policies, policy-settings, scanning-exclusions, allowed-items) plus `manifest.json` (endpoint to HTTP status and item count). An endpoint that fails (for example XDR not licensed) is recorded in the manifest, not fatal.

## Steps

1. **Capture before any test.** Run the script into `sophos-capture-1-baseline`. This shows what the tenant looks like with no Achilles activity.
2. **Run three things on the Windows endpoint**, from Achilles:
   1. one single-binary Achilles test,
   2. one multi-stage intel-driven test,
   3. one known-blocked sample (for example the EICAR test file, or a test Sophos is known to block).
3. **Wait about 10 minutes** so alerts, SIEM events and XDR detections arrive.
4. **Capture again** into `sophos-capture-2-after-tests`.
5. In Sophos Central, open the **threat-protection policy** applied to that endpoint and set **Deep Learning** to **conservative** (default is the more aggressive setting). Wait for the endpoint to pick up the policy.
6. **Repeat the known-blocked run** (step 2.3), wait about 10 minutes, and capture a third time into `sophos-capture-3-deep-learning-conservative`.

## What to send back

Send the three output folders. Before sending, skim every file for customer-identifying text the redactor may have missed (tenant or company names in free text, internal domains, ticket numbers, person names in unusual fields, URLs). Redaction replaces hostnames, users, domains, emails, IPv4/IPv6 and MAC addresses, tenant/endpoint ids and UUIDs with consistent pseudonyms (`host-001`, `user-001`, `192.0.2.N`, ...). It keeps event types, origins, remedy result codes, ATT&CK ids, timestamps, severities, hashes and file names under `C:\F0` or `/opt/f0`. If you find something, replace it by hand or tell us so the redactor can be fixed.

The in-memory mapping from real to fake values is never written to disk, so the output cannot be reversed. Do not send the console URL, the credential, or any screenshots of the tenant.
