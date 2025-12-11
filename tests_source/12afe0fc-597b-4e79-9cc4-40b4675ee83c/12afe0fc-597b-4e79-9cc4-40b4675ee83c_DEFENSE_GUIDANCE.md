# Defense Guidance: LimaCharlie Timeout Validation Harness

## Executive Summary

This document provides defensive guidance for detecting long-running processes and timeout evasion techniques as demonstrated by the **LimaCharlie Timeout Validation Harness** utility test. While this is a diagnostic test rather than a security simulation, the behaviors it exhibits (extended execution times, staged delays, and process sequencing) are commonly observed in sandbox evasion and timing-based attacks.

| Field | Value |
|-------|-------|
| **Test ID** | 12afe0fc-597b-4e79-9cc4-40b4675ee83c |
| **Test Name** | LimaCharlie Timeout Validation Harness |
| **MITRE ATT&CK** | [T1497.001 - Virtualization/Sandbox Evasion: System Checks](https://attack.mitre.org/techniques/T1497/001/) |
| **Tactic** | Defense Evasion (TA0005) |
| **Severity** | INFORMATIONAL |
| **Test Score** | 5.0/10 |
| **Test Type** | Utility / Diagnostic |

---

## Threat Overview

### Attack Description

The timing-based execution pattern demonstrated by this test mirrors techniques used by malware for sandbox evasion:

- **Extended Execution Times** - Malware often waits extended periods to outlast sandbox analysis windows
- **Staged Delays** - Breaking execution into multiple timed stages to evade behavioral analysis
- **Time-Based Evasion** - Checking system uptime, time acceleration, or sleep skipping to detect sandboxes

While this specific test is a utility for validating LimaCharlie's timeout parameter, the underlying behaviors are relevant for detecting real-world sandbox evasion techniques.

### Test Architecture

```
+--------------------------------------------------------------------+
|           Main Orchestrator (12afe0fc-*.exe)                        |
|                                                                     |
|   Embeds 3 signed stage binaries:                                  |
|   +-------------------------------------------------------------+  |
|   | Stage 1: stage-T1497.001-1.exe                              |  |
|   | - Waits 120 seconds (2 minutes)                             |  |
|   | - Logs progress every 30 seconds                            |  |
|   | - Exits with code 101                                       |  |
|   +-------------------------------------------------------------+  |
|                          |                                          |
|                          v                                          |
|   +-------------------------------------------------------------+  |
|   | Stage 2: stage-T1497.001-2.exe                              |  |
|   | - Waits 120 seconds (2 minutes)                             |  |
|   | - Logs progress every 30 seconds                            |  |
|   | - Exits with code 101                                       |  |
|   +-------------------------------------------------------------+  |
|                          |                                          |
|                          v                                          |
|   +-------------------------------------------------------------+  |
|   | Stage 3: stage-T1497.001-3.exe                              |  |
|   | - Waits 120 seconds (2 minutes)                             |  |
|   | - Logs progress every 30 seconds                            |  |
|   | - Exits with code 101                                       |  |
|   +-------------------------------------------------------------+  |
|                          |                                          |
|                          v                                          |
|   Total Runtime: ~6 minutes                                         |
|   Final Exit Code: 101                                              |
+--------------------------------------------------------------------+
```

### Behavioral Indicators

| Phase | Behavior | Duration | Exit Code |
|-------|----------|----------|-----------|
| Binary Extraction | Drops 3 stage binaries to `c:\F0` | Immediate | N/A |
| Stage 1 | Sleeps with periodic logging | 120 seconds | 101 |
| Stage 2 | Sleeps with periodic logging | 120 seconds | 101 |
| Stage 3 | Sleeps with periodic logging | 120 seconds | 101 |
| Completion | Final status and cleanup | Immediate | 101 |

---

## MITRE ATT&CK Mapping

### Technique Details

| Field | Value |
|-------|-------|
| **Technique ID** | T1497.001 |
| **Technique Name** | Virtualization/Sandbox Evasion: System Checks |
| **Tactic** | Defense Evasion (TA0005) |
| **Platforms** | Windows, Linux, macOS |
| **Permissions Required** | User |
| **Data Sources** | Process, Command, Sensor Health |

### Applicable Mitigations

**Note:** According to MITRE ATT&CK, "This type of attack technique cannot be easily mitigated with preventive controls since it is based on the abuse of system features."

However, detection-focused mitigations are valuable:

| M-Code | Mitigation | Implementation |
|--------|------------|----------------|
| **M1047** | Audit | Monitor for long-running processes with extended sleep patterns |
| **M1040** | Behavior Prevention on Endpoint | Detect timing anomalies and staged execution patterns |
| **-** | Detection Engineering | Create rules for sequential child process execution with delays |

---

## Detection Strategy

### Detection Priority Matrix

| Detection Layer | Priority | Confidence | Notes |
|-----------------|----------|------------|-------|
| Long-Running Process Detection | P2 | MEDIUM | May have false positives from legitimate apps |
| Sequential Child Process Execution | P2 | MEDIUM | Parent-child timing correlation |
| Extended Sleep Calls | P3 | LOW | Requires kernel/API monitoring |
| F0 Directory File Activity | P1 | HIGH | F0RT1KA framework specific |
| Process Lifetime Anomalies | P2 | MEDIUM | Statistical baseline required |

### Detection Files

| File | Purpose | Format |
|------|---------|--------|
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c_detections.kql` | Microsoft Sentinel/Defender queries | KQL |
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c_rules.yar` | File/memory detection | YARA |
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c_dr_rules.yaml` | LimaCharlie D&R rules | YAML |

---

## Detection Rules Summary

### KQL Queries (Microsoft Sentinel/Defender)

#### 1. Long-Running Process Detection
**Confidence:** MEDIUM | **Severity:** Low-Medium

Detects processes that run for extended periods (5+ minutes), which may indicate sandbox evasion or long-running malware.

```kql
DeviceProcessEvents
| where TimeGenerated > ago(1h)
| where ProcessCreationTime < ago(5m)
| summarize Duration = max(TimeGenerated) - min(ProcessCreationTime) by DeviceName, FileName
| where Duration > timespan(5m)
```

#### 2. Sequential Stage Binary Execution
**Confidence:** MEDIUM-HIGH | **Severity:** Medium

Detects parent processes that spawn multiple child processes with significant delays between them.

#### 3. F0 Directory Activity
**Confidence:** HIGH | **Severity:** High (for F0RT1KA tests)

Detects file operations in the `c:\F0` directory used by F0RT1KA framework.

#### 4. Process with Extended Sleep Pattern
**Confidence:** MEDIUM | **Severity:** Low-Medium

Detects processes that exhibit timing-based behavior patterns.

### YARA Rules

| Rule Name | Purpose | Confidence |
|-----------|---------|------------|
| `Timeout_Evasion_Tool_Generic` | Generic timing-based tool detection | MEDIUM |
| `LimaCharlie_Timeout_Harness` | Specific test detection | HIGH |
| `Go_Sleep_Loop_Pattern` | Go binaries with sleep loops | LOW-MEDIUM |
| `Stage_Binary_Pattern` | Multi-stage execution pattern | MEDIUM |

### LimaCharlie D&R Rules

| Rule Name | Trigger | Confidence |
|-----------|---------|------------|
| `long-running-process-detection` | Process running > 5 minutes | MEDIUM |
| `f0-directory-file-activity` | File activity in c:\F0 | HIGH |
| `sequential-child-process-execution` | Multiple child processes with delays | MEDIUM |
| `timeout-validation-harness-execution` | Specific test execution | HIGH |

---

## Hardening Guidance

### Quick Implementation

Run the provided PowerShell hardening script with Administrator privileges:

```powershell
# Apply all hardening settings
.\12afe0fc-597b-4e79-9cc4-40b4675ee83c_hardening.ps1

# Preview changes without applying
.\12afe0fc-597b-4e79-9cc4-40b4675ee83c_hardening.ps1 -WhatIf

# Revert changes
.\12afe0fc-597b-4e79-9cc4-40b4675ee83c_hardening.ps1 -Undo
```

### Hardening Components

#### 1. Enable Process Creation Auditing (M1047)

**Purpose:** Capture detailed process creation events for timing analysis

**Implementation:**
```powershell
# Enable process creation auditing
auditpol /set /subcategory:"Process Creation" /success:enable

# Enable command line logging
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit" `
    -Name "ProcessCreationIncludeCmdLine_Enabled" -Value 1 -Type DWord
```

**Events Generated:**
| Event ID | Description |
|----------|-------------|
| 4688 | Process creation with command line |
| 4689 | Process termination |

#### 2. Enable Sysmon Detailed Logging

**Purpose:** Capture process timing and parent-child relationships

**Recommended Sysmon Events:**
| Event ID | Description | Value |
|----------|-------------|-------|
| 1 | Process Create | Captures execution time |
| 5 | Process Terminated | Enables duration calculation |
| 10 | ProcessAccess | Detects process enumeration |

#### 3. Configure Windows Defender Behavioral Monitoring

**Purpose:** Detect sandbox evasion patterns

```powershell
# Enable Behavior Monitoring
Set-MpPreference -DisableBehaviorMonitoring $false

# Enable Real-Time Protection
Set-MpPreference -DisableRealtimeMonitoring $false

# Enable Cloud Protection
Set-MpPreference -MAPSReporting Advanced
```

#### 4. Directory Monitoring

**Purpose:** Monitor the F0RT1KA working directory

```powershell
# Create audit rule for c:\F0 directory
$path = "c:\F0"
if (Test-Path $path) {
    $acl = Get-Acl $path
    $rule = New-Object System.Security.AccessControl.FileSystemAuditRule(
        "Everyone", "Write,Delete,CreateFiles", "ContainerInherit,ObjectInherit",
        "None", "Success,Failure"
    )
    $acl.AddAuditRule($rule)
    Set-Acl $path $acl
}
```

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 12afe0fc-597b-4e79-9cc4-40b4675ee83c |
| **MITRE ATT&CK** | T1497.001 |
| **Severity** | LOW (utility test) |
| **Estimated Response Time** | 15-30 minutes |

### 1. Detection Triggers

| Alert Name | Trigger Criteria | Priority |
|------------|------------------|----------|
| Long-Running Process | Process duration > 5 minutes | P3 |
| F0 Directory Activity | File operations in c:\F0 | P2 |
| Sequential Stage Execution | Multiple child processes with delays | P3 |
| Timeout Harness Detection | Specific binary signature | P2 |

### 2. Initial Triage (First 5 minutes)

- [ ] **Verify alert is not a scheduled F0RT1KA test** (check for test framework indicators)
- [ ] **Determine scope** - Single host or multiple?
- [ ] **Check execution context** - Legitimate testing or unexpected?
- [ ] **Review parent process** - Was this launched from expected source?

**Triage Questions:**
1. Is this a scheduled security test or infrastructure validation?
2. Does the file path contain `c:\F0` (F0RT1KA framework)?
3. What is the parent process of the long-running executable?

### 3. Containment (15 minutes)

#### Immediate Actions

- [ ] **Identify the process tree**
```powershell
# Get process and children
Get-Process | Where-Object {$_.Id -eq <PID>} | Format-List *
Get-WmiObject Win32_Process | Where-Object {$_.ParentProcessId -eq <PID>}
```

- [ ] **Check process duration**
```powershell
# Calculate process runtime
$proc = Get-Process -Id <PID>
$runtime = (Get-Date) - $proc.StartTime
Write-Host "Process running for: $runtime"
```

- [ ] **Preserve volatile evidence**
```powershell
# Create IR folder
$irPath = "C:\IR\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -Path $irPath -ItemType Directory -Force

# Capture running processes
Get-Process | Export-Csv "$irPath\processes.csv" -NoTypeInformation

# Capture process tree
Get-WmiObject Win32_Process |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate |
    Export-Csv "$irPath\process_tree.csv" -NoTypeInformation
```

### 4. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Test execution logs | `c:\F0\test_execution_log.json` | `Copy-Item "c:\F0\*" -Destination "C:\IR\F0_artifacts\" -Recurse` |
| Stage binaries | `c:\F0\stage-T1497.001-*.exe` | Preserve for analysis |
| Process dumps | Memory | `procdump -ma <pid> C:\IR\` |
| Event logs | System | `wevtutil epl Security C:\IR\Security.evtx` |

#### Timeline Generation
```powershell
# Export relevant event logs
$logs = @("Security", "System", "Microsoft-Windows-Sysmon/Operational")
foreach ($log in $logs) {
    wevtutil epl $log "C:\IR\$($log -replace '/','-').evtx"
}

# Query process creation events for timeline
Get-WinEvent -FilterHashtable @{
    LogName = 'Security'
    ID = 4688
    StartTime = (Get-Date).AddHours(-2)
} | Export-Csv "C:\IR\process_creation_events.csv" -NoTypeInformation
```

### 5. Eradication

#### File Removal
```powershell
# Remove test artifacts (AFTER evidence collection)
Remove-Item -Path "c:\F0\stage-T1497.001-*.exe" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "c:\F0\test_execution_log.json" -Force -ErrorAction SilentlyContinue
```

#### Process Termination
```powershell
# Terminate long-running test processes if needed
Get-Process | Where-Object {$_.Path -like "*c:\F0*"} | Stop-Process -Force
```

### 6. Recovery

#### System Restoration Checklist

- [ ] Verify all test artifacts removed
- [ ] Confirm no persistence mechanisms created
- [ ] Validate system performance returned to normal
- [ ] Review EDR/AV connectivity

#### Validation Commands
```powershell
# Verify F0 directory is clean
Get-ChildItem "c:\F0\" -ErrorAction SilentlyContinue

# Verify no test processes running
Get-Process | Where-Object {$_.Path -like "*stage-T1497*"}

# Verify system resources normal
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, CPU, WorkingSet64
```

### 7. Post-Incident

#### Lessons Learned Questions

1. How was the long-running process detected?
2. Was the detection timely (within test window)?
3. What baseline is needed for process duration alerts?
4. Are timeout settings appropriate for security testing?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Implement process duration anomaly detection | MEDIUM |
| Prevention | Consider process execution time limits for untrusted binaries | LOW |
| Monitoring | Add F0 directory monitoring to SIEM | HIGH |
| Response | Pre-stage IR collection scripts for process analysis | MEDIUM |

---

## Detection Testing

### Validation Steps

1. **Deploy detection rules** to your SIEM/EDR
2. **Run F0RT1KA test** on a monitored endpoint with appropriate timeout
3. **Verify alerts fire** within expected timeframes
4. **Tune false positives** based on your environment

### Expected Alert Timeline

| Phase | Expected Alert | Timing |
|-------|----------------|--------|
| Binary Extraction | File creation in c:\F0\ | Immediate |
| Process Execution | NEW_PROCESS event | Immediate |
| Stage 1 Start | Child process creation | ~0 seconds |
| Stage 1 Duration Alert | Long-running process | ~2 minutes |
| Stage 2 Start | Child process creation | ~2 minutes |
| Stage 3 Start | Child process creation | ~4 minutes |
| Test Completion | Process termination | ~6 minutes |

---

## References

### MITRE ATT&CK
- [T1497.001 - Virtualization/Sandbox Evasion: System Checks](https://attack.mitre.org/techniques/T1497/001/)
- [M1047 - Audit](https://attack.mitre.org/mitigations/M1047/)

### Technical Documentation
- [LimaCharlie Endpoint Commands](https://docs.limacharlie.io/docs/reference-endpoint-agent-commands)
- [LimaCharlie Payloads](https://docs.limacharlie.io/v1/docs/sensor-commands-payloads)
- [Windows Process Monitoring](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/audit-process-creation)

### Industry Research
- [Sandbox Evasion Techniques](https://attack.mitre.org/techniques/T1497/)
- [Timing-Based Malware Detection](https://www.sans.org/white-papers/)

---

## Files Included

| File | Description |
|------|-------------|
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c_DEFENSE_GUIDANCE.md` | This comprehensive defense document |
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c_detections.kql` | KQL queries for Microsoft Sentinel/Defender |
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c_rules.yar` | YARA rules for file/memory detection |
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c_dr_rules.yaml` | LimaCharlie D&R rules |
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-07*
