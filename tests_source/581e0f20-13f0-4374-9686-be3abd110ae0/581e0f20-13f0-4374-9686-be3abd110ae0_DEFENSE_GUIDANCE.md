# Defense Guidance: Ransomware Encryption via BitLocker

## Executive Summary

This document provides comprehensive defense guidance for detecting, preventing, and responding to BitLocker-based ransomware attacks as simulated by F0RT1KA security test `581e0f20-13f0-4374-9686-be3abd110ae0`.

**Attack Overview**: This test simulates a 3-stage ransomware attack that leverages Windows BitLocker for data encryption, based on NCC Group research. Unlike traditional ransomware using custom encryption, BitLocker-based attacks abuse a legitimate Windows feature, making detection more challenging.

**Severity**: Critical

**MITRE ATT&CK Techniques**:
- T1070.001 - Clear Windows Event Logs (Defense Evasion)
- T1562.004 - Disable or Modify System Firewall (Defense Evasion)
- T1082 - System Information Discovery (Discovery)
- T1083 - File and Directory Discovery (Discovery)
- T1486 - Data Encrypted for Impact (Impact)
- T1490 - Inhibit System Recovery (Impact)

---

## Threat Overview

### Attack Chain Summary

| Stage | Phase | Techniques | Description |
|-------|-------|------------|-------------|
| 1 | Defense Evasion | T1070.001, T1562.004 | Clear event logs, manipulate firewall rules |
| 2 | Discovery | T1082, T1083 | Enumerate system information, check BitLocker availability |
| 3 | Impact | T1486, T1490 | BitLocker encryption, VSS shadow deletion |

### Key Indicators of Compromise (IOCs)

**Process Execution**:
| Process | Command Pattern | Technique |
|---------|-----------------|-----------|
| `wevtutil.exe` | `wevtutil cl <logname>` | T1070.001 |
| `netsh.exe` | `netsh advfirewall firewall add/delete rule` | T1562.004 |
| `wmic.exe` | `wmic computersystem get`, `wmic os get`, `wmic logicaldisk get` | T1082, T1083 |
| `manage-bde.exe` | `manage-bde -on <drive> -Password` | T1486 |
| `diskpart.exe` | VHD creation and mounting | T1486 |
| `vssadmin.exe` | `vssadmin delete shadows /for=<drive> /quiet` | T1490 |

**File System Artifacts**:
| Path | Description |
|------|-------------|
| `C:\F0\bitlocker_test.vhd` | VHD file for isolated encryption |
| `C:\F0\target_volumes.txt` | Discovery results |
| `C:\F0\stage*_output.txt` | Stage execution logs |
| `C:\F0\test_execution_log.json` | Test results |

**Registry/Event Log**:
- Custom event log channel creation (`F0RT1KA-Test`)
- BitLocker key protector registration
- Security Event ID 1102 (Log cleared)

---

## MITRE ATT&CK Mapping with Mitigations

### T1486 - Data Encrypted for Impact

| Mitigation ID | Name | Implementation |
|---------------|------|----------------|
| M1040 | Behavior Prevention on Endpoint | Deploy ASR rules to block ransomware execution patterns |
| M1053 | Data Backup | Maintain offline backups with versioning; test restoration regularly |

**Detection Focus**:
- Monitor for `manage-bde.exe` with `-on` parameter
- Alert on password-protected BitLocker (unusual - normally TPM-based)
- Track encryption initiated on non-system volumes

### T1490 - Inhibit System Recovery

| Mitigation ID | Name | Implementation |
|---------------|------|----------------|
| M1053 | Data Backup | Store backups offline, enable versioning |
| M1038 | Execution Prevention | Block unnecessary utilities like `vssadmin.exe` |
| M1028 | Operating System Configuration | Enable Windows Recovery Environment |
| M1018 | User Account Management | Restrict backup modification permissions |

**Detection Focus**:
- Monitor `vssadmin.exe` with `delete shadows` argument
- Track `wbadmin.exe`, `bcdedit.exe`, `wmic shadowcopy delete`
- Alert on rapid shadow copy deletion across volumes

### T1070.001 - Clear Windows Event Logs

| Mitigation ID | Name | Implementation |
|---------------|------|----------------|
| M1041 | Encrypt Sensitive Information | Encrypt event files locally and in transit |
| M1029 | Remote Data Storage | Forward events to SIEM immediately |
| M1022 | Restrict File and Directory Permissions | Protect .evtx files with proper ACLs |

**Detection Focus**:
- Monitor `wevtutil.exe` with `cl` (clear) parameter
- Track Security Event ID 1102 (Audit log cleared)
- Alert on PowerShell Clear-EventLog commands

### T1562.004 - Disable or Modify System Firewall

| Mitigation ID | Name | Implementation |
|---------------|------|----------------|
| M1047 | Audit | Review firewall modification permissions regularly |
| M1022 | Restrict File and Directory Permissions | Protect firewall configuration files |
| M1024 | Restrict Registry Permissions | Lock down firewall-related registry keys |
| M1018 | User Account Management | Limit firewall modification privileges |

**Detection Focus**:
- Monitor `netsh.exe` with `advfirewall` arguments
- Track PowerShell `Set-NetFirewallProfile` commands
- Alert on Windows Firewall service (mpssvc) state changes

### T1082 - System Information Discovery

**Detection Focus**:
- Monitor `wmic.exe` with `computersystem`, `os` queries
- Track `systeminfo.exe`, `hostname.exe` execution
- Alert on sequential discovery commands from same process

### T1083 - File and Directory Discovery

**Detection Focus**:
- Monitor `wmic.exe` with `logicaldisk` queries
- Track recursive directory enumeration
- Alert on disk/volume enumeration followed by encryption activity

---

## Detection Rules

### Detection Rules Summary

| Rule Type | Count | Coverage |
|-----------|-------|----------|
| KQL (Microsoft Sentinel) | 8 | All 6 techniques + correlation |
| LimaCharlie D&R | 6 | All stages + behavioral |
| YARA | 3 | Binaries and scripts |

### Detection Files

- `581e0f20-13f0-4374-9686-be3abd110ae0_detections.kql` - Microsoft Sentinel/Defender queries
- `581e0f20-13f0-4374-9686-be3abd110ae0_dr_rules.yaml` - LimaCharlie D&R rules
- `581e0f20-13f0-4374-9686-be3abd110ae0_rules.yar` - YARA rules

---

## Hardening Guidance

### Quick Wins (PowerShell Script)

A ready-to-run PowerShell hardening script is provided:
`581e0f20-13f0-4374-9686-be3abd110ae0_hardening.ps1`

**Capabilities**:
- Enable Attack Surface Reduction (ASR) rules
- Configure Windows Defender settings
- Restrict PowerShell execution
- Enable shadow copy protection
- Harden BitLocker policy
- Enable audit logging

**Usage**:
```powershell
# Apply hardening
.\581e0f20-13f0-4374-9686-be3abd110ae0_hardening.ps1

# Preview changes (WhatIf)
.\581e0f20-13f0-4374-9686-be3abd110ae0_hardening.ps1 -WhatIf

# Revert changes
.\581e0f20-13f0-4374-9686-be3abd110ae0_hardening.ps1 -Undo
```

### Complex Hardening Guidance

#### 1. Block Ransomware via ASR Rules

**MITRE Mitigations**: M1040 (Behavior Prevention on Endpoint)

| Setting | Value |
|---------|-------|
| **Location** | Windows Defender ATP |
| **Recommended** | Enable all ransomware-related ASR rules |
| **Impact** | Low (may require exclusions for legitimate tools) |

**Group Policy Path**:
```
Computer Configuration > Administrative Templates > Windows Components >
Windows Defender Antivirus > Windows Defender Exploit Guard > Attack Surface Reduction
```

**PowerShell Commands**:
```powershell
# Block executable content from email client and webmail
Set-MpPreference -AttackSurfaceReductionRules_Ids BE9BA2D9-53EA-4CDC-84E5-9B1EEEE46550 -AttackSurfaceReductionRules_Actions Enabled

# Use advanced protection against ransomware
Set-MpPreference -AttackSurfaceReductionRules_Ids C1DB55AB-C21A-4637-BB3F-A12568109D35 -AttackSurfaceReductionRules_Actions Enabled
```

#### 2. Protect Volume Shadow Copies

**MITRE Mitigations**: M1053 (Data Backup), M1028 (Operating System Configuration)

| Setting | Value |
|---------|-------|
| **Location** | Group Policy + File System Permissions |
| **Recommended** | Restrict vssadmin.exe execution + protect VSS service |
| **Impact** | Medium (may affect backup software) |

**Registry Settings**:
```
Path: HKLM\SYSTEM\CurrentControlSet\Services\VSS
Name: Start
Type: REG_DWORD
Value: 2 (Automatic)
```

**Restrict vssadmin Access**:
```powershell
# Block vssadmin for non-admin users via NTFS ACL
$acl = Get-Acl "C:\Windows\System32\vssadmin.exe"
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("Users","Execute","Deny")
$acl.SetAccessRule($rule)
Set-Acl "C:\Windows\System32\vssadmin.exe" $acl
```

#### 3. Event Log Forwarding

**MITRE Mitigations**: M1029 (Remote Data Storage)

| Setting | Value |
|---------|-------|
| **Location** | Windows Event Forwarding (WEF) |
| **Recommended** | Forward Security, System, and Application logs |
| **Impact** | Low |

**Enable Windows Event Forwarding**:
```powershell
# On collector
wecutil qc /q

# On source machines via GPO:
# Computer Configuration > Administrative Templates > Windows Components >
# Event Forwarding > Configure target Subscription Manager
```

#### 4. BitLocker Policy Hardening

**MITRE Mitigations**: M1040 (Behavior Prevention on Endpoint)

| Setting | Value |
|---------|-------|
| **Location** | Group Policy - BitLocker Drive Encryption |
| **Recommended** | Require TPM-only or TPM+PIN, prevent password-only |
| **Impact** | Medium (affects BitLocker deployments) |

**Group Policy Path**:
```
Computer Configuration > Administrative Templates > Windows Components >
BitLocker Drive Encryption > Operating System Drives >
Configure minimum PIN length for startup = 6 or higher
Require additional authentication at startup = TPM required
```

**Registry Settings**:
```
Path: HKLM\SOFTWARE\Policies\Microsoft\FVE
Name: UseAdvancedStartup
Type: REG_DWORD
Value: 1

Name: EnableBDEWithNoTPM
Type: REG_DWORD
Value: 0 (Disallow password-only)
```

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 581e0f20-13f0-4374-9686-be3abd110ae0 |
| **Test Name** | Ransomware Encryption via BitLocker |
| **MITRE ATT&CK** | T1070.001, T1562.004, T1082, T1083, T1486, T1490 |
| **Severity** | Critical |
| **Estimated Response Time** | 2-4 hours |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| BitLocker Ransomware Activity | manage-bde + vssadmin + wevtutil | High | P1 |
| Event Log Clearing | wevtutil cl | Medium | P2 |
| VSS Shadow Deletion | vssadmin delete shadows | High | P1 |
| Firewall Rule Manipulation | netsh advfirewall add/delete rule | Medium | P2 |
| System Enumeration Chain | wmic commands in sequence | Low | P3 |

#### Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What is the scope - single host or multiple systems affected?
3. What user account is associated with the activity?
4. What is the timeline - when did activity start?
5. Are there any encrypted files or ransom notes?
6. Is BitLocker normally used on this system?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Isolate affected host(s)**
```powershell
# Network isolation via Windows Firewall
netsh advfirewall set allprofiles state on
netsh advfirewall firewall add rule name="Emergency-Block-All-Outbound" dir=out action=block
netsh advfirewall firewall add rule name="Emergency-Block-All-Inbound" dir=in action=block
```

- [ ] **Terminate malicious processes**
```powershell
# Kill ransomware-related processes
$processes = @("manage-bde", "vssadmin", "wevtutil", "diskpart")
foreach ($proc in $processes) {
    Get-Process -Name $proc -ErrorAction SilentlyContinue | Stop-Process -Force
}
```

- [ ] **Stop BitLocker encryption if in progress**
```powershell
# List all volumes
manage-bde -status

# Pause encryption on affected volumes
manage-bde -pause C:
manage-bde -pause D:
# Repeat for all volumes showing "Encryption in Progress"

# Disable BitLocker to start decryption
manage-bde -off C:
```

- [ ] **Preserve volatile evidence**
```powershell
# Create evidence folder
New-Item -ItemType Directory -Path "C:\IR_Evidence" -Force

# Capture running processes
Get-Process | Select-Object * | Export-Csv "C:\IR_Evidence\processes_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

# Capture network connections
Get-NetTCPConnection | Export-Csv "C:\IR_Evidence\connections_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

# Capture command line history (PowerShell)
Get-History | Export-Csv "C:\IR_Evidence\ps_history.csv"

# Capture BitLocker status
manage-bde -status > "C:\IR_Evidence\bitlocker_status.txt"
```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| F0RT1KA Test Logs | `C:\F0\*` | `Copy-Item "C:\F0\*" -Destination "C:\IR_Evidence\F0_artifacts\" -Recurse` |
| BitLocker Recovery Keys | TPM/AD/Azure AD | `manage-bde -protectors -get C:` |
| Event Logs | Windows Events | See below |
| Prefetch Files | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*" -Destination "C:\IR_Evidence\Prefetch\"` |
| Recent VHD Files | System-wide | `Get-ChildItem -Path C:\ -Filter "*.vhd" -Recurse -ErrorAction SilentlyContinue` |

#### Event Log Collection
```powershell
# Create evidence folder for logs
New-Item -ItemType Directory -Path "C:\IR_Evidence\EventLogs" -Force

# Export critical event logs
$logs = @("Security", "System", "Application", "Microsoft-Windows-BitLocker/Management", "Microsoft-Windows-BitLocker-DrivePreparationTool/Admin")
foreach ($log in $logs) {
    try {
        wevtutil epl $log "C:\IR_Evidence\EventLogs\$($log -replace '/','-').evtx"
    } catch {
        Write-Warning "Could not export $log"
    }
}

# Export PowerShell logs
wevtutil epl "Microsoft-Windows-PowerShell/Operational" "C:\IR_Evidence\EventLogs\PowerShell-Operational.evtx"
```

#### Key Events to Analyze

| Event ID | Log | Significance |
|----------|-----|--------------|
| 1102 | Security | Audit log was cleared |
| 4688 | Security | New process created |
| 4697 | Security | Service installed |
| 7045 | System | New service installed |
| 770 | BitLocker-Management | BitLocker encryption started |
| 775 | BitLocker-Management | BitLocker encryption completed |

---

### 4. Eradication

#### Remove Attack Artifacts

```powershell
# Remove F0RT1KA test artifacts (AFTER evidence collection)
Remove-Item -Path "C:\F0\*" -Recurse -Force -ErrorAction SilentlyContinue

# Remove any created VHD files
Get-ChildItem -Path C:\ -Filter "bitlocker_test.vhd" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force

# Remove test firewall rules
netsh advfirewall firewall delete rule name="F0RT1KA-Test-Rule"

# Remove emergency containment rules
netsh advfirewall firewall delete rule name="Emergency-Block-All-Outbound"
netsh advfirewall firewall delete rule name="Emergency-Block-All-Inbound"
```

#### Ensure BitLocker Decryption Complete

```powershell
# Check all volumes are decrypted
$volumes = manage-bde -status | Select-String -Pattern "Volume"
foreach ($vol in $volumes) {
    manage-bde -status ($vol -replace "Volume ", "" -replace ":.*", ":")
}

# Wait for decryption to complete
while ((manage-bde -status C:) -match "Decryption in Progress") {
    Start-Sleep -Seconds 30
    Write-Host "Decryption in progress..."
}
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] Verify all BitLocker decryption complete
- [ ] Verify no unauthorized BitLocker protectors exist
- [ ] Restore Volume Shadow Copies if deleted
- [ ] Re-enable Windows Firewall to normal state
- [ ] Verify event logging is functioning
- [ ] Reconnect to network (after validation)
- [ ] Run antivirus/EDR full scan

#### Validation Commands

```powershell
# Verify BitLocker status - should show "Protection Off" or "Fully Decrypted"
manage-bde -status

# Verify no unauthorized protectors
manage-bde -protectors -get C:

# Verify VSS service running
Get-Service -Name VSS | Select-Object Status, StartType

# Verify Windows Firewall operational
Get-NetFirewallProfile | Select-Object Name, Enabled

# Verify event logging
Get-WinEvent -LogName Security -MaxEvents 5

# Check for remaining F0RT1KA artifacts
Get-ChildItem "C:\F0" -ErrorAction SilentlyContinue
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which alert triggered first?)
2. What was the detection-to-response time?
3. Were backups available and tested?
4. What prevented/enabled the attack to reach Stage 3?
5. Were event logs being forwarded before the incident?
6. Is BitLocker policy adequately controlled?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Deploy KQL queries from this guidance | High |
| Detection | Enable Microsoft Defender for Endpoint | High |
| Prevention | Implement ASR rules for ransomware | High |
| Prevention | Harden BitLocker policy (require TPM) | Medium |
| Prevention | Block vssadmin.exe for standard users | Medium |
| Backup | Implement offline backup solution | Critical |
| Logging | Forward security events to SIEM | High |
| Recovery | Document and test BitLocker recovery procedures | High |

---

## References

### MITRE ATT&CK
- [T1486: Data Encrypted for Impact](https://attack.mitre.org/techniques/T1486/)
- [T1490: Inhibit System Recovery](https://attack.mitre.org/techniques/T1490/)
- [T1070.001: Clear Windows Event Logs](https://attack.mitre.org/techniques/T1070/001/)
- [T1562.004: Disable or Modify System Firewall](https://attack.mitre.org/techniques/T1562/004/)
- [T1082: System Information Discovery](https://attack.mitre.org/techniques/T1082/)
- [T1083: File and Directory Discovery](https://attack.mitre.org/techniques/T1083/)

### Microsoft Documentation
- [BitLocker Overview](https://docs.microsoft.com/en-us/windows/security/information-protection/bitlocker/)
- [Attack Surface Reduction Rules](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction-rules-reference)
- [Windows Event Forwarding](https://docs.microsoft.com/en-us/windows/security/threat-protection/use-windows-event-forwarding-to-assist-in-intrusion-detection)

### Research
- [NCC Group - Ransomware Research](https://research.nccgroup.com/)

---

## Document Information

| Field | Value |
|-------|-------|
| **Test ID** | 581e0f20-13f0-4374-9686-be3abd110ae0 |
| **Generated By** | F0RT1KA Defense Guidance Builder |
| **Generated Date** | 2024-12-07 |
| **Framework Version** | 2.0 |
