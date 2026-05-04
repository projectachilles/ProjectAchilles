# Operator Runbook: EDR-Blocked Tasks

## Symptom

Tasks fail in the **Endpoints → Tasks** view with status `failed` and a yellow "**Blocked by endpoint policy**" badge next to the status. Expanded `stderr` reads (Windows):

```
start binary: fork/exec C:\F0\tasks\task-<uuid>\<test-uuid>.exe: Access is denied.
```

## What this means

The endpoint's security policy refused to launch the test binary. This is **not** an Achilles agent permission problem — the agent runs as `LocalSystem` on Windows (full admin) — and **not** an antivirus quarantine (you'd see "file not found" instead). It is a **kernel-level execution block** issued by one or more of:

- **Microsoft Defender for Endpoint (CrowdStrike Falcon, etc.) prevention policy** that blocks unsigned binaries running from non-trusted paths
- **Windows Defender Application Control (WDAC) / AppLocker** policy whose allowlist excludes the binary's signature or path
- **SmartScreen reputation block** for unsigned binaries
- **DefenderASR** rules (e.g. "Block executable files from running unless they meet a prevalence, age, or trusted list criterion")

The cruel irony of the CIS Hardening Bundles: those validators audit hardening policies that themselves block unsigned binaries from `C:\F0\tasks\…`. **A previously-hardened endpoint cannot run the test that audits its hardening** — until the operator whitelists it.

## Verification

1. On the affected endpoint, open **Event Viewer** → **Applications and Services Logs** → **Microsoft → Windows → CodeIntegrity** (for WDAC) or **Microsoft → Windows → AppLocker → EXE and DLL** (for AppLocker).
2. Look for an event timestamped within ~1 minute of the failed task's `created_at`. Common event IDs:
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

If Event Viewer shows the block came from `Microsoft-Windows-Windows Defender/Operational` event 1121, the ASR rule "**Block executable files from running unless they meet a prevalence, age, or trusted list criterion**" is the trigger. Add an ASR exclusion for `C:\F0\tasks\*` via Intune — Endpoint Security → Attack Surface Reduction.

## After remediation — verify

1. From the Achilles UI, **manually re-trigger** the failed bundle on the affected endpoint (Endpoints → select agent → Run Test).
2. The new task should transition `pending → assigned → executing → completed` (`exit_code` 0 or test-specific).
3. The yellow "Blocked by endpoint policy" badge should NOT appear on the new attempt.
4. If it persists, expand the row, copy the stderr, and check Event Viewer for a fresh policy block event — there may be a second policy still firing.

## Reference

- Failure-class regex (frontend): `frontend/src/utils/taskFailureClassifier.ts` → `matchesEdrBlock()` matches `fork/exec` AND `Access is denied` together.
- Backend writes the agent's stderr verbatim to `tasks.result.stderr` (`backend/src/services/agent/tasks.service.ts:617-621`), so the badge is driven by exactly what the kernel returned to the agent's `os/exec.Start()` call.
- Agent error-formation site: `agent/internal/executor/executor.go:243`.
