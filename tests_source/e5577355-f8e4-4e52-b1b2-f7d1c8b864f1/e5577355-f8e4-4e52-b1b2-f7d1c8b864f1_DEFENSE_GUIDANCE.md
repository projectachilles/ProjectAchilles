# Defense Guidance: SilentButDeadly WFP EDR Network Isolation

## Executive Summary

This document provides comprehensive defense guidance for protecting against the **SilentButDeadly** Windows Filtering Platform (WFP) EDR network isolation technique. This attack uses legitimate Windows APIs to block security software network communications without terminating processes, making it particularly stealthy and difficult to detect.

| Field | Value |
|-------|-------|
| **Test ID** | e5577355-f8e4-4e52-b1b2-f7d1c8b864f1 |
| **Test Name** | SilentButDeadly WFP EDR Network Isolation |
| **MITRE ATT&CK** | [T1562.001 - Impair Defenses: Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/) |
| **Tactic** | Defense Evasion (TA0005) |
| **Severity** | HIGH |
| **Test Score** | 9.2/10 |

---

## Threat Overview

### Attack Description

The SilentButDeadly technique exploits the Windows Filtering Platform (WFP) to create network filters that block EDR/AV cloud communications. Unlike traditional EDR-killing techniques, this approach:

- **Does not terminate security processes** - Avoiding process termination alerts
- **Uses legitimate Windows APIs** - Harder to distinguish from normal operations
- **Targets cloud connectivity** - Disrupts telemetry, threat intelligence, and response capabilities
- **Is non-persistent** - Filters are session-bound and removed on process exit

### Attack Flow

```
[1] Tool Execution (Elevated)
         |
         v
[2] EDR Process Enumeration (CreateToolhelp32Snapshot)
         |
         v
[3] WFP Engine Initialization (FwpmEngineOpen0)
         |
         v
[4] Provider/Sublayer Creation (FwpmProviderAdd0, FwpmSubLayerAdd0)
         |
         v
[5] Filter Creation Per EDR Process (FwpmFilterAdd0)
    - FWPM_LAYER_ALE_AUTH_CONNECT_V4/V6 (outbound)
    - FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4/V6 (inbound)
         |
         v
[6] EDR Network Isolation Active (~30 seconds)
         |
         v
[7] Cleanup on Exit (session-bound filters removed)
```

### Targeted Security Software

The technique targets network communications of 14+ major EDR/AV products:

| Vendor | Process Names |
|--------|---------------|
| SentinelOne | SentinelAgent.exe, SentinelServiceHost.exe |
| CrowdStrike | CSFalconService.exe, CSFalconContainer.exe |
| Windows Defender | MsMpEng.exe, MpCmdRun.exe, MsSense.exe |
| Carbon Black | RepMgr.exe, RepWAC.exe, RepUtils.exe |
| Cylance | CylanceSvc.exe, CylanceUI.exe |
| Symantec | ccSvcHst.exe, Rtvscan.exe |
| McAfee | McShield.exe, McAfeeFramework.exe |
| Trend Micro | PccNTMon.exe, TMBMSRV.exe |
| Sophos | SavService.exe, SAVAdminService.exe |
| Kaspersky | avp.exe, kavtray.exe |
| ESET | ekrn.exe, egui.exe |
| Palo Alto Cortex | CortexXDR.exe, cyserver.exe |
| FireEye/Trellix | xagt.exe, FireEyeAgent.exe |
| Elastic Security | elastic-endpoint.exe, elastic-agent.exe |

---

## MITRE ATT&CK Mapping

### Technique Details

| Field | Value |
|-------|-------|
| **Technique ID** | T1562.001 |
| **Technique Name** | Impair Defenses: Disable or Modify Tools |
| **Tactic** | Defense Evasion (TA0005) |
| **Platforms** | Windows |
| **Permissions Required** | Administrator |
| **Data Sources** | Process, Windows Registry, Command, Sensor Health |

### Applicable Mitigations

| M-Code | Mitigation | Implementation |
|--------|------------|----------------|
| **M1047** | Audit | Enable WFP audit logging (Event IDs 5441, 5157, 5152) |
| **M1038** | Execution Prevention | Block untrusted executables via AppLocker/WDAC |
| **M1022** | Restrict File and Directory Permissions | Protect security software directories |
| **M1024** | Restrict Registry Permissions | Protect security service registry keys |
| **M1018** | User Account Management | Limit administrator privileges |

---

## Detection Strategy

### Detection Priority Matrix

| Detection Layer | Priority | Confidence | Notes |
|-----------------|----------|------------|-------|
| WFP Filter Events (Event ID 5441) | P1 | HIGH | Direct evidence of filter creation |
| WFP Blocked Connection Events | P1 | HIGH | EDR-specific blocked connections |
| EDR Telemetry Gap | P2 | MEDIUM-HIGH | Requires baseline |
| Process Enumeration | P3 | MEDIUM | May have false positives |
| Known Tool Signatures | P1 | HIGH | File/memory based |

### Detection Files

| File | Purpose | Format |
|------|---------|--------|
| `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_detections.kql` | Microsoft Sentinel/Defender queries | KQL |
| `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_rules.yar` | File/memory detection | YARA |
| `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_dr_rules.yaml` | LimaCharlie D&R rules | YAML |

---

## Detection Rules Summary

### KQL Queries (Microsoft Sentinel/Defender)

#### 1. WFP Filter Addition Events - EDR Process Targeting
**Confidence:** HIGH | **Severity:** High

Detects WFP filter creation (Event ID 5441) that targets security software processes.

```kql
SecurityEvent
| where EventID == 5441  // WFP filter added
| where EventData has_any ("SentinelAgent", "CSFalcon", "MsMpEng", ...)
| summarize FilterCount=count() by Computer, Account
| where FilterCount >= 3
```

#### 2. WFP Blocked Connections FROM EDR Processes
**Confidence:** HIGH | **Severity:** High-Critical

Detects when WFP blocks network traffic from security software (Event IDs 5157, 5152).

#### 3. EDR Telemetry Gap Detection
**Confidence:** MEDIUM-HIGH | **Severity:** Medium-Critical

Detects sudden loss of EDR heartbeat/telemetry from active endpoints.

#### 4. Process Enumeration of Security Software
**Confidence:** MEDIUM | **Severity:** Medium

Detects enumeration of EDR/AV processes (reconnaissance phase).

#### 5. Combined Behavioral Detection
**Confidence:** HIGH | **Severity:** Critical

Correlates multiple indicators for high-confidence detection.

### YARA Rules

| Rule Name | Purpose | Confidence |
|-----------|---------|------------|
| `WFP_EDR_Isolation_Tool_Generic` | Generic WFP EDR isolation tool detection | HIGH |
| `SilentButDeadly_Tool` | SilentButDeadly specific detection | HIGH |
| `EDRSilencer_Tool` | EDRSilencer and variants | HIGH |
| `WFP_Suspicious_Imports` | Binaries importing WFP functions | MEDIUM |
| `Go_WFP_Tool` | Go-compiled WFP tools | MEDIUM |
| `PowerShell_WFP_EDR_Block` | PowerShell WFP scripts | MEDIUM |

### LimaCharlie D&R Rules

| Rule Name | Trigger | Confidence |
|-----------|---------|------------|
| `wfp-edr-isolation-tool-execution` | NEW_PROCESS matching tool patterns | HIGH |
| `edr-process-enumeration` | Security software enumeration | MEDIUM |
| `firewall-block-edr` | Firewall rules blocking EDR | HIGH |
| `defender-config-tampering` | Defender registry modification | HIGH |

---

## Hardening Guidance

### Quick Implementation

Run the provided PowerShell hardening script with Administrator privileges:

```powershell
# Apply all hardening settings
.\e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_hardening.ps1

# Preview changes without applying
.\e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_hardening.ps1 -WhatIf

# Revert changes
.\e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_hardening.ps1 -Undo
```

### Hardening Components

#### 1. Enable WFP Audit Logging (M1047)

**Purpose:** Capture WFP filter creation and blocking events

**Implementation:**
```powershell
# Enable Filtering Platform Connection auditing
auditpol /set /subcategory:"Filtering Platform Connection" /success:enable /failure:enable

# Enable Filtering Platform Policy Change auditing
auditpol /set /subcategory:"Filtering Platform Policy Change" /success:enable /failure:enable
```

**Verification:**
```powershell
auditpol /get /subcategory:"Filtering Platform Connection"
auditpol /get /subcategory:"Filtering Platform Policy Change"
```

**Events Generated:**
| Event ID | Description |
|----------|-------------|
| 5441 | WFP filter added |
| 5442 | WFP filter removed |
| 5156 | WFP permitted connection |
| 5157 | WFP blocked connection |

#### 2. Attack Surface Reduction Rules (M1038)

**Purpose:** Block common attack vectors

**Key ASR Rules:**
| GUID | Rule |
|------|------|
| D1E49AAC-8F56-4280-B9BA-993A6D77406C | Block process creations from PSExec/WMI |
| 56A863A9-875E-4185-98A7-B882C64B5CE5 | Block abuse of vulnerable signed drivers |
| E6DB77E5-3DF2-4CF1-B95A-636979351E5B | Block WMI event subscription persistence |

**Implementation:**
```powershell
Set-MpPreference -AttackSurfaceReductionRules_Ids "D1E49AAC-8F56-4280-B9BA-993A6D77406C" -AttackSurfaceReductionRules_Actions 1
```

#### 3. Windows Defender Protection

**Purpose:** Prevent security configuration tampering

**Settings:**
```powershell
# Enable Real-Time Protection
Set-MpPreference -DisableRealtimeMonitoring $false

# Enable Cloud Protection
Set-MpPreference -MAPSReporting Advanced

# Enable Network Protection
Set-MpPreference -EnableNetworkProtection Enabled
```

#### 4. Firewall Hardening

**Purpose:** Enable logging and default blocking

```powershell
# Enable blocked connection logging
Set-NetFirewallProfile -Profile Domain,Private,Public `
    -LogBlocked True `
    -LogFileName "%SystemRoot%\System32\LogFiles\Firewall\pfirewall.log"
```

#### 5. Process Creation Auditing

**Purpose:** Detect attack tool execution

```powershell
# Enable process creation auditing
auditpol /set /subcategory:"Process Creation" /success:enable

# Enable command line logging
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit" `
    -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 1
```

### GPO Deployment

For enterprise deployment via Group Policy:

**Computer Configuration > Windows Settings > Security Settings > Advanced Audit Policy Configuration:**

| Category | Subcategory | Audit |
|----------|-------------|-------|
| Object Access | Filtering Platform Connection | Success, Failure |
| Object Access | Filtering Platform Policy Change | Success, Failure |
| Detailed Tracking | Process Creation | Success |

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | e5577355-f8e4-4e52-b1b2-f7d1c8b864f1 |
| **MITRE ATT&CK** | T1562.001 |
| **Severity** | HIGH |
| **Estimated Response Time** | 30-60 minutes |

### 1. Detection Triggers

| Alert Name | Trigger Criteria | Priority |
|------------|------------------|----------|
| WFP Filter Targeting EDR | Event ID 5441 with EDR process names | P1 |
| EDR Telemetry Gap | 10+ minutes missing from active endpoint | P2 |
| Known Tool Execution | SilentButDeadly/EDRSilencer detection | P1 |
| Firewall Block EDR | netsh/PowerShell creating block rules | P1 |

### 2. Initial Triage (First 5 minutes)

- [ ] **Verify alert is not a test execution** (check for F0RT1KA framework indicators)
- [ ] **Determine scope** - Single host or multiple?
- [ ] **Identify user account** - Legitimate admin or compromised?
- [ ] **Check timeline** - When did activity begin?

**Triage Questions:**
1. Is this a scheduled security test?
2. What is the parent process of the suspicious activity?
3. Are there other indicators of compromise on the host?

### 3. Containment (15-30 minutes)

#### Immediate Actions

- [ ] **Isolate affected host(s)**
```powershell
# Network isolation via Windows Firewall
netsh advfirewall set allprofiles firewallpolicy blockinbound,blockoutbound

# Or use EDR isolation capability if available
```

- [ ] **Terminate malicious processes**
```powershell
# Kill suspicious process by name
Get-Process | Where-Object {$_.ProcessName -match "silent|edr.*silenc"} | Stop-Process -Force

# Kill by PID if known
Stop-Process -Id <PID> -Force
```

- [ ] **Remove WFP filters (if still active)**
```powershell
# List current WFP filters (requires netsh/PowerShell)
netsh wfp show filters

# Note: Session-bound filters are automatically removed when the attack process exits
```

- [ ] **Preserve volatile evidence**
```powershell
# Create IR folder
$irPath = "C:\IR\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -Path $irPath -ItemType Directory -Force

# Capture running processes
Get-Process | Export-Csv "$irPath\processes.csv" -NoTypeInformation

# Capture network connections
Get-NetTCPConnection | Export-Csv "$irPath\connections.csv" -NoTypeInformation

# Capture WFP state
netsh wfp show state > "$irPath\wfp_state.txt"
```

### 4. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Security Event Log | System | `wevtutil epl Security C:\IR\Security.evtx` |
| WFP Events | Security Log | Event IDs 5441, 5157, 5152 |
| Process Dumps | Memory | `procdump -ma <pid> C:\IR\` |
| Prefetch Files | `C:\Windows\Prefetch\` | `Copy-Item C:\Windows\Prefetch\* C:\IR\Prefetch\` |
| Attack Tool | Various | Preserve original binary |

#### Timeline Generation
```powershell
# Export relevant event logs
$logs = @("Security", "System", "Microsoft-Windows-Sysmon/Operational")
foreach ($log in $logs) {
    wevtutil epl $log "C:\IR\$($log -replace '/','-').evtx"
}

# Query WFP-specific events
Get-WinEvent -FilterHashtable @{
    LogName = 'Security'
    ID = 5441, 5157, 5152
    StartTime = (Get-Date).AddHours(-24)
} | Export-Csv "C:\IR\wfp_events.csv" -NoTypeInformation
```

### 5. Eradication

#### File Removal
```powershell
# Remove attack artifacts (AFTER evidence collection)
# Note: Adjust paths based on investigation findings
Remove-Item -Path "C:\path\to\malicious\*.exe" -Force
```

#### Verify EDR Connectivity
```powershell
# Verify EDR processes are running
Get-Process | Where-Object {$_.ProcessName -match "Sentinel|CSFalcon|MsMpEng"}

# Check Defender cloud connectivity
Test-NetConnection -ComputerName "wdcp.microsoft.com" -Port 443
```

### 6. Recovery

#### System Restoration Checklist

- [ ] Verify all malicious artifacts removed
- [ ] Confirm EDR cloud connectivity restored
- [ ] Validate WFP filter state is clean
- [ ] Re-enable security controls
- [ ] Reconnect to network

#### Validation Commands
```powershell
# Verify no malicious WFP filters
netsh wfp show filters | Select-String -Pattern "Sentinel|CSFalcon|MsMpEng"

# Verify Defender is functional
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, OnlineMode

# Test EDR connectivity (example for Defender)
(Invoke-WebRequest -Uri "https://www.microsoft.com/security/portal/definitions/adl.aspx" -UseBasicParsing).StatusCode
```

### 7. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which rule/alert triggered?)
2. What was the detection-to-containment time?
3. What enabled the attacker to execute with admin privileges?
4. What would have prevented this attack?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Enable WFP audit logging on all endpoints | HIGH |
| Prevention | Deploy ASR rules in Block mode | HIGH |
| Prevention | Implement application control (WDAC/AppLocker) | MEDIUM |
| Monitoring | Add EDR telemetry gap alerting | HIGH |
| Response | Pre-stage IR collection scripts | MEDIUM |

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
| Binary Extraction | File creation in c:\F0\ | Immediate |
| Process Execution | NEW_PROCESS event | Immediate |
| WFP Activity | Event ID 5441 (if logging enabled) | Within seconds |
| EDR Isolation | Blocked connection events | Within seconds |
| EDR Gap | Telemetry gap alert | 10+ minutes |

---

## References

### MITRE ATT&CK
- [T1562.001 - Impair Defenses: Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/)
- [M1047 - Audit](https://attack.mitre.org/mitigations/M1047/)
- [M1038 - Execution Prevention](https://attack.mitre.org/mitigations/M1038/)

### Technical Documentation
- [Windows Filtering Platform Documentation](https://docs.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-start-page)
- [SilentButDeadly GitHub Repository](https://github.com/loosehose/SilentButDeadly)

### Industry Research
- [Elastic Detection Rule: Potential Evasion via Windows Filtering Platform](https://detection.fyi/elastic/detection-rules/windows/defense_evasion_windows_filtering_platform/)
- [Sigma Rule: WFP Blocked Connection From EDR Agent Binary](https://detection.fyi/sigmahq/sigma/windows/builtin/security/object_access/win_security_wfp_endpoint_agent_blocked/)
- [VMRay: Detecting Windows Defender Tampering and YARA rule for EDR Silencer](https://www.vmray.com/detection-highlights-june-2024-detecting-windows-defender-tampering-and-yara-rule-for-edr-silencer/)

---

## Files Included

| File | Description |
|------|-------------|
| `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_DEFENSE_GUIDANCE.md` | This comprehensive defense document |
| `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_detections.kql` | KQL queries for Microsoft Sentinel/Defender |
| `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_rules.yar` | YARA rules for file/memory detection |
| `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_dr_rules.yaml` | LimaCharlie D&R rules |
| `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-06*
