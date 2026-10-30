# Changelog

All notable changes to ProjectAchilles will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project uses two version streams:
- **Platform** (frontend, backend, backend-serverless): tagged as `vX.Y.Z`
- **Agent** (Go binary): tagged as `agent-vX.Y.Z`

## [Unreleased]

### Added
- **A test an EDR blocks at launch now counts as Protected, when the EDR's own alert proves it.** When CrowdStrike, SentinelOne or Sophos blocks a test binary as it starts (static or ML prevention), Windows refuses to start it and the agent reports exit `260`, which was always inconclusive because Defender ASR produces the same code. After every EDR poll a new pass looks for a prevention alert (quarantined, process killed or blocked) on the same host that names the run's own task folder (`C:\F0\tasks\task-<task id>-<n>\`) or the test's `<uuid>.exe` within the correlation window, and rewrites that `260` result in place as `126` Protected, credited to the EDR, with the original code and the proving alerts kept in `f0rtika.launch_block`. Defender alerts never count (an ASR prevalence block is exactly what `260` is for). It counts in the Defense Score for the test but never for a technique (technique coverage, ATT&CK matrix, report technique/tactic counts, vendor detection rate and overlap all leave it out), multi-stage tests join their bundle pair, and chain depth counts them as blocked at stage 1. Executions shows "Blocked before it ran by <EDR>" with the proving alerts, campaign evidence names the EDR, and the proving alerts are linked to the test so auto-resolve can resolve them. An alert proves at most one run: it gets a receipt naming that run, and an alert that only names the binary never goes to a `260` run when another run of the test on that host is as near. Results from the last 90 days are reconciled after the upgrade. These whole-test results are not in the SB-PC-2026-001 export, which reads only per-control stage documents. Known limitations: the Tasks page (rows and 7-day tiles) keeps the agent's raw result (Not run), and a Finished email sent before the next EDR poll still shows the run as not run (there is no Finished-email hold for `260`). Backend-only: `backend-serverless/` is unchanged.
- **EDR integrations check their Elasticsearch access on Save and Test.** Saving Defender, CrowdStrike, SentinelOne or Sophos now checks the Elasticsearch API key and creates the integration's indices before it reports the result. If the key is missing a grant, the integration is still saved and its Settings card shows a red **Saved, but not syncing** notice naming each missing privilege and index (including `write` on the results index, which the verdict flags need). The notice re-checks once a minute and clears on its own once the key is fixed. **Test Connection** runs the same check read-only; env-var credentials are checked at startup. Previously a key without the grants saved fine and the sync failed silently in the background. New `GET /api/integrations/edr/:vendor/elasticsearch`; save responses gain an `elasticsearch` field.
- **Sophos Central integration.** Connect one Sophos tenant credential (Service Principal Read-Only for sync and posture; Service Principal Management or Super Admin only for auto-resolve writes) and Sophos counts everywhere the other EDRs do: Executions, stage verdicts, campaigns evidence, notice emails, the execution report, SB export and the Defense Score. Sources: Common Alerts (90-day first backfill), SIEM events (Sophos keeps 24 hours, so a gap shows a warning with the exact missing period), and XDR detections over GraphQL with a REST v1 fallback (the only source of ATT&CK techniques; tenants without XDR still get alerts, SIEM prevention evidence and posture). One row per Sophos detection; Prevented means Sophos' own automatic response (remedy items, legacy cleanup within 15 minutes), a failed cleanup or an XDR detection is detected only. The Sophos Analytics tab shows the Achilles average of the Sophos Health Check scores (30 days of history imported, then a snapshot every 6 hours), endpoint health, policy deviations, and critical findings when a Sophos allow-list entry matches the Achilles signing certificate or an exclusion covers `C:\F0` / `/opt/f0` or the agent. Opt-in auto-resolve (dry run, then on) acknowledges matched alerts and resolves matched XDR detections as `TRUE_POSITIVE_BENIGN` after re-checking Sophos, never sending clean, allow-list or isolation actions. Achilles stays within 50 of the tenant's 100 requests per minute. Backend-only (`GET /api/capabilities` reports `sophos: false` on Vercel). With `REQUIRE_ORG_ISOLATION=true` every Sophos write route is 403 from the UI; use `SOPHOS_CLIENT_ID`, `SOPHOS_CLIENT_SECRET`, `SOPHOS_PERMISSION_MODE` and `SOPHOS_LABEL`.
- **Endpoint Prerequisites: Sophos install fails behind TLS inspection.** A troubleshooting item for a Sophos Central installer that exits `1` within seconds with `PrecheckFailed` after an SSL certificate validation error: a firewall's SSL/TLS inspection re-signs Sophos traffic, and Sophos pins its own chain. Exempt the Sophos domains from TLS inspection (not just allow-list them) and keep the exemption, since the endpoint reports over the same connections.
- **CrowdStrike Falcon section in the Endpoint Prerequisites guide:** add nothing by default; a Falcon block of a test binary (exit `260`, Machine Learning detection on the test) is a result, not a reason for an exclusion. Only if Falcon convicts the agent file itself: one exact-file ML exclusion for the agent (detections and preventions only, Achilles host groups only) or an IOC Allow by SHA-256 per agent version, with a list of exclusions (sensor visibility, certificate, `C:\F0` folder, agent as parent) that would exempt every test. Unverified Falcon behaviour is marked pending validation.
- **Sophos Intercept X section in the Endpoint Prerequisites guide:** add nothing by default; allow the agent by SHA-256 (never by certificate) only if Sophos convicts the agent file, with a list of exclusions and allows that would exempt every test. Statements about Sophos runtime behaviour are marked pending validation.
- **SentinelOne section in the Endpoint Prerequisites guide:** add no SentinelOne exclusion of any kind for ProjectAchilles. SentinelOne applies a path exclusion to every threat group rooted at the excluded file, and every test's process tree starts at the agent, so even an exact-file Suppress Alerts exclusion on the agent would exempt the tests; certificate, hash and `C:\F0` exclusions are ruled out too. The section explains what a SentinelOne kill of the agent looks like (agent restarts, run recorded as Protected with stages unknown once the alert syncs), the recommended policy set-up, and troubleshooting. Unverified SentinelOne behaviour is marked pending validation.
- **Endpoint Prerequisites guide.** A new wiki page (Deployment → Endpoint Prerequisites) collects what an organization sets up on Windows endpoints before the first test: the code-signing certificate and how to get its public part onto endpoints (Intune or GPO), the per-rule Defender ASR exclusion for `C:\F0` (prevalence rule `01443614` only), the `C:\F0` folder lock it relies on, WDAC/AppLocker publisher rules, EDR expectations, and a pilot verification checklist. It also states plainly what code signing does and doesn't get past.

### Changed
- **The SB-PC-2026-001 export lists every technique a stage executes, and the alert techniques next to them.** `techniques` now holds the result's own technique plus every technique the test library declares for that stage in its info card heading (`### Stage 1 — … (T1059.001, T1562.001, T1112)`), so the LockBit export meets the bulletin's per-objective minimums (two techniques for objectives 1 and 2, T1486 plus one recovery-inhibition technique for objective 5). The list is read from the library when the export is generated, so past runs get it too; a test without the heading keeps its single technique. A new additional field, `detectedTechniques`, lists the ATT&CK techniques on the alerts that named the stage's own binary, for each EDR that detected that stage (the bulletin accepts additional fields and doesn't evaluate them). The library's Browser metadata gains `stages[].techniques`.
- **Launch-blocked runs explain their result code.** A run Achilles changed from the agent's 260 to 126 because an EDR's own alert proved the block now says so under the result code ("Agent reported 260 (BlockedPreExecution); set to 126 by the EDR's alert"), and its evidence lists the alert itself (severity, action, title, time and console link) instead of the raw alert id once the run's alerts are loaded.
- **Exit 260 is described as "blocked before execution by an EDR/AV or app control"**, not as an ASR block only, in the console, campaign and email reasons and the agent's own result text (the agent wording ships with the next agent release).
- **The recommended ASR exclusion is now the `C:\F0` folder, for rule `01443614` only**, replacing the agent-binary-only exclusion. No certificate satisfies that rule, so it blocked every test as well as agent updates; the folder lock in agent 0.7.1 and the bootstrap script makes the folder exclusion safe. Docs and the agent's exit-260 / update-rollback hints now say so.

### Security
- **SentinelOne client no longer follows HTTP redirects, and a changed console URL no longer reuses the saved API token.** Requests to the console now use `redirect: 'manual'`; a 3xx is an error, so the `Authorization: ApiToken` header can't be replayed to a host outside the `*.sentinelone.net` / `*.s1gov.net` allowlist and SSRF check (the `Location` value is not echoed). Error bodies are redacted of the token before truncation. Saving settings with a different `base_url` and no new `api_token` now returns `400` (enforced in both the route and the settings service), matching Test Connection.
- **Some test-library tests installed an unconstrained "F0RT1KA Security Testing Framework" root CA into `LocalMachine\Root`** on the endpoints where they ran (thumbprint `CAE0B62C1BEB703F5A2C34BC841E806D6AC8F3B4`). The install code has been removed from the test library; the Endpoint Prerequisites page explains how to find and remove the root across a fleet.
- **The Windows enrollment command refuses a `C:\F0` that a non-administrator created, and locks it before downloading the agent.** Any signed-in user can create `C:\F0`; as its owner they could swap the agent binary between the download and `--install`, and the service would run theirs as SYSTEM. The command (one script block that stops at the first error) now: refuses an existing `C:\F0` that is a link or not owned by SYSTEM/Administrators; sets owner Administrators and the agent's SID-based lock; refuses links or foreign-owned items directly inside; deletes any old binary so the download is a new file inheriting the lock. **With the next agent release** `--install` does the same before enrolling (refuses a foreign-owned `C:\F0` or non-root `/opt/f0`, locks, re-checks the owner, and fails instead of warning), rewrites a binary in place that has an untrusted owner, and sets the installed binary's owner to Administrators.

### Fixed
- **The SB-PC-2026-001 export no longer reports a stage as DETECTED because another stage of the run was.** It counted the run-wide `<vendor>_detected` flag, which every stage of a run carries once any alert names the run, so an exfiltration stage that the console showed as Unprotected could be exported as DETECTED instead of EXPOSED. DETECTED (and Defender's `preventedBy` credit) now needs the stage's own `<vendor>_stage_detected` flag, the rule Analytics already uses. Backend-only: the `backend-serverless/` export is unchanged.
- **EDR launch blocks: the evidence search failed on a live cluster.** The pass that turns an EDR-confirmed exit-260 launch block into Protected sent Elasticsearch a file-name pattern with a leading `*` before 32 single-character wildcards; Elasticsearch 8 refuses to build it ("Determinizing automaton … more than 10000 effort"), so every pass logged `search_phase_execution_exception` for each EDR and resolved nothing. The pattern no longer starts with `*` (evidence file names are bare names).
- **Sophos: one row per block when Sophos reports it through XDR and SIEM.** When Sophos blocked a file a test stage dropped, the Sophos tab listed the same block two or three times: the XDR detection (for example `Tailcat: File activity blocked (C:\F0\tailcat.exe)`) and one or two SIEM events for that file (`PUA cleaned up: 'Tailcat' at 'C:\F0\tailcat.exe'`). A SIEM event that matches no Common Alert is now folded into the XDR detection on the same host when every file path it names is in the detection's evidence and the two are within 5 minutes (live gaps were up to about 2 minutes). The XDR row keeps its ATT&CK techniques and stage process and gains the SIEM event ids and Sophos' remedy (prevention within the 15-minute rule), whichever arrives first and across polls; the SIEM row is deleted, and a link to an Achilles test it already had moves to the XDR row so auto-resolve still sees it. A Common Alert match keeps priority, and two XDR detections never merge. Rows synced earlier fold when their XDR detection is re-read; run **Re-backfill** to fold older ones.
- **Agents are always installed in `C:\F0` (Windows) or `/opt/f0` (Linux, macOS).** The Windows command in **Agents → Enrollment** downloaded the agent into PowerShell's current folder, and an elevated PowerShell starts in `C:\Windows\System32`, so the service could run from there: outside the per-rule ASR exclusion, the `C:\F0` folder lock and every exact-path EDR rule. The generated commands now download straight into `C:\F0\achilles-agent.exe` / `/opt/f0/achilles-agent` and run `--install` from there (Linux and macOS run every step with `sudo`). **Ships with the next agent release:** `--install` copies the agent into that folder (verified by SHA-256, the previous binary restored if the swap fails, nothing registered if the copy fails) and registers the service from there; `--install` on its own re-registers an enrolled agent without re-enrolling it; the agent logs a warning at startup when it runs from anywhere else. It never moves itself; Endpoint Prerequisites → *Agent outside C:\F0* explains how to fix existing endpoints. On Linux a re-install now restarts the service and on macOS unloads it first, so the new binary takes over.
- **Sophos: tests now match XDR detections that Sophos completes after creating them, and Sophos gets credit for its own blocks.** Sophos adds the process that wrote a blocked file to an XDR detection a few minutes after creating it; a poll in between stored a copy naming only the dropped tool, which never matched its test stage. XDR detections are now re-read for 30 minutes. XDR "<threat>: File activity blocked (…)" and "Cleanup succeeded: File cleanup result: Success (…)" now count as Sophos prevention (`blocked` / `quarantined`), so the SB-PC-2026-001 export credits Sophos for those stages. XDR entities `processImagePath` and `programName` are read too. Run **Re-backfill** once to refresh detections stored earlier.

## [2.7.0] - 2026-10-27

### Added
- **Windows Hyper-V appliance — a new deployment target.** A prebuilt, sealed Ubuntu VM image (Packer-built, boot-tested in CI) that boots to a console wizard — keyboard, admin password, network — via `achilles-installer firstboot`, with a login menu, console banner, and root-filesystem auto-grow. `Import-Achilles.ps1` verifies the download against its published checksum and imports, creates and starts the VM on a Hyper-V host. Each release's image is published to Cloudflare R2, with `appliance-SHA256SUMS` and `Import-Achilles.ps1` attached to the GitHub release. User guide: Deployment → Appliance.
- **EDR-killed agent runs count as protected.** When a connected EDR terminates a test mid-execution, that run is recorded as a whole-test Protected result (reconciled after each EDR sync), scored in its bundle pair and chain depth, kept out of technique-coverage views, shown in the UI as protected with stages unknown, and reflected in campaigns and Finished emails. Implemented across the backend, analytics, frontend, reports, and the serverless fork.

### Fixed
- **Analytics were empty on a fresh install.** The results index is now created with its field mapping, so aggregations (defense scores, heatmaps, treemaps) work on a brand-new deployment. (#605)
- **A stage an EDR blocked with an error code** is credited as prevented/detected rather than counted as an error. (#606)
- Numerous appliance and installer robustness fixes: sealed-image verification fails closed, first-boot draws reliably on tty1 and recovers without DHCP, restore works onto a server that was never installed, and the image version is stamped from platform tags only.

## Agent [0.7.1] - 2026-10-27

### Security
- **Test binaries and updates can no longer be swapped by a local user on Windows.** The agent never locked its own folder. Created under `C:\`, `C:\F0` inherits *Modify* for every signed-in user, and the agent downloads test binaries into `C:\F0\tasks`, checks their SHA256 and then runs them as SYSTEM (the updater stages new binaries in `C:\F0` too), so a local user could replace a file after the check and get code run as SYSTEM. At every startup the agent now locks the folder the way `bootstrap-windows.ps1` does (owner Administrators; SYSTEM and Administrators only, by well-known SID; inherited by the work dir and everything in it). It only does this in the standard layout (work dir directly inside the folder holding the binary) and never on a junction; otherwise it logs a warning. Endpoints enrolled with `bootstrap-windows.ps1` or with `C:\F0` locked by GPO were not exposed.
- **Agent files are locked down on non-English Windows.** The agent restricted its config (agent key, server URL) and binary with `icacls` using English account names; on localized Windows (e.g. Spanish `BUILTIN\Administradores`) `icacls` failed (exit 1332), changed nothing and only logged a warning, so both kept their inherited ACL. The agent now uses well-known SIDs and re-locks the config at every startup. (#607)

Both fixes apply on the first start after updating; no re-enrollment needed.

### Fixed
- **Windows test binaries without `.exe` are launchable.** A legacy `binary_name` lacking `.exe` gets one appended on Windows (complements the per-OS dispatch in platform 2.3.1). (#544)

## [2.6.1] - 2026-10-26

### Fixed

- **SentinelOne Endpoint Protection score stuck at 0% on laptop fleets** (#597). Two of its checks failed every agent for reasons that aren't protection gaps. *Reporting* used SentinelOne's live online flag, so a snapshot taken while laptops were closed failed all of them, although an offline agent keeps protecting its endpoint. It is now **Checked in (7 days)**: online, or last checked in within 7 days. *Firewall control* failed every agent on consoles without SentinelOne Firewall Control (a separate license); when no agent has it on, the check is now skipped as not deployed. Agent snapshots now also keep each agent's last check-in time.

### Documentation

- **Server Installer: trusting the on-prem root CA** (#596). The trust section and the GPO steps now say plainly that without the root in `LocalMachine\Root` agents can't enroll (`x509: certificate signed by unknown authority`), what the GPO changes in the domain (one certificate, nothing else), and how to roll it out: a dedicated GPO under Computer Configuration, piloted on one OU, with how to undo it and which ASR, PowerShell, AppLocker/WDAC and firewall policies still apply. Adds a troubleshooting row for the enrollment `x509` error.

## [2.6.0] - 2026-10-25

### Added

- **SentinelOne integration** (#566, contributed by Max Garcia and Joan Cruz). Pulls threats and detection alerts from the SentinelOne Management API v2.1 (read-only by default) and matches them to test executions, so SentinelOne counts in Analytics, the Defense Score, campaign evidence and pre-execution notice emails. Adds a SentinelOne Analytics tab, a 6-hourly posture pass (policies, agent health, exclusion gaps), optional auto-resolve of test-matched incidents, and optional automatic mitigation (off by default: kills or quarantines test threats SentinelOne left unmitigated, audited, and never counted as SentinelOne prevention). Docker, Render and Fly.io backends; hidden on Vercel. Docs: wiki User Guide → Integrations → SentinelOne.
- **SentinelOne Endpoint Protection score** (#594). SentinelOne has no posture score like Defender's Secure Score or CrowdStrike's Zero Trust Assessment, so Achilles computes one every 6 hours from the posture pass: the share of agents that pass seven checks (reporting, Protect mode, agent up to date, no active threat, anti-tamper on in the effective policy, firewall control on, disk encrypted). It leads the SentinelOne Analytics tab with its three weakest checks and a trend, and is the posture series in the Defense Score comparison. API: `GET /api/analytics/sentinelone/posture/protection-score`. A check the console doesn't report is skipped, not failed. Firewall Control needs its own SentinelOne license; without it that check fails on every agent.
- **Auto-resolve tile on the SentinelOne tab** (#591), as on the Defender and CrowdStrike tabs: the mode, incidents resolved in the last 24 hours / 7 / 30 days, and a warning when auto-resolve is enabled with a read-only API token.

### Changed

- **EDR integration settings are deployment-wide.** Defender, CrowdStrike and SentinelOne settings were saved under the admin's Clerk org, but sync, enrichment and auto-resolve read only the deployment-wide settings, so with an active org the saved credentials never synced and the toggles never took effect. They are now one deployment-wide configuration, as on Vercel. Alerts, pre-execution notices and Azure stay per org.
- **Multi-tenant: shared EDR settings are read-only from the UI.** With `REQUIRE_ORG_ISOLATION=true`, saving or deleting EDR settings, changing the auto-resolve mode, SentinelOne automatic mitigation and re-backfill return 403, so one tenant's admin can't change what runs for every tenant. Use the `DEFENDER_*`, `CROWDSTRIKE_*` and `SENTINELONE_*` environment variables there.
- **backend-serverless:** `@vercel/node` 13 → 15 (the Vercel build runtime).

### Fixed

- **Integration settings survive a corrupt `integrations.json`.** When the file couldn't be parsed (a truncated write, a hand edit), the next settings write, including the 5-minute Defender and CrowdStrike sync timestamps, replaced the whole file and dropped every other integration's credentials and the pre-execution notice settings. Writers now refuse to overwrite a file they can't read.
- **Alert drawers:** Defender, CrowdStrike and SentinelOne alert details no longer say "Auto-resolved by Achilles" for dry runs or for alerts the auto-resolve pass skipped.
- **Vercel:** the Alerts & Notifications settings card and the top-bar bell's alert calls are hidden; the serverless backend has no alerting, and every call returned 404.
- **Settings → Users:** removing a role now says the user becomes read-only; the option read "No role (full access)".
- **installer:** `status`, `upgrade`, `backup` and `restore` now refuse to run without root and print the `sudo` command to use. Before, `status` as a normal user reported a healthy install as broken (`Containers unavailable`, `no AchillesDomain in deploy.config.env`), because the configuration files and the Docker socket are root-only. The wizard's Done screen now shows the commands as `sudo ./achilles-installer …`.
- **installer:** the preflight no longer warns on a fresh server because Docker isn't installed yet (the install adds it). It now warns only when Docker is installed but its daemon isn't answering, which would make the install fail.

### Security

- **AES-GCM tag length pinned** for pending agent API keys (both backends). This decrypt didn't fix the tag length, so a truncated 4-byte tag authenticated (2^32 forgery work instead of 2^128). It now requires 16 bytes, like the other GCM decrypts.
- **SentinelOne console URL rebuilt from validated parts**, so nothing in the configured URL can change the host server-side requests go to.
- **Code scanning is real again.** Semgrep had been scanning 0 files while reporting no findings; it now runs (0 findings across 701 files, `backend-serverless` included), and fork PRs get CodeQL, Semgrep and Claude reviews.
- **Slack webhooks only go to Slack** (#592). Threshold alerts, pre-execution notices and the Test button posted to whatever webhook URL was saved, so an admin could point the server at any public host. Webhook URLs must now be `https://hooks.slack.com/services/…` or `https://hooks.slack.com/workflows/…`: other URLs are rejected when saved and never contacted, and Slack redirects aren't followed. (CodeQL js/request-forgery)
- **Test build file names** use only the base name of the test UUID, so a crafted UUID can't place the signed binary outside the build directory (#592; CodeQL js/path-injection).
- **Dependencies** (#593): `zod` 4.6.7 in the CLI ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high: memory exhaustion validating oversized collections) and `serialize-javascript` 7.1.3 in the wiki build ([GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v), low).

### Upgrade notes

- **EDR settings saved under an org** were never synced, and still aren't. At startup the backend now logs a warning for each one: re-enter those credentials once in Settings → Integrations, where they are saved deployment-wide. They aren't migrated automatically.
- **Slack webhook URLs that aren't `hooks.slack.com`** (a relay or proxy) stop receiving alerts and notices, and **Test Channels** reports the URL as invalid. Enter a Slack incoming-webhook or workflow URL in Settings → Integrations → Alerts & Notifications.

### Documentation

- **Clerk secret key.** The Clerk Setup guide now says to create a new secret key (**Add new key** → **Copy key and close**): Clerk shows a key in full only when it's created, and selecting an existing one can open the paid IP-allowlist dialog instead of copying it.
- **Wiki callouts render again.** Since the Docusaurus 3.10.2 upgrade, every titled callout (`:::warning Title`, 160 on 61 pages) showed as raw text; they now use the `:::warning[Title]` syntax.
- **Clerk Setup guide.** A new wiki page, Deployment → Clerk Setup, walks through the Clerk Dashboard with screenshots: create the app, copy the keys, the session token claim, Invite-only sign-ups, the first admin, and the production instance (text). Prerequisites now summarises it, and every deployment guide links to it.
- **Clerk roles in every deployment guide.** The session token claim (`{"metadata": "{{user.public_metadata}}"}`), the first admin's `{"role": "admin"}` and an invite-only sign-up mode are now one section in the wiki's Prerequisites, and every deployment guide (Docker Compose, Server Installer, Public and On-Prem Server, Fly.io, Render, Railway, Vercel, the production checklists) points to it. Before, only the Server Installer and local quick start mentioned them.
- **Server Installer page for on-prem and cloud.** The wiki page moved to `deployment/server-installer` and comes first among the server guides; sections are shared or marked *On-prem LAN* / *Cloud server* instead of cloud being appended at the end. The full reference is now `docs/deployment/SERVER_INSTALLER.md` (`ON_PREM_LAN.md` points to it).
- **Alert feed docs.** The CrowdStrike and Defender Analytics pages no longer say that feed rows and the alerts tile open the alert drawer: a row's link icon opens the alert in the console, and the tile scrolls to the feed.

## [2.5.0] - 2026-10-24

### Added

- **Installer on cloud servers.** `achilles-installer` now recognises a public IP on the chosen interface (DigitalOcean, Hetzner) and offers **Let's Encrypt HTTP-01** (`TLS_MODE=acme-http`), recommended there. It skips the LAN-subnets question, asks for the A record at your DNS provider instead of in AD DNS, and explains the DNS mismatch behind 1:1 NAT (AWS, Azure, Google Cloud). HTTP-01 is also offered on a LAN for names under a public domain. Ubuntu 26.04 LTS passes preflight. Guide: `docs/deployment/ON_PREM_LAN.md` section 15.
- **Installer: first admin.** The Login screen asks for the first admin's email (`ADMIN_EMAIL`, optional). After the install, the installer invites that address through the Clerk API with the admin role, or adds the role to an existing account; a re-run doesn't send the email again. Without it, the Done screen gives the manual steps. Guide: `docs/deployment/ON_PREM_LAN.md` section 4.1.

### Fixed

- **Roles without the Clerk session token claim.** The backend read roles only from the session token's `metadata` claim, which a new Clerk instance doesn't have until someone customises its session token in the dashboard (Clerk has no API for it). Until then every admin action returned 403 "Insufficient permissions" while the UI showed the user as admin. The backend now looks the role up in Clerk when the token has no `metadata` claim (cached for a minute per user). Only browser sessions get this lookup: Clerk API keys and OAuth tokens stay read-only, as before. The claim is still recommended. Docker and Vercel backends.
- **Demo data in Analytics → All Executions.** The seeded results index was created without the results mapping, so the Executions table showed "0 groups (N documents)" while the dashboards had data. The seed now maps the index it writes to, and no longer adds another 1000 results each time the installer (or `deploy-server.sh`) runs again. Existing installs: see Troubleshooting in `docs/deployment/ON_PREM_LAN.md`.
- **Installer Done screen.** The agent enroll command no longer wraps in the middle of `--server` on narrow terminals.

## [2.4.0] - 2026-10-24

### Upgrade notes

- **Rebuild cross-platform tests.** Dispatch now picks each agent's binary by OS from a per-OS map in `build-meta.json`. A test built before this release has no map and keeps the old single-binary behaviour until it is rebuilt (#544).
- **New tables are created on startup.** `campaigns`, `campaign_runs` and `run_notices`, plus nullable `tasks.notice_id` and `tasks.campaign_run_id` columns, are added automatically when the backend starts. The change is additive; existing data is untouched.
- **Threshold alerts saved from the UI start firing.** Before #546 the email and Slack channels configured in the UI were never marked configured, so alerts silently never went out. After upgrading, tenants with alerts set up in the UI will begin receiving them.
- **Pre-execution notices are off by default.** Before enabling them, confirm **Test Channels** in Settings → Integrations → Alerts & Notifications succeeds from the server: an outbound firewall that blocks the SMTP port holds every test run until the max wait, then marks it "Not run".
- **"Started by" names**: campaign runs and notice emails look the user up in Clerk, so no session-token change is needed. Campaign runs started before this release show the name when displayed.
- **Campaign CSV**: `stages` and `edr` columns are appended at the end, and `outcome` gains `prevented` and `detected`. Parsers that read by column position keep working.
- Campaigns and pre-execution notices are backend-only; the Vercel (`backend-serverless/`) deployment hides them.

### Highlights

- **Security test campaigns**: save a set of tests × hosts, run it with one click, and get an evidence page (matrix, % protected, notice record, CSV, print) that uses the same outcome labels as Analytics (#549, #554).
- **Pre-execution notices**: email the security engineers before every test run and hold the tests until the mail server accepts the notice, so the SOC knows the activity is a test (#545, #547, #553, #555, #556).
- **Scheduler fixes**: viewing schedules no longer skips most scheduled runs, and randomized schedules no longer run twice on the same day (#548).

### Added

#### Campaigns
- **Campaigns** (`/campaigns`, `/api/campaigns/*`): saved, org-scoped test plans of up to 100 tests and a set of agents, with a preflight check that lists pairs that can't run, an explicit "Run the rest" for partial runs, and one transaction for the whole launch (#549)
- **Evidence page**: tests × hosts matrix with the Analytics outcome labels (Protected, Prevented, Detected, Unprotected, Error, Not run, N/A), a reason for every cell, per-stage results on hover, per-host and per-test totals, the notice record, "started by", an as-of time, CSV export and a print layout (#549, #554)
- **Immutable run snapshots** and a run history per campaign plus an All runs view that keeps runs of deleted campaigns (#549)

#### Pre-execution notices
- **Notice email before every test run** (Run Now, retry, schedules, campaigns), with a lead time of 0–5 minutes after the mail server accepts it, a bounded wait, a pickup window, an ICS calendar file, a CSV of hosts past 50, and an optional Finished email (#545)
- **Delivery failures are loud**: retries with backoff, a console banner, Slack alert, and "Not run: notice not delivered" when the max wait runs out (#545)
- **Per-organization settings** with fallback to the deployment-wide settings (#545)
- **Email content**: header `ProjectAchilles | f0_csv`, the triggering user's name and email, tests with UUID and stage count (or a bundle's control count), column headers, and a "Finding this activity in your security tools" section that names the test UUIDs and task folders (#553, #556)
- **Release without notice from the UI**: Settings → Integrations → Pre-execution notices lists runs whose tests are held and releases one with a recorded reason; `GET /api/notices?state=` (#556)

### Changed

- **Campaign % protected** counts Prevented and Detected as protected, the Defense Score's basis (#554)
- **Finished email** counts outcomes with the same labels as Analytics, including EDR prevention and detection (#555)
- **Campaign matrix** puts the longer list (usually hosts) down the side, with a sticky first column and header (#554)
- **Notice badge** reads "Sending notice…" while the email is being delivered (#550)

### Fixed

- **Schedules skipped most runs while a page was open**: listing or viewing schedules advanced an overdue `next_run_at` before the scheduler could fire it (#548)
- **Randomized schedules could run twice on the same day** (#548)
- **Late per-machine runs expired as "host offline"** when they joined a day notice that had already closed; they now get their own notice (#547)
- **Alert channels configured in the UI never sent** because their `configured` flag was never set (#546)
- **Alerts Test Channels failed after reopening the dialog** ("Missing credentials for PLAIN"); saved credentials are now reused while the SMTP host is unchanged (#551)
- **Campaign print added a blank page** and clipped wide matrices (#554)
- **Campaign "Started by"** showed a raw user ID (#554)
- **The calendar file told the SOC to search for the run tag**, which never reaches the hosts (#556)
- **Cross-platform tests sent the Linux binary to Windows agents**, which failed at once with exit -1 "executable file not found in %PATH%". Each agent now gets the binary built for its OS, and an agent whose OS was not built fails the dispatch with a 422 (#544)

#### Installer and deployment
- **Server installs pin their compose project name** in the root `.env` (`COMPOSE_PROJECT_NAME`). Compose used the checkout's directory name, so an install in `/opt/projectachilles` and a dev clone also called `projectachilles` shared one project: `up` recreated the other stack's containers and mounted its volumes. New installs use `achilles-server`; existing installs keep the name they already run under, so no data moves. The engine refuses to start when another checkout's containers use the name, and `restore` keeps the live project name instead of the backup's (#558)

### Security

- **Pre-execution notices could silently switch off**: one undecryptable credential in `integrations.json` made the notice setting read as disabled, so tests ran unannounced. The gate now reads its section without decryption and keeps the last good settings if the file is unreadable (#556)
- **Re-saving the Alerts dialog overwrote the stored SMTP username with its masked value**, which would break alert and notice emails; masked values are now ignored (#551)
- **Test Channels can't send the stored SMTP password to another host**: saved credentials are reused only when the host matches the saved one (#551)
- **Cross-platform builds whose primary OS was Linux shipped an unsigned Windows binary**; the signing certificate is now passed whenever Windows is a target (#544)
- Closed CodeQL `js/path-injection` findings on the per-OS build paths (#544)
- **Dependency advisories patched**: body-parser 1.20.9 (GHSA-27r3-jxmh-p828) and multer 2.5.0 (GHSA-q7qp-rjg7-q26m), both request-reachable denial of service in the backend, plus undici 6.29.1 (GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685) and zod 4.6.7 (GHSA-mrhx-c7xc-m3w5) (#560)

### Documentation

- Run Command tasks are not covered by pre-execution notices; the guide says so (#552)

### Agent

- No new agent release. The agent source now appends `.exe` to an extension-less test binary on Windows (#544); it ships with the next agent release. Agents 0.7.0 are already covered by the server-side dispatch fix.

## [2.3.1] - 2026-10-22

Security patch. The 2.3.0 backend image ran Node.js 22.22.2, which is affected by the [October 21, 2026 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). This release moves the Docker images to Node.js 22.23.4 and picks up the month's minor/patch dependency updates, including a critical Next.js fix for the blog. There are no application code changes.

### Upgrade notes

- **Rebuild your images.** The Node.js version comes from the digest-pinned Dockerfile, so a restart or `docker compose pull` alone keeps the old runtime:
  - Docker Compose: `git pull && docker compose build --pull && docker compose up -d`
  - Server installs: re-run `./scripts/deploy-server.sh`, or `achilles-installer upgrade` on LAN installs
  - Render and Fly.io redeploy from `main` automatically
- **Native (non-Docker) installs** run the host's Node.js and need it upgraded separately, e.g. `apt-get install --only-upgrade nodejs` for NodeSource installs, then a backend restart.
- **Vercel** (`backend-serverless/`) uses Vercel's managed Node.js 22 runtime. Confirm the project's Node.js version is 22.x.

### Security

- **Node.js 22.23.4 base images** for the backend runtime and the frontend build stage. This fixes CVE-2026-111497 (Brotli decoder out-of-bounds write, possible RCE), the TLS hostname-verification bypasses CVE-2026-106069 and CVE-2026-106072, `dns.resolve` NUL truncation (CVE-2026-105482), the `crypto.randomUUID()` snapshot entropy reuse (CVE-2026-106074), and the bundled OpenSSL, c-ares, SQLite, undici and CA-store updates. The backend does not decompress Brotli request bodies (Express 4 accepts only gzip/deflate), so the Brotli flaw was reachable only through outbound `fetch()` responses from integrations (#537)
- **Dependabot now updates Docker base images weekly**, so digest pins pick up runtime security patches (#537)
- **Blog: Next.js 16.4.2**, which fixes GHSA-2464-fhr4-w9xw (critical, unauthenticated RCE in the Image Optimization API with SVG files) and GHSA-p3m5-59mp-jv5r (high, Server Actions denial of service). The same group bumps nodemailer, @vercel/blob, React 19.3.1 and the Radix UI primitives (#538)

## [2.3.0] - 2026-10-22

Integrations, installer and insight release. CrowdStrike Falcon joins Microsoft Defender as a first-class EDR integration, an on-prem LAN installer with its own name-constrained CA ships, the dashboards now score the latest result per test and endpoint, and a print-ready execution report is available. Dependency and path-containment vulnerabilities were remediated.

### Upgrade notes

- **Server installs (deploy-server.sh):** after pulling this release, re-run
  `./scripts/deploy-server.sh` (or `achilles-installer upgrade`) — Caddy config
  is now rendered into `deploy/caddy/rendered/`.
- **Stage descriptions and exit code 260 need agent 0.7.0.** The platform handles both; endpoints keep working on older agents but will not report them.

### Highlights

- **CrowdStrike Falcon integration**: alert sync, test correlation, optional auto-resolve, Zero Trust Assessment scores, and vendor-confirmed prevention detection (also added for Defender).
- **On-prem LAN installer (`achilles-installer`)**: a terminal wizard with a name-constrained ProjectAchilles CA, LAN-scoped firewall rules, one-command bootstrap, upgrade, backup and restore, and fingerprint-pinned endpoint bootstrap scripts (#534).
- **Dashboards score what is true now**: Defense Score uses the latest result per test and endpoint, with new cadence, threat-actor readiness, ATT&CK and chain-depth widgets and a time range shared by Dashboard and Analytics.
- **Run detail and test library**: ordered stages with plain-language verdicts and an attack-chain strip; a list view with fleet results on the Tests page.
- **Execution report**: a print-ready PDF report with executive verdict, kill-chain, timeline and findings.
- **Security hardening**: critical/high dependency advisories patched across all npm roots, agent binary paths confined, CodeQL alerts cleared, and a dependency-audit CI gate.

### Added

#### Integrations
- **CrowdStrike Falcon integration** with alert sync, correlation to Achilles tests, auto-resolve and ZTA scores
- **Vendor-confirmed prevention** for CrowdStrike and Defender: a stage the EDR reports as prevented is credited as protected; EDR-killed stages are eligible for correlation
- **Defender re-fired alerts** are re-admitted through a resolution watermark
- **CrowdStrike and Defender tabs** share one layout: full-width alert feed with source/severity filters, linked/organic timeline, evidence-based technique coverage (prevented / detected only / missed), driven by the page date range
- **SB-PC-2026-001 compliance export** (JSON, with JSON Schema), honouring analytics scope filters

#### Analytics
- **Defense Score on latest-result basis** (`basis=latest`) for the dashboard and Analytics, with latest breakdowns for category, host, technique and coverage (both backend forks)
- **Dashboard widgets**: testing cadence, threat-actor readiness, ATT&CK outcome matrix, and chain depth (replaces score by category), with rows that fill their height
- **Shared time range** between Dashboard and Analytics
- **Execution report** at `/analytics/report` and `GET /api/reports/executions`, opened from the Export menu; names the deployment via `ORGANIZATION_NAME`
- **Run detail**: bundle stages in order, per-stage description, plain-language verdicts, ATT&CK technique names, attack-chain strip
- **Tests page list view** with per-test fleet results, progressive columns and honest empty states

#### Installer and deployment
- **`achilles-installer` TUI** (preflight, network/DNS, certificates, Clerk key checks, progress, status, upgrade, backup/restore), release binaries, and a Windows installer CI job
- **Name-constrained CA** with renewal, CA rotation (`CA_ROTATE`), `HOSTS_ENTRY`, `CADDY_BIND_IP`, and LAN-scoped firewall rules that never lock out SSH
- **Async test builds**: Build runs in the background with polling, resumes after a refresh, and Build All runs one test at a time
- Backend warns when git sync is off and the local tests folder is missing
- **On-prem LAN deployment guide** (repo + wiki) for the installer, managed CA and Windows rollout (#535)

### Changed

- **Defense Score tile and trend now share a basis**; trend extends to now and empty windows show as gaps instead of 0 (the CLI shows a dash)
- **ATT&CK technique charts score per stage**, so a sibling stage never marks a technique protected
- **Chain depth** buckets a blocked chain at its first blocked stage, and separates detected/undetected chains, pre-execution blocks ("Stage not run") and stage errors
- **Test filter rail** is quieter; severity dropped from the test library
- **"All time" preset** now queries all data (was 7 days)
- **Installers** use the real repository URLs, a persistent Go build cache, and a root `.env` Clerk key
- Defense Score exit-code and outcome rules documented in a canonical Exit Codes and Outcomes reference

### Fixed

#### Analytics
- **Stage documents are no longer dropped** when exit codes exceed int32
- **Alert correlation**: terminal alerts cannot re-enter correlation windows; coverage "detected" excludes sibling bundle stages; strict ISO window params; facet counts ignore severity
- **Cadence counts** exclude skipped stages and upload confirmations
- **Execution report** accuracy fixes: truncated (not rounded) rates, silent-run counts, DST-safe timelines, partial shard failures and alert budgets surfaced instead of read as "no alerts"

#### Integrations
- **Defender sync no longer fails silently** on least-privilege ES keys; Sync Now is authenticated and shows errors
- **CrowdStrike ZTA** uses the real `queries/assessments/v1` endpoint; a 404 is treated as not licensed; the `achilles-crowdstrike` index is created by init helpers

#### Frontend
- Build All stops when the drawer closes and backs off on 429; inconclusive tests are no longer labelled "not run"; technique chips and test list fit laptop widths

#### Installer and deployment
- **Docker/installer**: Clerk key is accepted and never overwritten by the placeholder, long builds pass the nginx proxy, Fly deploys stamp the commit, existing server installs stay upgradable
- **Windows installer** runs on PowerShell 5.1 and no longer crashes in Phase 4
- **Backend** falls back to the global platform setting on conflicting build tags

### Security

- **Registered agent binary paths and build outputs are confined** to the binaries directory (CodeQL path-injection fixes)
- **Critical/high dependency advisories patched** in backend, backend-serverless, frontend, blog and wiki (Docusaurus 3.10.2)
- **CrowdStrike client** CodeQL SSRF and ReDoS alerts resolved
- **Dependency-audit CI gate** fails on high/critical advisories with an expiring allow-list
- **Installer hardening**: Windows bootstrap locks `C:\F0` and the agent ACL before use, imports the CA root from verified bytes, backup restore has containment checks and a pinned helper image

## Agent [0.7.0] - 2026-10-22

### Added
- **Per-stage descriptions.** The agent carries each stage's plain-language `description` from `bundle_results.json` to the platform, shown in run detail (requires platform 2.3.0)

### Fixed
- **Defender ASR pre-execution blocks are recorded as a result, not a failed task.** When ASR rule `01443614` (or an application-control policy) denies launch of a fresh, low-prevalence test binary (`ACCESS_DENIED` at process creation), the agent now reports exit code `260` (`BlockedPreExecution`) with a reason naming the rule and the `C:\F0\tasks` per-rule exclusion remedy, instead of failing the task and leaving it stuck in `executing`. The backend classifies `260` as `inconclusive`, excluded from the Defense Score and Error Rate.

### Changed
- Updated `golang.org/x/sys`

## [2.2.0] - 2026-09-24

Reliability and reach release. The agent update pipeline was hardened end to
end after a fleet outage: a mislabelled binary put agents into an install
loop, and Defender ASR then blocked freshly built updates, taking endpoints
offline. Also: the console works on phones and tablets, a new public landing,
`/api/health` reports what is actually deployed, and Dependabot noise is down
from ~5 PRs a week to ~3 a month without weakening security updates.

### Added

#### Console
- **Responsive layout for phones and tablets.** Below `lg`: the Tests facet
  rail becomes a filter sheet, test detail goes content-first with a files
  sheet, the Agents page stacks with row cards, stream rows use a two-line
  layout, toolbars and headers wrap, and controls are at least 40 px on
  coarse pointers. Desktop layouts are unchanged (`useMediaQuery` /
  `useIsDesktop` hooks)
- **New public landing**: the open-source ecosystem page (six tools across
  Validate / Deceive / Test with local AI agents), English and Spanish

#### Agents
- **Upload Agent Binary signs with a tenant certificate**, the active one or
  any stored certificate picked from a dropdown. Signing is fatal by default;
  unsigned registration needs an explicit opt-in
- **Automatic key rotation is on by default** for new installs, now that the
  sweep only targets agents with a recent heartbeat and rotations resolve on
  the key the agent presents. An explicitly saved preference still wins
- **Build Agent Binary records its source commit** in the version's release
  notes (`Built from source (windows/amd64) at 1bbe749`)

#### Platform
- **`/api/health` reports the real version and commit** of the running
  deployment (both backend forks), instead of a hardcoded `1.0.0`

### Fixed

#### Agent updates
- **Uploads are rejected (422) when the binary's embedded version differs**
  from the version entered, or the binary has no version stamp. A 0.6.3 build
  registered as 0.6.4 made every agent install it, restart still reporting
  0.6.3, and reinstall it in a loop. The check runs in `registerVersion()`, so
  it covers upload, register-by-path and build, on the final signed file
- **Build Agent Binary fetches the latest agent source before every build.**
  The clone was made once at startup and never pulled, so after an agent-only
  merge that didn't redeploy the backend (Render's `buildFilter`), Build
  compiled old code under a new version number. A failed refresh now fails
  the build
- **Update All no longer queues duplicate update tasks**: an agent with an
  open `update_agent` task reuses it
- Uploaded Windows binaries were reported unsigned because the signature check
  misread `osslsigncode` output

### Changed
- **Render**: both Blueprint services deploy only after the commit's GitHub
  checks pass (`autoDeployTrigger: checksPass`), matching Fly's test-first
  deploy. Applies to Blueprint-managed services; dashboard-created services
  keep their own setting
- **Dependabot**: one grouped PR per ecosystem per month (npm across all four
  roots, Go, Actions) with a cooldown (npm/Go: patch 3 d, minor 7 d, major
  30 d; Actions 7 d). Security updates are unaffected. Auto-merge now works:
  it queues minor/patch PRs, which merge after a human approval and the
  required `Test backend` / `Test frontend` checks
- The agent release workflow now reports clearly when it publishes an unsigned
  Windows binary instead of printing a single easy-to-miss line

### Security
- **All GitHub Actions are pinned to commit SHAs**; the last seven mutable tags
  (`setup-node`, `setup-go`, `checkout`, `upload-artifact`,
  `download-artifact`) are gone
- **`main` requires `Test backend` and `Test frontend` to pass**, pinned to the
  GitHub Actions app so another app can't satisfy them
- `cert_id` on binary upload is validated against the certificate store rather
  than sanitised (CodeQL `js/path-injection`)

## Agent [0.6.7] - 2026-09-24

Update-safety release. After this version, an update that can't run is rolled
back and reported, and the agent stays online. Numbered 0.6.7 because tenants
built 0.6.4–0.6.6 from source during the incident, so a lower official
version would be refused as a downgrade.

> **The update to 0.6.7 still runs the previous version's updater**, which
> doesn't have the launch check. On Windows endpoints with the Defender ASR
> rule "block executables unless they meet a prevalence, age, or trusted list
> criterion" (`01443614-cd74-433a-b99e-2ecdc07bfc25`) in Block mode, add a
> per-rule exclusion for exactly `C:\F0\achilles-agent.exe` **before** agents
> pick up this version. See Agent Self-Updates → Endpoint security.

### Fixed
- **Launch check with rollback**: after swapping in a new binary the agent runs
  `<final path> --version`. If Windows refuses to run it (Defender ASR returns
  Access Denied) or it reports a different version than advertised, the agent
  restores `<path>.old`, keeps running, and fails the update task with the
  reason. Previously it exited for a restart that could never succeed
- **Fallback restart works on non-US locales**: the Windows `AchillesAgentRestart`
  task is registered with a `[DateTime]` trigger via `Register-ScheduledTask`.
  `schtasks /SD` parsed a US date in the machine locale, failing on `en-GB`
  with "Incorrect Start Date" for day > 12 and scheduling the wrong month
  otherwise
- **Repeat-install guard**: the agent won't reinstall the same artifact
  (version + SHA256) that didn't change its version, stopping an install loop
  caused by a mislabelled binary
- **Update task results are accepted**: they now carry `os`, `arch`, hostname
  and timestamps. Before, the server rejected them (400) and every
  admin-triggered update stayed "Executing"
- Go dependency: `golang.org/x/sys` 0.47.0 → 0.48.0

## [2.1.0] - 2026-09-01

Interface release. The console was rebuilt on the **f0 design language** — a
single dark theme replacing three selectable ones — the three module dashboards
were replaced by one unified Security Dashboard, and navigation flattened to six
destinations. Alongside it: API keys, two new self-hosted deployment targets,
write-index rollover, Defender auto-resolve, and a rate-limiter recalibration.

### Added

#### Console & Navigation
- **f0 design language** as the single theme — one dark palette (`#060906` ground, `#3ef08a` accent), Inter for prose and JetBrains Mono for machine-shaped values, self-hosted as variable fonts
- **Unified Security Dashboard** at `/dashboard` — attention banner (offline agents, stale agents, 24 h task failures, outdated binaries, sync failures), six-KPI strip, trend overview, severity mix, ATT&CK coverage, category breakdown, fleet health, recent executions
- **7d/30d/90d range selector** on the dashboard, independent of the Analytics window
- **Flat six-destination navigation** — Dashboard, Tests, Analytics, Agents, Tasks, Settings — with global search and notifications docked in the sidebar; the top bar is gone
- **Keyboard shortcuts** — `1`–`6` for destinations, `/` for page search, `⌘K` for global search, `?` for the reference; guarded against firing inside inputs and dialogs
- **Tests page** rebuilt as a facet rail (category, severity, platform, threat actor, "not run yet") beside category-grouped cards
- **Executions master-detail** — grouped runs beside per-control results, keyboard selection, and a deep-linkable `?expanded=<id>`
- **Agents utility rail** — fleet-pulse ring, attention strip, version rollout, groups, key rotation, and per-platform binary downloads as native cards
- **Task stream** — chronological view with date markers, status glyphs, collapsible batch rows, and a detail panel; stdout/stderr open in a full-width dialog
- **Configurable wordmark** via `VITE_BRAND_WORDMARK` / `VITE_BRAND_TAGLINE`, rendered two-tone with a cursor
- Legacy route redirects for every pre-2.1 path (`/browser`, `/browser/test/:uuid`, `/endpoints/*`, `/favorites`, `/recent`, `/analytics/setup`)

#### Platform
- Blog at [blog.projectachilles.io](https://blog.projectachilles.io) — Next.js 16 + MDX, Spanish/English auto-translation workflow, RSS/sitemap, tag archives; linked from the landing nav and footer
- API keys v1 for programmatic access — `pa_` bearer tokens with scoped read/read-write permissions, Settings → API Keys tab, `POST`/`GET`/`DELETE /api/api-keys`
- `admin` scope for API keys, for headless automation (an upcoming MCP server) that needs `endpoints:tasks:command` — remote command execution as root/SYSTEM on any enrolled agent. Deliberately excludes `settings:users:manage`, so an admin-scope key can never create/revoke other API keys or manage human accounts; that stays a Clerk-session-only action
- Unified `achilles deploy` CLI TUI for guided multi-target deployment (interactive or headless)
- Public and on-prem single-server deployment targets behind Caddy TLS with four certificate modes (`docker-compose.server.yml`, `scripts/deploy-server.sh`, `deploy-remote.sh`, `deploy-do.sh`)
- DigitalOcean tenant deployer with phased, resumable provisioning (`scripts/deploy-do/`)
- Interactive architecture diagram suite under `docs/architecture/`
- `GET /api/agent/admin/agents/heartbeats` — bulk hourly heartbeat buckets for the whole fleet in one request, replacing one request per agent behind the sparkline column
- `POST /api/agent/admin/tasks/:id/retry` — re-dispatch a terminal `execute_test` task, linked to the original through `original_task_id`; not capped by `max_retries`, and command tasks are rejected so it can't sidestep `endpoints:tasks:command`
- Rate-limiting architecture reference (`docs/rate-limiting.md`) and LAN development agents guide (`docs/deployment/LAN_DEV_AGENTS.md`)

#### Analytics
- Write-index rollover — ingestion routes through dated write indices (`achilles-results-<date>`) with daily/monthly/static modes, configurable in Analytics settings or via `ELASTICSEARCH_WRITE_INDEX_*` env vars
- Defender tab redesign — hero row, correlation timeline, alert drill-down drawer, per-execution Defender detection rate with MITRE roll-up, control ↔ alert linking, server-side technique filter
- Defender auto-resolve — programmatic resolution of Achilles-correlated alerts with disabled/dry-run/enabled modes, per-alert receipts, and audit-trail comments
- Per-stage Defender alert attribution and stage-specific enrichment
- Certificate authentication (JWT client assertion) for the Microsoft Defender and Azure/Entra ID integrations, as an alternative to client secrets
- Self-signed Elasticsearch support (custom CA + insecure-skip) and admin endpoint to drain the ingestion backlog

#### Frontend
- "Has binary" filter on the Browse tab, backed by new `GET /api/tests/builds` endpoint
- Governed chart color tokens with WCAG AA contrast enforcement and a drift-guard test
- Honest task status — completed tasks with non-zero exit codes now display as Failed across all task tables
- Skeleton loaders for dashboard cards; redesigned bilingual landing page
- Test library sorts newest-first; agents page shows total count with full pagination

#### Agent
- Per-machine schedule randomization mode — each agent gets an independent randomized next-run
- `--reload` flag for in-place config refresh
- EDR-block badge for blocked tasks plus WDAC operations runbook
- Split short-request vs streaming HTTP timeouts (v0.6.1)

### Changed
- **Analytics defaults to a 90-day window** (was 30) — weekly and monthly bundle schedules produced empty 30-day charts on healthy programmes
- **Analytics posture section** rebuilt in analyst columns: a Defense Score ledger (Actual / EDR-only / Risk-accepted / Inconclusive) and Secure Score on the left, trend overview on the right. Actual Score renders as a neutral dashed reference line instead of a fourth green series
- Coverage and by-host charts flattened to bar lists; the Test Breadth by Host treemap renders at a fixed height again
- Scheduled Tasks on the Tasks page is collapsed by default
- Documentation site restyled to the f0 design language and reorganised around the new navigation
- Rate limiters re-keyed from IP to principal (agent ID / Clerk user): agent device 30/min, enrollment/download 300/15min, global UI 1000/15min per user — fixes NAT collapse for real fleets (see `docs/rate-limiting.md`)
- Manual index creation removed from Analytics settings — write indices are auto-created on first ingest with the canonical mapping
- Target Index defaults to the global write index; per-task picker moved under Advanced
- Performance: bcrypt verdict caching on the agent auth hot path (HMAC-SHA256 cache key)

### Fixed
- SPA self-heals stale code-split chunks after deploys (chunk-reload guard + nginx/Vercel cache headers)
- Durable result ingestion with bounded retry; idempotent result submissions via deterministic document IDs
- Scheduler ISO/space datetime mismatch; `expireOverdueTasks` now covers `assigned` tasks
- Defender alerts whose timestamps drift out of the correlation window after resolution still correlate
- Executions grouped by exact event time instead of 30-minute buckets; defense-score query requests uncapped totals
- Full build errors shown instead of clamping to 3 lines; agent target pickers show the full active fleet

### Removed
- Theme selector and the Default / Neobrutalism / Hacker Terminal themes — the console ships a single dark theme and stored preferences are ignored
- The per-module Browser, Analytics, and Agent dashboards, superseded by the unified Security Dashboard
- The top bar — search, notifications, and sign-out moved into the sidebar

### Security
- Patched Clerk auth bypass (CVE-2026-41248 + GHSA-vqx2-fgx2-5wq9)
- Closed cross-tenant IDOR in risk-acceptance by-id endpoints; Defense Score risk-acceptance exclusion filter scoped by org
- Patched axios cluster (prototype pollution, header injection, SSRF) and closed 60+ Dependabot alerts via overrides and direct bumps
- Closed CodeQL path-injection findings (`fileService.readFileContent`, `findTestDir`, `metaPath`/`ensureBuildDir`)
- Purged inlined Elasticsearch API keys from docs and added a documentation hygiene rule
- Rate-limited `pa_` bearer authentication with uniform 401 responses

## Agent [0.6.3] - 2026-09-01

Reliability release. Closes two ways an endpoint could lose its credential and
be locked out permanently, plus the resilience and transport work accumulated
since 0.6.0.

### Fixed
- **A rotated key is adopted only once it is durably on disk.** The heartbeat
  handler switched the in-memory key first and merely logged a warning if the
  write failed, so the agent authenticated with a key its config did not hold.
  The server saw proof of possession, promoted it, and dropped the old key —
  then the next service restart loaded the stale key and 401'd forever. On a
  failed write the agent now keeps its previous key; the server cancels the
  unclaimed rotation and re-arms it later
- **Config writes are atomic.** `os.WriteFile` truncated the file before
  writing, so a crash, power loss, or full disk mid-write left a truncated
  config and an agent with no loadable key. Now written to a temp file in the
  same directory, fsynced, permissions applied before it is reachable at its
  final name, then renamed into place
- `agent/main.go` reported version `0.6.0` regardless of the Makefile, which
  had drifted to `0.6.2`. The LDFLAGS stamp masked this for `make` builds but
  a plain `go build` produced a binary that misreported itself
- Typed errors in the reporter; `queue.Drain` deletes permanently-rejected
  results instead of retrying them forever
- `bundle_id` mismatches are logged rather than silently dropping the data

### Added
- `--reload` flag for in-place config refresh
- Split short-request vs streaming HTTP timeouts — `httpQuick` (30 s) for JSON
  calls, `httpStream` (no overall timeout, 30 s response-header timeout) for
  binary downloads, so a large test binary on a slow link is no longer killed
  by the JSON budget (0.6.1)

### Changed
- Go toolchain to 1.25.9; `golang.org/x/sys` 0.40.0 → 0.47.0

## Agent [0.6.0] - 2026-04-03

First tagged release of the Achilles Agent binary.

### Added
- Custom Go agent with enrollment, heartbeat, task execution, and self-updating
- Cross-platform support: Windows (amd64), Linux (amd64), macOS (amd64 + arm64)
- System service installation (systemd on Linux, SCM on Windows, launchd on macOS)
- Token-based enrollment with configurable TTL and max uses
- Heartbeat monitoring with real-time system metrics (CPU, memory, disk, uptime)
- Task queue with priority-based execution and state machine
- SHA256 binary verification before execution
- Self-update mechanism — agents poll for new versions and auto-apply
- Remote uninstall with two-phase cleanup (stop service + remove files)
- Enhanced `--status` diagnostics: service state, connection health, config validation
- Async task execution with Windows Job Objects for orphan process cleanup
- Azure/Entra ID credential flow for identity-tenant tests
- Bundle results fan-out for cyber-hygiene and intel-driven multi-stage controls
- Ad-hoc code signing for macOS via rcodesign

## [2.0.0] - 2026-04-03

Complete platform overhaul — custom agent system, multi-deployment support, Microsoft Defender integration, and release automation.

### Added

#### Agent System
- Custom Go agent (`agent/`) with enrollment, heartbeat, task execution, and self-updating
- Token-based enrollment with configurable TTL and max uses
- Heartbeat monitoring with real-time system metrics (CPU, memory, disk, uptime)
- Task queue with priority-based assignment and state machine (pending → assigned → downloading → executing → completed)
- SHA256 binary verification before execution
- Stdout/stderr capture with 1MB limit per execution
- Agent tagging system for filtering and bulk operations
- Agent admin dashboard with search, filtering, and status indicators
- Agent soft-delete and status management (active/inactive)
- Silent auto-polling on Agents and Tasks pages
- Self-update mechanism — agents poll for new versions and auto-apply
- System service installation (systemd on Linux, SCM on Windows)
- Cross-platform support: Windows/Linux × amd64/arm64
- Agent API key authentication middleware (separate from Clerk)
- Public binary download endpoint with rate limiting (10 req/15min)
- macOS support (darwin/amd64, darwin/arm64) with launchd service and ad-hoc code signing via rcodesign
- Remote uninstall with two-phase cleanup (stop service + remove files)
- Enhanced `--status` diagnostics: service state, connection health, config validation
- Async task execution with Windows Job Objects for orphan process cleanup
- Azure/Entra ID credential flow for identity-tenant tests
- Bundle results fan-out for cyber-hygiene and intel-driven multi-stage controls

#### Build System
- On-demand Go cross-compilation from the UI
- Target platform selection (Linux/Windows × amd64/arm64)
- Windows Authenticode code signing via osslsigncode
- Multi-certificate management — upload PFX/P12 or generate self-signed (up to 5)
- Active certificate tracking with label editing
- Embed dependency detection (`//go:embed` directive scanning)
- Embed file upload for tests that embed resources
- Build caching in `~/.projectachilles/builds/`
- Build metadata tracking (platform, filename, signed status, file size, timestamp)
- Certificate storage in `~/.projectachilles/certs/cert-<timestamp>/` subdirectories
- Legacy flat-file certificate migration on first `listCertificates()` call

#### Task Scheduling
- Recurring test execution schedules (once, daily, weekly, monthly)
- Timezone-aware scheduling with DST handling
- Randomized execution time option (office hours weekdays, anytime weekends)
- Per-task Elasticsearch index targeting for result isolation
- Task notes with version tracking and edit history
- Copy-to-clipboard for stdout/stderr in task detail view
- Schedule pause/resume and soft-delete
- Background scheduler processing with automatic next-run calculation

#### Analytics
- 30+ analytics query endpoints covering defense scoring, coverage, and error analysis
- Defense score trend with rolling-window aggregation (1–90 day windows)
- Defense score breakdowns by test, technique, category, hostname, severity, and organization
- Host-test matrix endpoint for heatmap visualization
- Threat actor coverage metrics
- Error rate trend analysis with stacked area chart
- Canonical error code mapping and redesigned error type chart
- Three-state result classification (Protected / Unprotected / Inconclusive)
- Paginated execution results with advanced multi-field filtering
- Available-values catalog endpoints (tests, techniques, hostnames, categories, severities, threat actors, tags, error names, error codes)
- Multi-index management — list indices, create indices, set active index pattern
- Canonical test count with rolling 90-day window for stable coverage denominators
- Nested donut chart for category/subcategory breakdown
- Clickable hosts in "Others" aggregation with drill-down
- Forward-fill (LOCF) for defense score trend gaps
- Environment variable support for Elasticsearch configuration
- User-configured settings take priority over environment variables
- Auto-test connection on save for immediate UX feedback
- Fire-and-forget result ingestion — agent results auto-ingest to ES asynchronously
- Microsoft Defender integration — Secure Score, Alerts v2, Control Profiles via Graph API
- 9 Defender analytics endpoints (secure-score, alerts, controls, cross-correlation)
- Test-alert detection correlation between F0RTIKA results and Defender alerts
- Dual Defense Score display with real score trend line overlay
- Risk acceptance for individual security controls
- Archive executions feature
- Shared FilterBar across Analytics Dashboard tabs

#### Alerting & Notifications
- Threshold-based trend alerting with configurable score drop/absolute thresholds
- Slack alerting via Block Kit formatted messages
- Email alerting via Nodemailer with HTML templates
- Alert settings UI with Slack webhook and SMTP configuration
- NotificationBell component with alert dropdown in top bar
- Alert dispatch hooked into result ingestion pipeline

#### Browser
- Git-synced test library with automatic repository sync
- Favorites and recent views with localStorage persistence
- Version, author, and Git modification dates on test cards
- Copy-to-clipboard for detection rules and test artifacts
- Build, sign, and download test binaries from test detail pages
- Searchable test selector in task creation dialog
- MITRE ATT&CK coverage matrix with visual technique heatmap
- Browse overview dashboard with 3-tab layout (overview, matrix, list)
- Execution drawer for running tests directly from browse page
- Category legend and metric card subtitles on overview

#### Docker & Deployment
- Docker Compose support with multi-service configuration (frontend, backend)
- Optional Elasticsearch profile (`--profile elasticsearch`)
- Elasticsearch seeding service with 1000 synthetic results
- Interactive setup wizard (`setup.sh`) with TUI (whiptail/dialog)
- Non-interactive setup mode for automation
- ngrok tunnel support with configurable domains
- ENCRYPTION_SECRET for stable encryption across container restarts
- Health checks for backend and Elasticsearch services
- Go toolchain and osslsigncode in Docker image for builds
- Fly.io deployment with custom domains, volumes, and documentation
- Render.com deployment with Blueprint and persistent disk
- Railway deployment with private networking and AGENT_REPO_URL git sync
- Vercel serverless deployment with Turso, Vercel Blob, and Crons
- Backend-serverless (`backend-serverless/`) — independent fork for Vercel
- Pure-JS certificate generation via node-forge for serverless environments
- Client-side Blob upload for large binaries on Vercel
- Upload pre-built binary support for all deployment targets

#### Frontend
- Collapsible sidebar layout
- Dark/light theme improvements with consistent text colors
- Responsive design updates across all modules
- Endpoints dashboard redesign with donut charts, task activity, and version metrics
- Fullscreen expand dialog for task output
- Collapsible Scheduled Tasks section on Tasks page
- Rich test info modal in Executions detail panel

#### Visual Themes
- Neobrutalism visual theme with hot pink/magenta accent
- Hacker Terminal visual theme with phosphor scanline effects
- Green/amber phosphor variant toggle for Hacker Terminal
- Theme selector in settings

#### Authentication
- Clerk authentication with social login (Google, Microsoft, GitHub)
- `RequireAuth` component for route protection
- `useAuthenticatedApi` hook for automatic JWT injection
- Session isolation per authenticated user
- Rate limiting on authentication endpoints (20 req/15min)

#### Release Management
- Semi-automated release flow with Claude Code `/release` command
- GitHub Actions release workflows for platform and agent binary releases
- Conventional commit validation hooks
- CHANGELOG generation from commits via `/changelog` command
- Pre-push tag consistency validation

### Changed
- **BREAKING**: Removed LimaCharlie integration — replaced by custom agent system
- **BREAKING**: All routes now require Clerk authentication (Browser was previously public)
- **BREAKING**: Endpoints module replaced by Agents module
- Replaced stacked bar charts with horizontal single-bar layout for clarity
- Replaced dashboard widgets with simpler alternatives
- Migrated charts to consistent UI patterns
- Redistributed analytics filters — date range in tab bar, filter panel in table toolbar
- ASCII banner updated from "PROJECT" to "ACHILLES"
- Start script supports `--daemon` mode for background operation and `-k` flag for killing existing processes

### Fixed
- SQLite UTC timestamp parsing in `timeAgo` display
- Docker env file no longer overrides `AGENT_SERVER_URL` from env_file
- Agent build copies source to temp directory for read-only Docker mounts
- Elasticsearch field mapping queries for enriched fields
- Index pattern selection persistence across sessions
- Stacked bar charts showing all data series correctly
- Analytics setup redirect loop
- Tab parameter preservation when syncing filter URL params
- Non-conclusive results excluded from defense score calculations
- Dashboard data refresh when credentials or index pattern change
- Non-test data filtered from analytics queries
- LOCF threshold logic for sparse trend data
- Synthetic data generator error code distribution
- Local Docker ES support with no-auth and correct field mappings
- Elasticsearch Python client pinned to v8 for ES 8.17 compatibility
- Setup script guarded `&&` conditionals against `set -e`
- Setup wizard plain-text newline rendering
- Delete filter alignment in agent management
- Windows SCM handshake in agent service installation
- Agent version reporting
- Task creator dialog effect stabilization and checkbox visibility
- Tag API route alignment between frontend and backend
- Stale task detection — tasks auto-fail when agent goes offline during execution
- Group-aware pagination for Executions table (replace ES collapse with terms agg)
- Exclude cyber-hygiene from detection rate calculation
- Cap Secure Score category percentages at 100%
- Exclude deprecated controls from Secure Score category maxScore
- Async task execution with Windows Job Objects for orphan process cleanup
- Action buttons column moved to left side of table for discoverability
- Agent update tasks patched to executing status before running
- nginx host-not-found crash on PaaS without Docker Compose DNS

### Security
- Upgraded React to 19.2.3 (CVE-2025-55182 patch)
- Code signing for test binaries with Authenticode
- Certificate password encryption at rest
- Enrollment token validation with TTL and usage limits
- Agent API key authentication (separate from web UI)
- SHA256 binary verification in agent executor
- Resolved all Dependabot security vulnerabilities
- Added Dependabot configuration for automated dependency updates
- Semgrep SAST in CI with 11 community rulesets + 5 custom rules
- Microsoft Defender integration credentials encrypted at rest (AES-256-GCM)
- Alert service credentials (Slack webhook, SMTP password) encrypted at rest

## [1.0.0] - 2024-12-10

### Added

#### Core Platform
- Unified startup script (`start.sh`) with smart port detection and fallback
- Frontend/backend architecture with API proxying
- Dark/light theme support with system preference detection
- Error boundary for graceful error handling

#### Browser Module
- Security test browsing and viewing
- Test detail pages with metadata display
- File viewer for test artifacts
- Search and filtering capabilities

#### Analytics Module
- Elasticsearch integration for test results
- Settings-based authentication flow
- Dashboard with defense score metrics
- Trend visualization over time
- Technique breakdown analysis
- Test execution history

#### Endpoints Module
- LimaCharlie integration for endpoint management
- Session-based authentication with rate limiting
- Organization management
- Sensor inventory and status monitoring
- Real-time endpoint telemetry

#### UI Components
- Shared component library (Button, Card, Input, Select, Tabs, Badge, Alert, Spinner)
- Responsive layout with mobile support
- Accessible UI following WCAG guidelines

#### Developer Experience
- TypeScript throughout (frontend and backend)
- Path aliases (`@/` for imports)
- Hot reload for development
- Comprehensive CLAUDE.md for AI-assisted development

### Security
- Helmet.js for security headers
- CORS configuration
- Rate limiting on authentication endpoints
- Secure session management
- Input validation with Zod

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 2.3.0 | 2026-10-22 | CrowdStrike Falcon integration, on-prem LAN installer, latest-result Defense Score, execution report, security hardening |
| Agent 0.7.0 | 2026-10-22 | Per-stage descriptions, ASR pre-execution blocks reported as exit 260 |
| 2.2.0 | 2026-09-24 | Agent update hardening, responsive console, new landing, real `/api/health` version, Dependabot and CI supply-chain hardening |
| Agent 0.6.7 | 2026-09-24 | Launch check with rollback, locale-safe fallback restart, repeat-install guard, update task results accepted |
| 2.1.0 | 2026-09-01 | f0 console restyle, unified Security Dashboard, flat navigation, API keys, self-hosted targets |
| 2.0.0 | 2026-04-03 | Custom agent, multi-deployment, Defender integration, release tooling |
| Agent 0.6.3 | 2026-09-01 | Key-rotation and config-write durability fixes; HTTP timeout split |
| Agent 0.6.0 | 2026-04-03 | First tagged agent binary release |
| 1.0.0 | 2024-12-10 | Initial release |

[Unreleased]: https://github.com/projectachilles/ProjectAchilles/compare/v2.7.0...HEAD
[2.7.0]: https://github.com/projectachilles/ProjectAchilles/compare/v2.6.1...v2.7.0
[2.6.1]: https://github.com/projectachilles/ProjectAchilles/compare/v2.6.0...v2.6.1
[2.6.0]: https://github.com/projectachilles/ProjectAchilles/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/projectachilles/ProjectAchilles/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/projectachilles/ProjectAchilles/compare/v2.3.1...v2.4.0
[2.3.1]: https://github.com/projectachilles/ProjectAchilles/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/projectachilles/ProjectAchilles/compare/v2.2.0...v2.3.0
[Agent 0.7.1]: https://github.com/projectachilles/ProjectAchilles/compare/agent-v0.7.0...agent-v0.7.1
[Agent 0.7.0]: https://github.com/projectachilles/ProjectAchilles/compare/agent-v0.6.7...agent-v0.7.0
[2.2.0]: https://github.com/projectachilles/ProjectAchilles/compare/v2.1.0...v2.2.0
[Agent 0.6.7]: https://github.com/projectachilles/ProjectAchilles/compare/agent-v0.6.3...agent-v0.6.7
[2.1.0]: https://github.com/projectachilles/ProjectAchilles/compare/v2.0.0...v2.1.0
[Agent 0.6.3]: https://github.com/projectachilles/ProjectAchilles/compare/agent-v0.6.0...agent-v0.6.3
[Agent 0.6.0]: https://github.com/projectachilles/ProjectAchilles/releases/tag/agent-v0.6.0
[2.0.0]: https://github.com/projectachilles/ProjectAchilles/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/projectachilles/ProjectAchilles/releases/tag/v1.0.0
