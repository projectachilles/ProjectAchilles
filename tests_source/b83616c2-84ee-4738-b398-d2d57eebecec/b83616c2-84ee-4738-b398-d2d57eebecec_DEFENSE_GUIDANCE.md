# Defense Guidance: NativeDump (NimDump) LSASS Memory Dumping Detection

## Executive Summary

This document provides comprehensive defense guidance for protecting against the **NativeDump (NimDump) LSASS Memory Dumping Detection** test. NativeDump/NimDump is an advanced credential dumping tool that bypasses traditional detection methods by using only NTAPI functions and hand-crafting Minidump files without calling the well-known MiniDumpWriteDump API.

| Field | Value |
|-------|-------|
| **Test ID** | b83616c2-84ee-4738-b398-d2d57eebecec |
| **Test Name** | NativeDump (NimDump) Detection |
| **MITRE ATT&CK** | [T1003.001 - OS Credential Dumping: LSASS Memory](https://attack.mitre.org/techniques/T1003/001/) |
| **Tactic** | Credential Access (TA0006) |
| **Severity** | CRITICAL |
| **Test Score** | 7.7/10 |

---

## Threat Overview

### Attack Description

NativeDump (and its Nim language variant NimDump) represents an advanced credential theft technique that specifically evades common detection methods:

- **Uses only NTAPI functions** - Bypasses user-mode API hooks by calling ntdll.dll directly
- **Hand-crafts Minidump files** - Avoids detection that monitors for MiniDumpWriteDump calls
- **Can remap ntdll.dll** - Optionally unhooks security product API monitoring
- **Minimal dump format** - Creates only essential streams (SystemInfo, ModuleList, Memory64List)
- **Privilege escalation via NTAPI** - Uses NtOpenProcessToken and NtAdjustPrivilegeToken

### Attack Flow

```
[1] Binary Extraction
    |
    v
[2] Drop library_update.exe to c:\F0
    |
    v
[3] Wait 3 Seconds (Defensive Reaction Window)
    |
    v
[4] Check: File Quarantined?
    |
    +---> YES: Exit 105 (PROTECTED - File Quarantined)
    |
    +---> NO: Continue to Execution
          |
          v
[5] Execute: library_update.exe -r -o:c:\F0\document.docx
    |
    v
[6] NimDump Attempts:
    - Enable SeDebugPrivilege via NtAdjustPrivilegeToken
    - Open lsass.exe process with PROCESS_ALL_ACCESS
    - Enumerate process memory regions
    - Read LSASS memory via NtReadVirtualMemory
    - Write hand-crafted Minidump to document.docx
    |
    v
[7] Check: LSASS Dump Created?
    |
    +---> YES: Exit 101 (UNPROTECTED - LSASS Dumped)
    |
    +---> NO: Exit 126 (PROTECTED - Execution/Access Blocked)
```

### Real-World Context

LSASS credential dumping is one of the most prevalent techniques used by:

- **APT28 (Fancy Bear)** - Uses custom LSASS dumpers for credential theft
- **APT32 (OceanLotus)** - Deploys Mimikatz variants targeting LSASS
- **Wizard Spider** - Uses TrickBot and custom tools for LSASS dumping
- **Ransomware operators** - Harvest credentials for lateral movement before encryption
- **Most advanced threat actors** - LSASS is a prime target due to cached credentials

### Why NativeDump/NimDump is Dangerous

1. **Evades MiniDumpWriteDump monitoring** - Does not call the standard API
2. **Bypasses API hooking** - Uses NTAPI directly or can remap ntdll.dll
3. **Minimal file footprint** - Creates small, targeted dumps
4. **Cross-platform source** - Available in multiple languages (C#, Nim)
5. **Well-documented evasion** - Specifically designed to bypass EDR

---

## MITRE ATT&CK Mapping

### Technique Details

| Field | Value |
|-------|-------|
| **Technique ID** | T1003.001 |
| **Technique Name** | OS Credential Dumping: LSASS Memory |
| **Tactic** | Credential Access (TA0006) |
| **Platforms** | Windows |
| **Permissions Required** | Administrator, SYSTEM, SeDebugPrivilege |
| **Data Sources** | Process, Command, File |

### Applicable Mitigations

| M-Code | Mitigation | Implementation |
|--------|------------|----------------|
| **M1040** | Behavior Prevention on Endpoint | Enable Attack Surface Reduction (ASR) rules on Windows 10+ to secure LSASS |
| **M1043** | Credential Access Protection | Enable Credential Guard on Windows 10+ (requires hardware support) |
| **M1028** | Operating System Configuration | Disable or restrict NTLM; disable WDigest authentication |
| **M1027** | Password Policies | Use unique, complex passwords for local administrator accounts |
| **M1026** | Privileged Account Management | Limit local admin group membership; implement admin tiers |
| **M1025** | Privileged Process Integrity | Enable Protected Process Light (PPL) for LSA on Windows 8.1+ |
| **M1017** | User Training | Train users/admins on password hygiene and credential risks |

---

## Detection Strategy

### Detection Priority Matrix

| Detection Layer | Priority | Confidence | Notes |
|-----------------|----------|------------|-------|
| LSASS Process Access Monitoring | P1 | HIGH | Monitor for LSASS handle requests with suspicious access rights |
| SeDebugPrivilege Usage | P1 | HIGH | Detect privilege token manipulation for debug privilege |
| File Creation (dump files) | P2 | HIGH | Monitor for Minidump file creation |
| Process Memory Read Operations | P2 | MEDIUM-HIGH | NtReadVirtualMemory on LSASS |
| Binary Signature Detection | P2 | MEDIUM | Known NativeDump/NimDump signatures |
| Suspicious Process Execution | P3 | MEDIUM | Non-standard binaries accessing LSASS |

### Detection Files

| File | Purpose | Format |
|------|---------|--------|
| `b83616c2-84ee-4738-b398-d2d57eebecec_detections.kql` | Microsoft Sentinel/Defender queries | KQL |
| `b83616c2-84ee-4738-b398-d2d57eebecec_rules.yar` | File/memory detection | YARA |
| `b83616c2-84ee-4738-b398-d2d57eebecec_dr_rules.yaml` | LimaCharlie D&R rules | YAML |

---

## Detection Rules Summary

### KQL Queries (Microsoft Sentinel/Defender)

#### 1. LSASS Process Access Detection
**Confidence:** HIGH | **Severity:** Critical

Detects processes attempting to open handles to lsass.exe with suspicious access rights (PROCESS_VM_READ, PROCESS_QUERY_INFORMATION, or full access).

```kql
DeviceProcessEvents
| where TimeGenerated > ago(1h)
| where FileName =~ "lsass.exe"
| where InitiatingProcessFileName !in~ ("csrss.exe", "services.exe", "svchost.exe", "MsMpEng.exe")
| project TimeGenerated, DeviceName, InitiatingProcessFileName, InitiatingProcessCommandLine
```

#### 2. SeDebugPrivilege Token Manipulation
**Confidence:** HIGH | **Severity:** Critical

Detects processes enabling SeDebugPrivilege, required for LSASS memory access.

#### 3. Suspicious Minidump File Creation
**Confidence:** HIGH | **Severity:** High

Detects creation of potential LSASS dump files based on file characteristics and naming patterns.

#### 4. NimDump/NativeDump Binary Detection
**Confidence:** HIGH | **Severity:** Critical

Detects known NativeDump and NimDump binary signatures and command-line patterns.

#### 5. NTAPI Direct Calls Detection
**Confidence:** MEDIUM-HIGH | **Severity:** High

Detects processes making direct NTAPI calls associated with credential dumping.

#### 6. Combined Behavioral Detection
**Confidence:** HIGH | **Severity:** Critical

Correlates multiple indicators for high-confidence LSASS dumping detection.

### YARA Rules

| Rule Name | Purpose | Confidence |
|-----------|---------|------------|
| `NimDump_LSASS_Dumper` | Detect NimDump binary signatures | HIGH |
| `NativeDump_Generic` | Detect NativeDump variants | HIGH |
| `LSASS_Dumper_NTAPI` | Detect NTAPI-based dumpers | MEDIUM-HIGH |
| `Minidump_Handcrafted` | Detect hand-crafted Minidump patterns | MEDIUM |
| `Credential_Dumper_Generic` | Generic credential tool detection | MEDIUM |

### LimaCharlie D&R Rules

| Rule Name | Trigger | Confidence |
|-----------|---------|------------|
| `lsass-memory-access` | SENSITIVE_PROCESS_ACCESS to lsass.exe | HIGH |
| `nimdump-execution` | NEW_PROCESS matching NimDump patterns | HIGH |
| `sedebugprivilege-enabled` | TOKEN_MODIFIED for debug privilege | HIGH |
| `minidump-file-creation` | FILE_CREATE of dump files | HIGH |
| `ntapi-credential-dumping` | Direct NTAPI call patterns | MEDIUM |

---

## Hardening Guidance

### Quick Implementation

Run the provided PowerShell hardening script with Administrator privileges:

```powershell
# Apply all hardening settings
.\b83616c2-84ee-4738-b398-d2d57eebecec_hardening.ps1

# Preview changes without applying
.\b83616c2-84ee-4738-b398-d2d57eebecec_hardening.ps1 -WhatIf

# Revert changes
.\b83616c2-84ee-4738-b398-d2d57eebecec_hardening.ps1 -Undo
```

### Hardening Components

#### 1. Enable LSA Protection / Protected Process Light (M1025)

**Purpose:** Prevent unauthorized access to LSASS memory

**Implementation:**
```powershell
# Enable LSA Protection (requires reboot)
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name "RunAsPPL" -Value 1 -Type DWord

# Verify setting
Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name "RunAsPPL"
```

**Registry Path:**
```
Path: HKLM\SYSTEM\CurrentControlSet\Control\Lsa
Name: RunAsPPL
Type: REG_DWORD
Value: 1
```

**Important:**
- Requires reboot to take effect
- Some security products may need compatibility updates
- Test in staging environment first

#### 2. Enable Credential Guard (M1043)

**Purpose:** Protect credentials using virtualization-based security

**Requirements:**
- Windows 10 Enterprise/Education or Windows Server 2016+
- UEFI firmware with Secure Boot
- Hardware virtualization (Intel VT-x or AMD-V)
- TPM 2.0 recommended

**Implementation:**
```powershell
# Enable via registry (requires Group Policy or UEFI)
# Enable Credential Guard
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard" -Name "EnableVirtualizationBasedSecurity" -Value 1 -Type DWord
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name "LsaCfgFlags" -Value 1 -Type DWord
```

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > System > Device Guard > Turn on Virtualization Based Security
Set: Credential Guard Configuration = Enabled with UEFI lock
```

#### 3. Attack Surface Reduction Rules (M1040)

**Purpose:** Block specific credential theft techniques

**Critical ASR Rules for LSASS Protection:**
```powershell
# Block credential stealing from LSASS
Set-MpPreference -AttackSurfaceReductionRules_Ids 9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2 -AttackSurfaceReductionRules_Actions 1

# Block process creations from PSExec and WMI
Set-MpPreference -AttackSurfaceReductionRules_Ids d1e49aac-8f56-4280-b9ba-993a6d77406c -AttackSurfaceReductionRules_Actions 1
```

#### 4. Disable WDigest Authentication (M1028)

**Purpose:** Prevent plaintext credential caching

**Implementation:**
```powershell
# Disable WDigest (credentials not stored in plaintext)
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest" -Name "UseLogonCredential" -Value 0 -Type DWord
```

#### 5. Restrict Debug Privileges (M1026)

**Purpose:** Limit who can enable SeDebugPrivilege

**Group Policy Path:**
```
Computer Configuration > Windows Settings > Security Settings > Local Policies > User Rights Assignment
Setting: Debug programs
Value: Remove all users except Administrators (or empty for highest security)
```

### GPO Deployment

For enterprise deployment via Group Policy:

**Computer Configuration > Administrative Templates:**

| Setting | Path | Value |
|---------|------|-------|
| LSA Protection | System > Local Security Authority | RunAsPPL = 1 |
| Credential Guard | System > Device Guard | Enabled with UEFI Lock |
| WDigest | (Registry policy) | UseLogonCredential = 0 |
| ASR Rules | Windows Defender > Attack Surface Reduction | Enable relevant rules |

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | b83616c2-84ee-4738-b398-d2d57eebecec |
| **MITRE ATT&CK** | T1003.001 |
| **Severity** | CRITICAL |
| **Estimated Response Time** | 45-90 minutes |

### 1. Detection Triggers

| Alert Name | Trigger Criteria | Priority |
|------------|------------------|----------|
| LSASS Access Attempt | Process opens handle to lsass.exe | P1 |
| SeDebugPrivilege Enabled | Token manipulation for debug privilege | P1 |
| Minidump File Created | Dump file written to disk | P1 |
| NimDump Binary Detected | Known signature or behavior | P1 |
| Suspicious Binary in c:\F0 | File creation in test directory | P2 |

### 2. Initial Triage (First 5 minutes)

- [ ] **Verify alert is not a scheduled test** (check for F0RT1KA framework indicators)
- [ ] **Determine scope** - Single host or multiple compromised?
- [ ] **Identify user context** - What account attempted the dump?
- [ ] **Check timeline** - When did LSASS access occur?

**Critical Triage Questions:**
1. Is this a scheduled security test execution?
2. Is the file located in `c:\F0\` (test directory)?
3. What process attempted to access LSASS?
4. Was a dump file successfully created?
5. Has the dump file been exfiltrated?

### 3. Containment (15-30 minutes)

#### Immediate Actions

- [ ] **Isolate affected host(s)**
```powershell
# Network isolation via Windows Firewall
netsh advfirewall set allprofiles firewallpolicy blockinbound,blockoutbound

# Or use EDR isolation capability
```

- [ ] **Terminate credential dumping process**
```powershell
# Kill by process name
Get-Process | Where-Object {$_.ProcessName -like "*library_update*"} | Stop-Process -Force

# Kill by path
Get-Process | Where-Object {$_.Path -like "C:\F0\*"} | Stop-Process -Force
```

- [ ] **Secure the dump file (if created)**
```powershell
# Move dump file to quarantine for analysis
$quarantine = "C:\IR\Quarantine\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -Path $quarantine -ItemType Directory -Force

# Quarantine any dump files
Get-ChildItem -Path "c:\F0" -Include "*.docx","*.dmp","*.bin" -Recurse |
    Move-Item -Destination $quarantine -Force
```

- [ ] **Preserve volatile evidence**
```powershell
# Create IR folder
$irPath = "C:\IR\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -Path $irPath -ItemType Directory -Force

# Capture running processes
Get-Process | Export-Csv "$irPath\processes.csv" -NoTypeInformation

# Capture open handles to LSASS
handle.exe -p lsass.exe > "$irPath\lsass_handles.txt"

# Capture token privileges
whoami /priv > "$irPath\current_privileges.txt"
```

### 4. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Dump file | `c:\F0\document.docx` (or other paths) | `Copy-Item "c:\F0\*" "C:\IR\artifacts\"` |
| Dumping binary | `c:\F0\library_update.exe` | `Copy-Item` + hash |
| Test execution logs | `c:\F0\*_log.json` | `Copy-Item` |
| Process memory | Memory | `procdump -ma <pid> C:\IR\` |
| Security event logs | System | `wevtutil epl Security C:\IR\Security.evtx` |
| Sysmon logs | System | `wevtutil epl "Microsoft-Windows-Sysmon/Operational" C:\IR\Sysmon.evtx` |
| Prefetch files | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\LIBRARY*" "C:\IR\Prefetch\"` |

#### Memory Acquisition
```powershell
# Using WinPMEM (if available)
.\winpmem_mini_x64.exe C:\IR\memory.raw

# Note: Critical for analyzing in-memory credentials
```

#### Timeline Generation
```powershell
# Export relevant event logs
$logs = @(
    "Security",
    "System",
    "Microsoft-Windows-Sysmon/Operational",
    "Microsoft-Windows-PowerShell/Operational"
)
foreach ($log in $logs) {
    try {
        wevtutil epl $log "C:\IR\$($log -replace '/','-').evtx"
    } catch {
        Write-Warning "Could not export $log"
    }
}

# Query LSASS access events (Sysmon Event ID 10)
Get-WinEvent -FilterHashtable @{
    LogName = 'Microsoft-Windows-Sysmon/Operational'
    ID = 10
    StartTime = (Get-Date).AddHours(-24)
} | Where-Object { $_.Message -match "lsass" } |
    Export-Csv "C:\IR\lsass_access_events.csv" -NoTypeInformation
```

### 5. Eradication

#### File Removal
```powershell
# Remove attack artifacts (AFTER evidence collection)
Remove-Item -Path "c:\F0\library_update.exe" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "c:\F0\document.docx" -Force -ErrorAction SilentlyContinue

# Clean up any other dropped files
Remove-Item -Path "c:\F0\*.dmp" -Force -ErrorAction SilentlyContinue
```

#### Credential Reset (CRITICAL)
```powershell
# If dump was successful, assume credentials are compromised
# Immediate actions:
# 1. Reset passwords for accounts logged into compromised host
# 2. Reset service accounts that were running on the host
# 3. Reset domain admin accounts if they accessed the host
# 4. Consider Kerberos ticket invalidation (krbtgt reset for severe cases)
```

#### Verify Removal
```powershell
# Verify binary is removed
Test-Path "c:\F0\library_update.exe"  # Should return False

# Verify dump file is removed
Test-Path "c:\F0\document.docx"  # Should return False

# Verify no persistence
Get-ScheduledTask | Where-Object {$_.Actions.Execute -like "*library*"}
Get-Service | Where-Object {$_.BinaryPathName -like "*library*"}
```

### 6. Recovery

#### System Restoration Checklist

- [ ] Verify all malicious artifacts removed
- [ ] Confirm no persistence mechanisms remain
- [ ] Enable/verify LSA Protection (PPL)
- [ ] Enable/verify Credential Guard (if supported)
- [ ] Reset all potentially compromised credentials
- [ ] Update security signatures
- [ ] Re-enable network connectivity
- [ ] Monitor for reinfection

#### Validation Commands
```powershell
# Verify LSA Protection is enabled
Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name "RunAsPPL" -ErrorAction SilentlyContinue

# Verify Defender is functional
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, BehaviorMonitorEnabled

# Verify no suspicious processes accessing LSASS
Get-Process lsass | Select-Object -ExpandProperty Id | ForEach-Object {
    handle.exe -p $_ 2>&1
}

# Verify WDigest is disabled
Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest" -Name "UseLogonCredential" -ErrorAction SilentlyContinue
```

### 7. Post-Incident

#### Lessons Learned Questions

1. How was the credential dumping attempt detected?
2. What was the detection-to-containment time?
3. Was LSA Protection (PPL) enabled?
4. Was Credential Guard enabled?
5. Were any credentials successfully stolen?
6. What lateral movement occurred after credential theft?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Prevention | Enable LSA Protection (RunAsPPL) | CRITICAL |
| Prevention | Deploy Credential Guard | HIGH |
| Prevention | Disable WDigest authentication | HIGH |
| Detection | Deploy Sysmon with LSASS access logging | HIGH |
| Detection | Enable ASR rule for LSASS protection | HIGH |
| Detection | Implement YARA rules for NativeDump variants | MEDIUM |
| Response | Pre-stage memory forensic tools | MEDIUM |
| Response | Document credential reset procedures | HIGH |

---

## Detection Testing

### Validation Steps

1. **Deploy detection rules** to your SIEM/EDR
2. **Run F0RT1KA test** on a monitored endpoint
3. **Verify alerts fire** within expected timeframes
4. **Tune false positives** based on your environment

### Expected Alert Timeline

| Phase | Expected Alert | Timing |
|-------|----------------|--------|
| Binary Extraction | File creation in `c:\F0\` | Immediate |
| File Detection | Signature/heuristic alert | Within 3 seconds |
| Process Execution | NEW_PROCESS event | If file not quarantined |
| LSASS Access | SENSITIVE_PROCESS_ACCESS alert | At execution |
| Dump File Creation | FILE_CREATE alert | If not blocked |

---

## References

### MITRE ATT&CK
- [T1003.001 - OS Credential Dumping: LSASS Memory](https://attack.mitre.org/techniques/T1003/001/)
- [M1040 - Behavior Prevention on Endpoint](https://attack.mitre.org/mitigations/M1040/)
- [M1043 - Credential Access Protection](https://attack.mitre.org/mitigations/M1043/)
- [M1025 - Privileged Process Integrity](https://attack.mitre.org/mitigations/M1025/)
- [M1028 - Operating System Configuration](https://attack.mitre.org/mitigations/M1028/)
- [M1026 - Privileged Account Management](https://attack.mitre.org/mitigations/M1026/)

### Technical Documentation
- [NativeDump GitHub Repository](https://github.com/ricardojoserf/NativeDump)
- [NimDump (Nim Flavor)](https://github.com/ricardojoserf/NativeDump/tree/nim-flavour)
- [Microsoft - Configuring LSA Protection](https://docs.microsoft.com/en-us/windows-server/security/credentials-protection-and-management/configuring-additional-lsa-protection)
- [Microsoft - Credential Guard](https://docs.microsoft.com/en-us/windows/security/identity-protection/credential-guard/credential-guard)

### Industry Research
- [Microsoft - Defending Against Credential Dumping](https://www.microsoft.com/security/blog/2022/10/05/detecting-and-preventing-lsass-credential-dumping-attacks/)
- [CISA - LSASS Credential Dumping Guidance](https://www.cisa.gov/)

---

## Files Included

| File | Description |
|------|-------------|
| `b83616c2-84ee-4738-b398-d2d57eebecec_DEFENSE_GUIDANCE.md` | This comprehensive defense document |
| `b83616c2-84ee-4738-b398-d2d57eebecec_detections.kql` | KQL queries for Microsoft Sentinel/Defender |
| `b83616c2-84ee-4738-b398-d2d57eebecec_rules.yar` | YARA rules for file/memory detection |
| `b83616c2-84ee-4738-b398-d2d57eebecec_dr_rules.yaml` | LimaCharlie D&R rules |
| `b83616c2-84ee-4738-b398-d2d57eebecec_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-07*
