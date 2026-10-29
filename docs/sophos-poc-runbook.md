# Sophos Central PoC capture runbook

Purpose: capture real, redacted Sophos Central API responses from a proof-of-concept tenant. They become the verbatim test fixtures for the Sophos Intercept X integration, so the shapes (and the fields Achilles correlates on) must be genuine.

The capture script (`backend/scripts/sophos-capture.ts`) is read-only. It makes no write calls: its client runs in `read_only` mode, which refuses every non-GET request locally (apart from the read-only POSTs the API requires: the OAuth token request, GraphQL query documents and starting a REST v1 detections query run). It reads the credential from the environment only and never prints or writes the secret or the access token.

## Credentials and roles

| Step | Sophos Central role |
|------|---------------------|
| All captures in this runbook | **Service Principal Read-Only** |
| Later: dry-run auto-resolve check | Service Principal Management (not used by this script) |

Create the credential in Sophos Central under *Global Settings > Access Control > API Credentials*, and use a **tenant** credential (not a partner or organization one). Keep the secret out of shell history where you can (for example read it from a password manager into the environment for the session).

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

The output folders hold real (redacted) tenant data: `sophos-capture-*/` folders are gitignored, so keep the `sophos-capture-` prefix if you write inside the repository, or pass a path outside it (for example `--out ~/sophos-poc/sophos-capture-1-baseline`). Never commit them.

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

Send the three output folders. Before sending, skim every file for customer-identifying text the redactor may have missed (tenant or company names in free text, internal domains, ticket numbers, person names in unusual fields, URLs). The redactor pseudonymises, consistently across all files: hostnames and FQDNs (including their domain suffix), user names and `DOMAIN\user` pairs, domains, emails, IPv4/IPv6 and colon/dash-separated MAC addresses, Windows SIDs (well-known ones such as `S-1-5-18` are kept), tenant, endpoint and other UUIDs, numeric tenant ids, the `name` of tenants, groups, policies, agents and admins, exclusion and allowed-item paths (standard OS folders and `C:\F0` are kept; other folders become `dir-NNN`), and exclusion/allowed-item comments (replaced entirely). Learned values are also replaced inside free text and object keys. It keeps event types, origins, remedy result codes, ATT&CK ids, timestamps, severities, hashes and file names under `C:\F0` or `/opt/f0`. It can only replace what it can recognise: a name that appears only in free text under an unfamiliar key, or in an unusual format, can survive, so the skim above is still required. If you find something, replace it by hand or tell us so the redactor can be fixed.

The in-memory mapping from real to fake values is never written to disk, so the output cannot be reversed. Do not send the console URL, the credential, or any screenshots of the tenant.
