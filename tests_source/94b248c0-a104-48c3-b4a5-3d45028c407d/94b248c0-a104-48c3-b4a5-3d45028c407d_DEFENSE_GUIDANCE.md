# Defense Guidance: Gunra Ransomware Simulation

## Executive Summary

This document provides comprehensive defensive guidance for the Gunra Ransomware simulation test (94b248c0-a104-48c3-b4a5-3d45028c407d). Gunra is a sophisticated ransomware strain that employs double-extortion tactics, encrypting victim files while threatening to publish stolen data. This guidance enables security teams to detect, prevent, and respond to Gunra ransomware and similar threats.

| Field | Value |
|-------|-------|
| **Test ID** | 94b248c0-a104-48c3-b4a5-3d45028c407d |
| **Test Name** | Gunra Ransomware Simulation |
| **Test Score** | 8.2/10 |
| **Severity** | Critical |
| **Primary Tactic** | Impact |
| **Created** | 2025-12-07 |
| **Author** | F0RT1KA Defense Guidance Builder |

---

## Threat Overview

### About Gunra Ransomware

Gunra Ransomware is a recently observed threat that targets Windows systems globally across various industries including:
- Real Estate
- Pharmaceuticals
- Manufacturing
- Various sectors (Japan, Egypt, Panama, Italy, Argentina)

**Key Characteristics:**
- **Encryption**: Files encrypted with `.ENCRT` extension
- **Ransom Note**: `R3ADM3.txt` dropped in affected directories
- **Double Extortion**: Threatens to publish stolen data on Tor-hosted sites
- **Deadline Strategy**: 5-day deadline to create urgency
- **Anti-Analysis**: Uses IsDebuggerPresent API to detect debugging

### Attack Flow

```
[Initial Access] --> [Anti-Debug Check] --> [System Discovery] --> [Shadow Copy Deletion]
                                                   |
                                                   v
[File Enumeration] --> [File Encryption (.ENCRT)] --> [Ransom Note Drop (R3ADM3.txt)]
```

**Test Execution Steps:**
1. Anti-debugging check (T1622)
2. System information discovery - hostname, username, OS (T1082)
3. Test environment setup in `c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d`
4. Shadow copy access check via vssadmin (T1490)
5. File enumeration in test directory (T1083)
6. File encryption simulation with .ENCRT extension (T1486)
7. Ransom note deployment (T1486)
8. Verification of successful encryption

---

## MITRE ATT&CK Mapping

### Techniques

| Technique ID | Technique Name | Tactic | Description |
|--------------|----------------|--------|-------------|
| [T1486](https://attack.mitre.org/techniques/T1486/) | Data Encrypted for Impact | Impact | Encrypts files with .ENCRT extension, drops R3ADM3.txt ransom note |
| [T1490](https://attack.mitre.org/techniques/T1490/) | Inhibit System Recovery | Impact | Attempts to delete Volume Shadow Copies via vssadmin/WMI |
| [T1082](https://attack.mitre.org/techniques/T1082/) | System Information Discovery | Discovery | Gathers hostname, username, and OS information |
| [T1083](https://attack.mitre.org/techniques/T1083/) | File and Directory Discovery | Discovery | Enumerates files in target directories for encryption |
| [T1622](https://attack.mitre.org/techniques/T1622/) | Debugger Evasion | Defense Evasion | Uses IsDebuggerPresent to detect analysis environments |

### Applicable Mitigations

| Mitigation ID | Mitigation Name | Applicable Techniques | Implementation |
|---------------|-----------------|----------------------|-----------------|
| [M1040](https://attack.mitre.org/mitigations/M1040/) | Behavior Prevention on Endpoint | T1486 | Enable ASR rules, Controlled Folder Access |
| [M1053](https://attack.mitre.org/mitigations/M1053/) | Data Backup | T1486, T1490 | Implement 3-2-1 backup strategy, offline backups |
| [M1038](https://attack.mitre.org/mitigations/M1038/) | Execution Prevention | T1490 | Block unauthorized access to vssadmin, bcdedit |
| [M1028](https://attack.mitre.org/mitigations/M1028/) | Operating System Configuration | T1490 | Protect VSS service, enable boot recovery options |
| [M1018](https://attack.mitre.org/mitigations/M1018/) | User Account Management | T1490 | Restrict backup service access to authorized accounts |

---

## Key Indicators

### File System Indicators

| Indicator | Type | Description |
|-----------|------|-------------|
| `.ENCRT` | File Extension | Gunra encrypted file extension |
| `R3ADM3.txt` | Filename | Gunra ransom note filename |
| `c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d\` | Directory | F0RT1KA test directory |
| `[ENCRYPTED BY GUNRA` | File Content | Encryption marker in encrypted files |

### Process Indicators

| Indicator | Type | MITRE Technique |
|-----------|------|-----------------|
| `vssadmin.exe delete shadows` | Command Line | T1490 |
| `vssadmin.exe list shadows` | Command Line | T1490 (Recon) |
| `wmic shadowcopy delete` | Command Line | T1490 |
| `bcdedit /set recoveryenabled no` | Command Line | T1490 |
| `gunraransome.exe` | Process Name | T1486 |

### Behavioral Indicators

- Rapid file modification with extension changes
- Mass file access in user directories
- Shadow copy enumeration or deletion
- System information gathering sequence
- Ransom note creation in multiple directories

---

## Detection Rules

### KQL Queries (Microsoft Sentinel/Defender)

The complete KQL detection queries are in: `94b248c0-a104-48c3-b4a5-3d45028c407d_detections.kql`

**Summary of Queries:**

| Query # | Name | Confidence | MITRE |
|---------|------|------------|-------|
| 1 | Ransomware File Extension Change (.ENCRT) | High | T1486 |
| 2 | Gunra Ransom Note Detection (R3ADM3.txt) | High | T1486 |
| 3 | Shadow Copy Deletion Attempts (vssadmin) | High | T1490 |
| 4 | WMI-Based Shadow Copy Deletion | High | T1490 |
| 5 | BCDEdit Recovery Disabling | High | T1490 |
| 6 | System Information Discovery Pattern | Medium | T1082 |
| 7 | Rapid File Enumeration Detection | Medium | T1083 |
| 8 | Anti-Debugging API Detection | Medium | T1622 |
| 9 | F0RT1KA Test Directory Activity | High | N/A |
| 10 | Combined Ransomware Behavioral Detection | High | T1486, T1490 |
| 11 | Generic Ransomware Extension Monitoring | Medium-High | T1486 |

**High-Priority Detection Example:**

```kql
// Gunra Ransom Note Detection
DeviceFileEvents
| where TimeGenerated > ago(24h)
| where ActionType == "FileCreated"
| where FileName =~ "R3ADM3.txt"
| extend
    Severity = "Critical",
    ThreatType = "Ransomware - Gunra Ransom Note Dropped",
    MitreAttack = "T1486"
```

### LimaCharlie D&R Rules

The complete D&R rules are in: `94b248c0-a104-48c3-b4a5-3d45028c407d_dr_rules.yaml`

**Deployment:**
```bash
limacharlie dr add -f 94b248c0-a104-48c3-b4a5-3d45028c407d_dr_rules.yaml
```

**Summary of Rules:**

| Rule Name | Event Type | Confidence | Response |
|-----------|------------|------------|----------|
| gunra-encrt-file-encryption | FILE_CREATE | High | Report, History Dump |
| gunra-ransom-note-creation | FILE_CREATE | High | Report, History Dump |
| shadow-copy-deletion-vssadmin | NEW_PROCESS | High | Report, History Dump |
| shadow-copy-deletion-wmi | NEW_PROCESS | High | Report |
| bcdedit-recovery-disabled | NEW_PROCESS | High | Report |
| mass-file-modification | FILE_MODIFIED | Medium | Report |
| system-information-discovery | NEW_PROCESS | Medium | Report |
| file-directory-enumeration | NEW_PROCESS | Low-Medium | Report |
| f0rtika-test-execution | FILE_CREATE | High | Report (Test Tracking) |
| ransomware-process-name | NEW_PROCESS | High | Report, History Dump |

### YARA Rules

The complete YARA rules are in: `94b248c0-a104-48c3-b4a5-3d45028c407d_rules.yar`

**Summary of Rules:**

| Rule Name | Target | Confidence |
|-----------|--------|------------|
| Gunra_Ransomware_Binary | PE files | High |
| Gunra_Ransom_Note | Text files | High |
| Ransomware_ENCRT_Extension | PE files | Medium |
| Shadow_Copy_Deletion_Tool | All files | High |
| Ransomware_AntiDebug | PE files | Medium |
| Go_Ransomware | PE files | Medium |
| Gunra_Encrypted_File | Encrypted files | Medium |
| PowerShell_Ransomware_Script | Scripts | Medium |
| Batch_Ransomware_Helper | Scripts | Medium |
| Gunra_Ransomware_Memory | Memory | Medium |

---

## Hardening Guidance

### Quick Wins (PowerShell Script)

A comprehensive hardening script is provided: `94b248c0-a104-48c3-b4a5-3d45028c407d_hardening.ps1`

**Usage:**
```powershell
# Apply all hardening settings
.\94b248c0-a104-48c3-b4a5-3d45028c407d_hardening.ps1

# Preview changes without applying
.\94b248c0-a104-48c3-b4a5-3d45028c407d_hardening.ps1 -WhatIf

# Revert all changes
.\94b248c0-a104-48c3-b4a5-3d45028c407d_hardening.ps1 -Undo
```

**Implemented Hardening:**

1. **Controlled Folder Access** - Ransomware protection for user folders
2. **ASR Rules** - 12 ransomware-focused Attack Surface Reduction rules
3. **Shadow Copy Protection** - VSS service hardening and baseline backups
4. **Audit Configuration** - Process creation and file system auditing
5. **Defender Cloud Protection** - Enhanced cloud-delivered protection
6. **File Extension Monitoring** - Guidance for ransomware extension alerts

### Controlled Folder Access Configuration

```powershell
# Enable Controlled Folder Access
Set-MpPreference -EnableControlledFolderAccess Enabled

# Add protected folders
$folders = @(
    "$env:USERPROFILE\Documents",
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Pictures"
)
foreach ($folder in $folders) {
    Add-MpPreference -ControlledFolderAccessProtectedFolders $folder
}

# Verify configuration
Get-MpPreference | Select-Object EnableControlledFolderAccess
```

### Attack Surface Reduction Rules

Critical ASR rules for ransomware protection:

| Rule GUID | Rule Name |
|-----------|-----------|
| C1DB55AB-C21A-4637-BB3F-A12568109D35 | Use advanced protection against ransomware |
| D4F940AB-401B-4EFC-AADC-AD5F3C50688A | Block Office apps from creating child processes |
| 3B576869-A4EC-4529-8536-B80A7769E899 | Block Office apps from creating executable content |
| D1E49AAC-8F56-4280-B9BA-993A6D77406C | Block process creations from PSExec/WMI |
| 01443614-CD74-433A-B99E-2ECDC07BFC25 | Block low-reputation executables |

**Enable ASR Rules:**
```powershell
# Enable advanced ransomware protection
Set-MpPreference -AttackSurfaceReductionRules_Ids "C1DB55AB-C21A-4637-BB3F-A12568109D35" `
                 -AttackSurfaceReductionRules_Actions 1
```

### Shadow Copy Protection

```powershell
# Ensure VSS service is running and set to automatic
Set-Service -Name "VSS" -StartupType Automatic
Start-Service -Name "VSS"

# Configure shadow storage (15% of volume)
vssadmin resize shadowstorage /for=C: /on=C: /maxsize=15%

# Create baseline shadow copy
wmic shadowcopy call create Volume="C:\"

# Verify shadow copies
vssadmin list shadows
```

### Backup Recommendations (M1053)

**3-2-1 Backup Rule:**
- **3** copies of critical data
- **2** different storage types (local + cloud/tape)
- **1** offsite or offline copy

**Implementation Checklist:**

- [ ] Implement offline/air-gapped backups
- [ ] Enable cloud backup versioning (30+ day retention)
- [ ] Configure immutable backup storage
- [ ] Test restoration procedures quarterly
- [ ] Document and drill recovery processes

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 94b248c0-a104-48c3-b4a5-3d45028c407d |
| **Severity** | Critical |
| **Estimated Response Time** | 2-4 hours for containment |
| **Key Artifacts** | .ENCRT files, R3ADM3.txt, Event ID 4688 |

### 1. Detection Triggers

| Detection Name | Trigger Criteria | Priority |
|----------------|------------------|----------|
| Gunra File Encryption | .ENCRT files created | P1 |
| Ransom Note Creation | R3ADM3.txt file created | P1 |
| Shadow Copy Deletion | vssadmin delete shadows | P1 |
| Mass File Modification | 50+ files renamed in 1 minute | P1 |

### Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What is the scope - single host or multiple endpoints?
3. What user account/process is associated with the activity?
4. Have shadow copies already been deleted?
5. Is the encryption still in progress or completed?

### 2. Containment (First 15 Minutes)

**Immediate Actions:**

```powershell
# Isolate affected host from network
netsh advfirewall set allprofiles state on
netsh advfirewall firewall add rule name="Block All Outbound" dir=out action=block

# Terminate suspicious processes (if known PID)
Stop-Process -Id <pid> -Force

# If ransomware process name known
Stop-Process -Name "gunraransome" -Force -ErrorAction SilentlyContinue

# Disable scheduled tasks that might restart ransomware
Get-ScheduledTask | Where-Object {$_.State -eq "Ready"} | Disable-ScheduledTask
```

**Preserve Volatile Evidence:**

```powershell
# Create IR directory
New-Item -Path "C:\IR" -ItemType Directory -Force

# Capture running processes
Get-Process | Export-Csv "C:\IR\processes_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

# Capture network connections
Get-NetTCPConnection | Export-Csv "C:\IR\connections_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

# Capture logged on users
query user > "C:\IR\logged_users.txt"

# Capture scheduled tasks
Get-ScheduledTask | Export-Csv "C:\IR\scheduled_tasks.csv"
```

### 3. Evidence Collection

**Critical Artifacts:**

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Test execution logs | `c:\F0\*_log.json` | `Copy-Item "c:\F0\*" -Destination "C:\IR\F0_artifacts\" -Recurse` |
| Ransom notes | Various directories | `Get-ChildItem -Path C:\ -Filter "R3ADM3.txt" -Recurse` |
| Encrypted files | User directories | `Get-ChildItem -Path C:\ -Filter "*.ENCRT" -Recurse` |
| Event logs | System | See below |
| Prefetch | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*" -Destination "C:\IR\Prefetch\"` |

**Event Log Collection:**

```powershell
# Export Security log (process creation, file access)
wevtutil epl Security "C:\IR\Security.evtx"

# Export System log
wevtutil epl System "C:\IR\System.evtx"

# Export PowerShell logs
wevtutil epl "Microsoft-Windows-PowerShell/Operational" "C:\IR\PowerShell.evtx"

# Export Defender logs
wevtutil epl "Microsoft-Windows-Windows Defender/Operational" "C:\IR\Defender.evtx"
```

**Key Event IDs to Review:**

| Event ID | Log | Description |
|----------|-----|-------------|
| 4688 | Security | Process Creation (look for vssadmin, bcdedit) |
| 4663 | Security | File access attempts |
| 1116 | Defender | Malware detection |
| 1117 | Defender | Malware action taken |

### 4. Eradication

**After Evidence Collection:**

```powershell
# Remove ransomware artifacts (AFTER evidence collection)
# Remove F0RT1KA test directory
Remove-Item -Path "c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d" -Recurse -Force -ErrorAction SilentlyContinue

# Search and list all ransom notes (review before deletion)
Get-ChildItem -Path C:\ -Filter "R3ADM3.txt" -Recurse -ErrorAction SilentlyContinue

# Search for encrypted files (for inventory, not deletion)
Get-ChildItem -Path C:\ -Filter "*.ENCRT" -Recurse -ErrorAction SilentlyContinue |
    Select-Object FullName, Length, LastWriteTime |
    Export-Csv "C:\IR\encrypted_files_inventory.csv"
```

**Registry Cleanup (if persistence found):**

```powershell
# Check common persistence locations
Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
Get-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue

# Remove suspicious entries
# Remove-ItemProperty -Path "HKLM:\...\Run" -Name "<suspicious-entry>"
```

### 5. Recovery

**System Restoration Checklist:**

- [ ] Verify all malicious artifacts removed
- [ ] Restore files from clean backup (if encryption occurred)
- [ ] Recreate shadow copies
- [ ] Re-enable Windows recovery options
- [ ] Verify security controls are functioning
- [ ] Reconnect to network (after validation)

**Restore Shadow Copies:**

```powershell
# Re-enable Windows recovery
bcdedit /set {default} recoveryenabled yes
bcdedit /set {default} bootstatuspolicy displayallfailures

# Create new shadow copy
wmic shadowcopy call create Volume="C:\"

# Verify VSS service
Get-Service VSS | Select-Object Status, StartType
```

**Validation Commands:**

```powershell
# Verify clean state - no ransomware artifacts
Get-ChildItem "c:\F0\" -ErrorAction SilentlyContinue
Get-ChildItem -Path C:\ -Filter "R3ADM3.txt" -Recurse -ErrorAction SilentlyContinue
Get-ChildItem -Path C:\ -Filter "*.ENCRT" -Recurse -ErrorAction SilentlyContinue

# Verify shadow copies restored
vssadmin list shadows

# Verify Defender is operational
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, CloudEnabled

# Test network connectivity
Test-NetConnection -ComputerName <domain-controller> -Port 389
```

### 6. Post-Incident

**Lessons Learned Questions:**

1. How was the attack detected? Which rule/alert triggered first?
2. What was the detection-to-containment time?
3. Were backups sufficient for recovery?
4. What preventive controls would have stopped this attack?
5. What detection gaps were identified?

**Recommended Improvements:**

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Deploy all KQL queries from this guidance | High |
| Prevention | Enable Controlled Folder Access organization-wide | High |
| Prevention | Enable advanced ransomware ASR rule | High |
| Backup | Implement immutable backup storage | High |
| Response | Pre-stage IR tools on all endpoints | Medium |
| Training | Conduct tabletop exercise for ransomware scenario | Medium |

---

## Files Generated

| File | Description |
|------|-------------|
| `94b248c0-a104-48c3-b4a5-3d45028c407d_DEFENSE_GUIDANCE.md` | This comprehensive document |
| `94b248c0-a104-48c3-b4a5-3d45028c407d_detections.kql` | Microsoft Sentinel/Defender KQL queries |
| `94b248c0-a104-48c3-b4a5-3d45028c407d_dr_rules.yaml` | LimaCharlie D&R rules |
| `94b248c0-a104-48c3-b4a5-3d45028c407d_rules.yar` | YARA detection rules |
| `94b248c0-a104-48c3-b4a5-3d45028c407d_hardening.ps1` | PowerShell hardening script |

---

## References

### MITRE ATT&CK
- [T1486 - Data Encrypted for Impact](https://attack.mitre.org/techniques/T1486/)
- [T1490 - Inhibit System Recovery](https://attack.mitre.org/techniques/T1490/)
- [T1082 - System Information Discovery](https://attack.mitre.org/techniques/T1082/)
- [T1083 - File and Directory Discovery](https://attack.mitre.org/techniques/T1083/)
- [T1622 - Debugger Evasion](https://attack.mitre.org/techniques/T1622/)

### Mitigations
- [M1040 - Behavior Prevention on Endpoint](https://attack.mitre.org/mitigations/M1040/)
- [M1053 - Data Backup](https://attack.mitre.org/mitigations/M1053/)
- [M1038 - Execution Prevention](https://attack.mitre.org/mitigations/M1038/)
- [M1028 - Operating System Configuration](https://attack.mitre.org/mitigations/M1028/)
- [M1018 - User Account Management](https://attack.mitre.org/mitigations/M1018/)

### Microsoft Documentation
- [Controlled Folder Access](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/controlled-folders)
- [Attack Surface Reduction Rules](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction-rules-reference)
- [Volume Shadow Copy Service](https://docs.microsoft.com/en-us/windows-server/storage/file-server/volume-shadow-copy-service)

### Threat Intelligence
- CYFIRMA Research: Gunra Ransomware Analysis

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-07*
