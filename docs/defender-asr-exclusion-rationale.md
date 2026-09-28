# Why a Defender ASR exclusion is required for the security-validation agent

**Summary.** The security-validation platform runs freshly built, organization-specific executables that Microsoft Defender's reputation-based ASR rule *"Block executable files from running unless they meet a prevalence, age, or trusted list criterion"* (`01443614-cd74-433a-b99e-2ecdc07bfc25`) blocks at launch — because they are new and therefore "unknown" to Microsoft's cloud, which is the documented and expected behavior of that rule. Microsoft's supported remedy is to add the application to that rule's exclusion list, so we apply a **per-rule** exclusion scoped to **only this one rule** and the platform's directory (`C:\F0`). All other Defender protections — the remaining 18 ASR rules, antivirus, behavioral monitoring, and EDR — stay fully enforced on those binaries, so detection of the actual attack techniques is preserved.

## Background

The continuous-security-validation platform deploys a purpose-built agent and freshly compiled, organization-specific test binaries to endpoints, under `C:\F0`. These executables are new and unique to your environment by design — rebuilt per release and per organization.

## Root cause of the execution failures

Microsoft Defender's Attack Surface Reduction (ASR) rule **"Block executable files from running unless they meet a prevalence, age, or trusted list criterion"** (GUID `01443614-cd74-433a-b99e-2ecdc07bfc25`) was enabled in **Block** mode. This is a **reputation-based** control: it blocks any executable Microsoft's cloud has not seen on enough machines (**prevalence**), that is too **new** (**age**), or that is not on a **trusted list**. Because these binaries are freshly built and unique to your organization, they never accumulate cloud prevalence and remain "unknown," so the rule **denies them at launch** (Windows Defender Operational **event 1121**, "Access is denied"). This blocks both agent self-updates and the execution of the authorized test payloads before any test logic can run.

## Why an exclusion is the correct, Microsoft-supported remedy

Microsoft states this rule's criteria **cannot** be manually tuned, and that the supported way to allow a legitimate application is to **add it to the rule's exclusion list**. We apply a **per-rule exclusion** — Microsoft's "ASR Only Per Rule Exclusions" — scoped to **only this one rule** and to the **platform's directory**. Every other protection remains fully active on the binaries as they execute, so genuine detection of the attacker techniques they exercise is preserved. This is **not** a broad antivirus exclusion and **not** a code-signing-certificate trust bypass.

## Scope of the change

- **Setting used:** *ASR Only Per Rule Exclusions*, under the rule `01443614-cd74-433a-b99e-2ecdc07bfc25` **only** — not the global exclusion list.
- **Path excluded:** `C:\F0` — the platform's working directory, which contains the agent (`C:\F0\achilles-agent.exe`) and the test-execution binaries (`C:\F0\tasks\…` and the multi-stage test binaries under `C:\F0`).

## What is NOT affected — the other ASR rules remain in Block and fully enforced

The exclusion applies to rule `01443614` alone. Every other ASR rule enabled in your environment continues to evaluate the platform's binaries (and everything else) with no change. For reference, the full set of other ASR rules:

| # | ASR rule (Microsoft name) | GUID |
|---|---|---|
| 1 | Block abuse of exploited vulnerable signed drivers | `56a863a9-875e-4185-98a7-b882c64b5ce5` |
| 2 | Block credential stealing from the Windows LSASS | `9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2` |
| 3 | Block persistence through WMI event subscription | `e6db77e5-3df2-4cf1-b95a-636979351e5b` |
| 4 | Block Adobe Reader from creating child processes | `7674ba52-37eb-4a4f-a9a1-f0f9a1619a2c` |
| 5 | Block all Office applications from creating child processes | `d4f940ab-401b-4efc-aadc-ad5f3c50688a` |
| 6 | Block Office applications from creating executable content | `3b576869-a4ec-4529-8536-b80a7769e899` |
| 7 | Block Office applications from injecting code into other processes | `75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84` |
| 8 | Block Office communication application from creating child processes | `26190899-1602-49e8-8b27-eb1d0a1ce869` |
| 9 | Block Win32 API calls from Office macros | `92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b` |
| 10 | Block executable content from email client and webmail | `be9ba2d9-53ea-4cdc-84e5-9b1eeee46550` |
| 11 | Block execution of potentially obfuscated scripts | `5beb7efe-fd9a-4556-801d-275e5ffc04cc` |
| 12 | Block JavaScript or VBScript from launching downloaded executable content | `d3e037e1-3eb8-44c8-a917-57927947596d` |
| 13 | Block process creations originating from PSExec and WMI commands | `d1e49aac-8f56-4280-b9ba-993a6d77406c` |
| 14 | Block untrusted and unsigned processes that run from USB | `b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4` |
| 15 | Block use of copied or impersonated system tools | `c0033c00-d16d-4114-a5a0-dc9b3a7d2ceb` |
| 16 | Block rebooting machine in Safe Mode | `33ddedf1-c6e0-47cb-833e-de6133960387` |
| 17 | Block Webshell creation for Servers | `a8f5898e-1dc8-49a9-9878-85004b8a61e6` |
| 18 | Use advanced protection against ransomware | `c1db55ab-c21a-4637-bb3f-a12568109d35` |

In addition, Microsoft Defender Antivirus (real-time protection), behavioral monitoring, and Endpoint Detection & Response (EDR) are unaffected and continue to inspect these binaries at runtime.

## References (Microsoft Learn)

1. **ASR rule definition + GUID** — *Block executable files from running unless they meet a prevalence, age, or trusted list criterion*: <https://learn.microsoft.com/defender-endpoint/attack-surface-reduction-rules-reference#block-executable-files-from-running-unless-they-meet-a-prevalence-age-or-trusted-list-criterion>
2. **ASR FAQ** — reputation scoring, why new/updated apps are blocked, and using the exclusions list: <https://learn.microsoft.com/defender-endpoint/attack-surface-reduction-faq>
3. **ASR rules overview** — full rule list with GUIDs, and per-rule exclusion support: <https://learn.microsoft.com/defender-endpoint/attack-surface-reduction-rules-overview>
4. **Configure ASR rules and exclusions** (Intune / GPO / CSP): <https://learn.microsoft.com/defender-endpoint/attack-surface-reduction-rules-configure>
5. **Per-rule exclusions in Intune** — *ASR Only Per Rule Exclusions*: <https://learn.microsoft.com/intune/device-configuration/endpoint-security/attack-surface-reduction>
6. **View ASR events in Windows Event Viewer** — event **1121** (block), 1122 (audit): <https://learn.microsoft.com/defender-endpoint/attack-surface-reduction-windows-events>
