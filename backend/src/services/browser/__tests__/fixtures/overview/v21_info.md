# Qilin (Agenda): BYOVD EDR-Killer & svchost Injection Chain

## Test Information

| Field | Value |
|---|---|
| Test ID | `8f68dda1-94be-430f-8f35-d8af3f9b5d2e` |
| Test Name | Qilin (Agenda): BYOVD EDR-Killer & svchost Injection Chain |
| Category | intel-driven |
| Subcategory | ransomware |
| Platform | windows-endpoint (amd64) |
| Severity | Critical |
| Complexity | High |
| Architecture | Five independent stages in one signed orchestrator |
| Threat Actor | Qilin (Agenda) |
| MITRE ATT&CK | T1518.001, T1082, T1562.001, T1211, T1055, T1003.001, T1490, T1486 |
| Tactics | discovery, defense-evasion, credential-access, impact |
| Rubric | v2.1 — Signal Quality + Execution Context + Operational Hygiene |
| Validation Status | Lab validated 2026-11-02 on `lab-host-01`; all five stages reached |

## Test Score: 8.7/10

### Score Breakdown

| Tier | Criterion | Score | Detailed justification |
|---|---|---:|---|
| 2a | API Fidelity (0–2.5) | **1.7** | Excerpt. |
|  | **Total** | **8.7/10** | **Realism:** 1.7 + 1.5 + 2.0 + 0.5 = **5.7/7.0**. **Structure:** 1.0 + 1.0 + 0.5 + 0.5 = **3.0/3.0**. **Range:** Advanced; all-stage lab validated. |

## Detection Opportunity Audit

The audit below defines **16 candidate detection points**.

| # | Stage | Primitive | Sensor / telemetry surface | Candidate rule pattern and observability boundary |
|---:|---|---|---|---|
| 1 | 1 | SecurityCenter2 AV query | Sysmon/process telemetry; WMI/CIM or EDR query telemetry | PowerShell command line containing `root/SecurityCenter2` and `AntiVirusProduct`; correlate with the following discovery burst. |
| 2 | 1 | Process/service/OS enumeration | Sysmon Event ID 1 or equivalent process events | `tasklist.exe /fo csv`, `sc.exe query`, and `Win32_OperatingSystem` CIM query from the same short-lived parent chain. |
| 3 | 1 | Test-owned Foxit host and `msimg32.dll` load | Sysmon EID 1/7; file EID 11; EDR image-load | `FoxitPDFReader.exe` outside its normal installation path loading `msimg32.dll` outside `System32`; genuine Microsoft signature does not remove the path anomaly. |
| 4 | 2 | Real `rwdrv.sys` drop | Sysmon EID 11; AV content/signature; YARA file scan | Creation of `rwdrv.sys` by the stage process, followed by quarantine or deletion. Static-signature firing is expected to be sensor/policy dependent, not assumed. |
| 5 | 2 | Nonfunctional driver drops | Sysmon EID 11; EDR file creation | Two `.sys` files written into `C:\F0` immediately after removal of the real `rwdrv.sys`; distinguish signature observation from the invalid stand-ins. |
| 6 | 2 | Kernel-service create/query/delete | Windows System 7045/Security 4697 where enabled; Sysmon EID 1; EDR service/registry | `sc.exe create` with `type= kernel`, `start= demand`, and service names `qilin_rwdrv_f0`/`qilin_hlpdrv_f0`; correlate later deletes. |
| 7 | 2 | SeLoadDriverPrivilege adjustment | Windows Security 4703/token-privilege ETW; EDR token telemetry | `AdjustTokenPrivileges` enabling SeLoadDriverPrivilege immediately before native driver-load attempts. Standard Sysmon alone is insufficient for this primitive. |
| 8 | 2 | `NtLoadDriver` on test-owned service paths | EDR native-call/kernel telemetry; Sysmon EID 6 only if a driver actually loads | Native load referencing `CurrentControlSet\Services\qilin_*`; invalid-image NTSTATUS is expected, so a driver-loaded event is **not** expected. |
| 9 | 2 | 320 simulated callback removals | Sysmon/file EID 11; EDR JSON content inspection | Creation of `callback_registry.json` containing hundreds of security-vendor driver names and process/thread/image-load entries. This detects the simulation artifact, not a real kernel callback removal. |
| 10 | 2 | Nonfunctional hlpdrv-device probe / logged `0x2222008` | EDR device-access telemetry; structured F0 log | Open of `\\.\hlpdrv_f0_nonfunctional`, with the emulated termination IOCTL identifier recorded in the stage log. No IOCTL is sent and no production hlpdrv device is accessed, so this is a bounded simulation signal rather than real kernel IOCTL telemetry. |
| 11 | 2 | Test-owned EDR-process termination | Sysmon EID 10/5; EDR process-access/termination | `OpenProcess(PROCESS_TERMINATE)` followed by `NtTerminateProcess` where source and target share the stage binary lineage and target names mimic security products. |
| 12 | 3 | Remote allocation and memory write | Sysmon EID 10; EDR memory telemetry | Source opens its test-owned svchost child for VM operation/write, allocates RW memory, and writes a DLL path. Target name alone must not be treated as production svchost. |
| 13 | 3 | `CreateRemoteThread(LoadLibraryW)` and DLL load | Sysmon EID 8/7; EDR thread/image-load | Remote thread start resolving to LoadLibraryW followed by `pwndll.dll` load from the injection sandbox; correlate with the preceding VM write. |
| 14 | 4 | SeDebugPrivilege plus LSASS access request | Windows Security 4703/token ETW; Sysmon EID 10; EDR credential-access | SeDebugPrivilege enable followed by access to real `lsass.exe` requesting `PROCESS_VM_READ`. Detection must not require an actual memory read, which this test never performs. |
| 15 | 5 | Synthetic `.qilin` encryption | Sysmon EID 11/23/26; EDR ransomware behavior | Rapid create/write/delete sequence for five documents, ciphertext with `.qilin` suffix, and `README-RECOVER.txt`, all beneath the test sandbox. |
| 16 | 5 | Recovery-inhibition commands | Sysmon EID 1; EDR command-line/D&R | `vssadmin delete shadows` and `bcdedit ... recoveryenabled no` in the same impact stage. Match command intent even though the nonexistent GUIDs make both operations fail harmlessly. |

## Lab Evidence — 2026-11-02, `lab-host-01`

The final run executed as `lab-operator` (administrator). Overall exit was **126 (PREVENTED)**.

| Stage | Outcome | Evidence |
|---|---|---|
| 1 — Discovery & Side-Load | Success (0) | Read-only discovery completed and the benign `msimg32.dll` image-load marker was produced. |
| 2 — BYOVD EDR-Killer | Success (0) | Both `NtLoadDriver` calls returned `0xC0000130`, the intended safe rejection. |
| 3 — svchost Injection | **Blocked (126)** | Starting the test-owned `svchost.exe` returned Windows error 5 before `OpenProcess`, `VirtualAllocEx`, `WriteProcessMemory`, or `CreateRemoteThread` executed. |
| 4 — LSASS Access | **Blocked (126)** | `OpenProcess` against LSASS PID 748 returned `ERROR_ACCESS_DENIED` with administrator context and SeDebugPrivilege enabled. No handle was granted and no memory was read. |
| 5 — Minimal Impact | Success (0) | Five synthetic files were encrypted with no denial/failure; `vssadmin` and `bcdedit` returned only their designed nonexistent-target failures. |

`bundle_results.json` records **five controls: two blocked, three succeeded, zero skipped**.
