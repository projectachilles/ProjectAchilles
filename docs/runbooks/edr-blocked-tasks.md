# Operator Runbook: EDR-Blocked Tasks

## Symptom

On the **Tasks** page, a test run ends as **Not run** with exit code `260` ("blocked before launch"). The task's output starts with:

```
Blocked before execution (Access is denied): something on the endpoint refused to start the test binary. ...
```

Old agents, from before the exit-260 result existed, report the same block as a `failed` task with a yellow "**Blocked by endpoint policy**" badge and this `stderr`:

```
start binary: fork/exec C:\F0\tasks\task-<uuid>\<test-uuid>.exe: Access is denied.
```

Exit `260` is inconclusive: it counts in neither the Defense Score nor the error rate. The exception is a block by a connected CrowdStrike, SentinelOne or Sophos EDR: when that EDR's own prevention alert names the run, the backend rewrites the result in Elasticsearch to `126` (**Protected**, for the test only, never for a technique). The Tasks page keeps showing exit `260`. A Microsoft Defender alert never does this, because Defender ASR produces the same code. See `wiki/docs/user-guide/analytics/exit-codes-and-outcomes.md`, section 7.

An EDR block of a test is a result, not a problem to fix. This runbook is for blocks by application control or ASR, which stop every test before it can measure anything.

## What this means

The endpoint's security policy refused to launch the test binary. This is **not** an Achilles agent permission problem — the agent runs as `LocalSystem` on Windows (full admin) — and **not** an antivirus quarantine (you'd see "file not found" instead). It is a **kernel-level execution block** issued by one or more of:

- **An EDR prevention policy** (Microsoft Defender for Endpoint, CrowdStrike Falcon, SentinelOne, Sophos) whose static or machine-learning prevention blocks the binary
- **Windows Defender Application Control (WDAC) / AppLocker** policy whose allowlist excludes the binary's signature or path
- **SmartScreen reputation block** for unsigned binaries
- **DefenderASR** rules (e.g. "Block executable files from running unless they meet a prevalence, age, or trusted list criterion")

The cruel irony of the CIS Hardening Bundles: those validators audit hardening policies that themselves block unsigned binaries from `C:\F0\tasks\…`. **A previously-hardened endpoint cannot run the test that audits its hardening** — until the operator whitelists it.

## Verification

1. On the affected endpoint, open **Event Viewer** → **Applications and Services Logs** → **Microsoft → Windows → CodeIntegrity** (for WDAC) or **Microsoft → Windows → AppLocker → EXE and DLL** (for AppLocker).
2. Look for an event timestamped within ~1 minute of the task's start. Common event IDs:
   - **WDAC**: 3076 (audit) or 3077 (enforced block)
   - **AppLocker**: 8003 (audit) or 8004 (enforced block)
3. The event body will name the blocked binary (`<test-uuid>.exe` under `C:\F0\tasks\…`) and the policy ID that blocked it.

If you see a CrowdStrike Falcon block instead, check the Falcon console → **Detections** at the same time — the prevention reason will name the policy (likely "Suspicious Process — Untrusted Binary" or "ML Heavy Pattern").

## Resolution paths (ordered by smallest blast radius)

### 1. Cert-keyed allowlist (recommended)

Stable across rebuilds. Requires the test binary to be signed.

1. Confirm the binary IS signed: `Get-AuthenticodeSignature 'C:\F0\tasks\task-<uuid>\<test-uuid>.exe'`. The agent build pipeline signs Windows binaries with the active code-signing cert (`backend/src/services/tests/buildService.ts` invokes `osslsigncode`); a SHA-256 should be present.
2. Capture the cert thumbprint: `Get-AuthenticodeSignature ... | Select -ExpandProperty SignerCertificate | Select Thumbprint`.
3. Add a publisher rule to your WDAC / AppLocker policy referencing that thumbprint. For WDAC, this is a **Publisher Rule with PCACertificate level**. For AppLocker, **Add Rule → Publisher → Use file as reference**.
4. Push the updated policy via Intune / Group Policy.

The advantage over a hash-keyed allowlist is that **rebuilds with the same cert continue to work** — no policy update needed when the test library changes. Achilles rebuilds binaries on every test-library `git pull`; hash allowlists would break weekly.

### 2. Path-keyed allowlist (loosens posture)

If you cannot adopt cert-based allowlisting, you can whitelist `C:\F0\tasks\*` in the policy. **This is a posture regression** — any binary the agent stages can run, not just signed ones. Acceptable in lab / dev environments; **not recommended for production fleets**.

### 3. Re-author the bundle to use signed in-box binaries

Some bundles (notably the CIS Hardening Bundles) audit OS state by *running* configurations. They can be re-authored to use Microsoft-signed in-box binaries that are already in every WDAC default policy:

- `secedit.exe /export /cfg out.inf` for security policy
- `auditpol.exe /get /category:*` for audit policy
- `reg.exe query` for registry-backed settings
- `gpresult.exe /h` for applied Group Policy

This eliminates the EDR-block for the affected bundle entirely. **Effort is bundle-specific** — coordinate with the test author.

### 4. Defender ASR exclusion (for ASR-specific blocks)

If Event Viewer shows the block came from `Microsoft-Windows-Windows Defender/Operational` event 1121, the ASR rule "**Block executable files from running unless they meet a prevalence, age, or trusted list criterion**" (`01443614`) is the trigger. No certificate satisfies it. Add a **per-rule** exclusion for `C:\F0`, for that rule only, via Intune (Endpoint Security → Attack Surface Reduction → the rule → ASR Only Per Rule Exclusions) or GPO. Never the global "ASR Only Exclusions" list. Steps and checks for the organization's endpoint team: `wiki/docs/deployment/endpoint-prerequisites.md`.

## After remediation — verify

1. From the Achilles UI, run the test again on the affected endpoint (from the test's page, or **Tasks** → select the task → **Retry** when the task offers it).
2. The new task should transition `pending → assigned → executing → completed` with the test's own exit code, not `260`.
3. Neither **Not run** (exit `260`) nor the "Blocked by endpoint policy" badge should appear on the new attempt.
4. If it persists, expand the row, copy the stderr, and check Event Viewer for a fresh policy block event — there may be a second policy still firing.

## Reference

- Agent: `agent/internal/executor/blocked_start.go` (`classifyStartError`) turns a Windows "access is denied" at process creation into a completed result with exit `260`; the call site is in `agent/internal/executor/executor.go`.
- Frontend: `frontend/src/utils/testOutcome.ts` maps `260` to **Not run** ("blocked before launch").
- EDR launch blocks (260 → 126): `backend/src/services/edr/launch-block-evidence.ts` and `launch-block-reconcile.service.ts`.
- Old agents only: `frontend/src/utils/taskFailureClassifier.ts` → `matchesEdrBlock()` matches `fork/exec` AND `Access is denied` together and shows the "Blocked by endpoint policy" badge on a failed task.
