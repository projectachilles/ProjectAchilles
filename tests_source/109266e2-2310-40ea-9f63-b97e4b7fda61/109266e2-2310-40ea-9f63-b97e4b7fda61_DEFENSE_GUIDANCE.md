# Defense Guidance: SafePay Enhanced Ransomware Simulation & Mass Data Operations

## Executive Summary

This document provides comprehensive defense guidance for protecting against the **SafePay Enhanced Ransomware Simulation** attack patterns. This test simulates sophisticated ransomware behavior including mass file operations (500-1500 files), multi-phase data staging with WinRAR compression, selective file deletion, and file encryption with custom extensions.

| Field | Value |
|-------|-------|
| **Test ID** | 109266e2-2310-40ea-9f63-b97e4b7fda61 |
| **Test Name** | SafePay Enhanced Ransomware Simulation & Mass Data Operations |
| **MITRE ATT&CK** | T1486, T1560.001, T1071.001, T1490, T1083, T1005 |
| **Tactics** | Impact, Collection, Command and Control, Discovery |
| **Severity** | CRITICAL |
| **Test Score** | 8.6/10 |

---

## Threat Overview

### Attack Description

The SafePay Enhanced Ransomware Simulation represents a realistic multi-phase ransomware attack that:

- **Creates mass corporate file trees** - 500-1500 files with realistic department-specific content
- **Stages data for exfiltration** - Multi-phase WinRAR compression with parallel processing
- **Encrypts remaining files** - Base64 encoding with `.safepay` extension
- **Displays ransom demands** - Creates and launches ransom note via Notepad
- **Simulates C2 communication** - Header patterns and beacon simulation

### Attack Flow

```
[1] Initial Payload Delivery
    - Go binary drops WinRAR.exe to C:\F0
    - PowerShell script (safepay_ransomware_sim_v3.ps1) deployed
         |
         v
[2] Environment Preparation (T1083)
    - Administrator privilege check
    - Disk space verification (minimum 2GB)
    - PowerShell execution policy bypass
         |
         v
[3] Corporate File Tree Creation (T1005)
    - Creates C:\Users\fortika-test directory
    - Multi-level department structure:
      Finance, HR, Legal, IT, Sales, Executive
    - Documents, Desktop, Pictures folders
         |
         v
[4] Mass File Generation (T1005)
    - 500-1500 files with realistic content
    - Extensions: .docx, .xlsx, .pdf, .txt, .csv, .sql, .bak
    - Department-specific data: financial reports, HR databases,
      legal contracts, IT credentials, sales data
         |
         v
[5] Multi-Phase Compression (T1560.001)
    - Phase 1: Department archives (Finance.rar, HR.rar, etc.)
    - Phase 2: Location archives (Documents.rar, Desktop.rar)
    - Phase 3: Master exfiltration archive (EXFIL_Master_*.rar)
         |
         v
[6] Selective Mass Deletion (T1490)
    - 60-65% of files deleted in batches of 50
    - Preserves files for encryption phase
    - Simulates evidence destruction
         |
         v
[7] File Encryption (T1486)
    - Remaining files encrypted with Base64
    - .safepay extension appended
    - Original files deleted post-encryption
         |
         v
[8] Ransom Note & C2 Simulation (T1071.001)
    - readme_safepay.txt created and displayed
    - Simulated C2 beacon patterns
    - Attack summary statistics generated
```

### Key Indicators of Compromise

| Indicator Type | Value | Description |
|---------------|-------|-------------|
| File Path | `C:\F0\WinRAR.exe` | Dropped archival utility |
| File Path | `C:\F0\safepay_ransomware_sim_v3.ps1` | Ransomware PowerShell script |
| File Path | `C:\F0\status.txt` | Phase tracking file |
| File Path | `C:\F0\safepay_simulation.log` | Detailed execution log |
| File Path | `C:\Users\fortika-test\readme_safepay.txt` | Ransom note |
| File Extension | `.safepay` | Encrypted file extension |
| Process | `powershell.exe -ExecutionPolicy Bypass` | Script execution |
| Process | `WinRAR.exe` | Archive creation |
| Process | `notepad.exe readme_safepay.txt` | Ransom note display |
| Directory | `C:\Users\fortika-test\` | Target directory structure |

---

## MITRE ATT&CK Mapping

### Technique Details

| Technique ID | Name | Tactic | Description |
|-------------|------|--------|-------------|
| **T1486** | Data Encrypted for Impact | Impact | File encryption with .safepay extension |
| **T1560.001** | Archive via Utility | Collection | WinRAR multi-phase compression |
| **T1071.001** | Web Protocols | Command and Control | Simulated C2 communication |
| **T1490** | Inhibit System Recovery | Impact | Mass file deletion, evidence destruction |
| **T1083** | File and Directory Discovery | Discovery | Corporate file tree enumeration |
| **T1005** | Data from Local System | Collection | Mass file creation with sensitive content |

### Applicable Mitigations

| M-Code | Mitigation | Applicable Techniques | Implementation |
|--------|------------|----------------------|----------------|
| **M1040** | Behavior Prevention on Endpoint | T1486 | Enable cloud-delivered protection and ASR rules |
| **M1053** | Data Backup | T1486, T1490 | Offline backups, versioning, multi-region replication |
| **M1047** | Audit | T1560.001, T1083, T1005 | Monitor for unauthorized archival utilities |
| **M1038** | Execution Prevention | T1490 | Block unauthorized utilities via AppLocker/WDAC |
| **M1028** | Operating System Configuration | T1490 | Protect recovery services and shadow copies |
| **M1018** | User Account Management | T1490 | Restrict backup deletion privileges |

---

## Detection Strategy

### Detection Priority Matrix

| Detection Layer | Priority | Confidence | Notes |
|-----------------|----------|------------|-------|
| Mass File Operations (500+ files) | P1 | HIGH | Primary ransomware indicator |
| WinRAR/Archive Utility in C:\F0 | P1 | HIGH | Unusual binary location |
| .safepay Extension Creation | P1 | CRITICAL | Definitive encryption indicator |
| Ransom Note Creation | P1 | CRITICAL | readme_safepay.txt |
| PowerShell Execution Bypass | P2 | HIGH | Common evasion technique |
| Mass File Deletion | P2 | HIGH | Data destruction indicator |
| Parallel WinRAR Processes | P2 | MEDIUM | Data staging behavior |
| Corporate Directory Creation | P3 | MEDIUM | Preparation phase |

### Detection Files

| File | Purpose | Format |
|------|---------|--------|
| `109266e2-2310-40ea-9f63-b97e4b7fda61_detections.kql` | Microsoft Sentinel/Defender queries | KQL |
| `109266e2-2310-40ea-9f63-b97e4b7fda61_rules.yar` | File/memory detection | YARA |
| `109266e2-2310-40ea-9f63-b97e4b7fda61_dr_rules.yaml` | LimaCharlie D&R rules | YAML |

---

## Detection Rules Summary

### KQL Queries (Microsoft Sentinel/Defender)

#### 1. Mass File Deletion Detection
**Confidence:** HIGH | **Severity:** High

Detects bulk file deletion patterns characteristic of ransomware destroying evidence.

```kql
DeviceFileEvents
| where ActionType == "FileDeleted"
| where FileName endswith_any (".docx", ".xlsx", ".pdf", ".txt", ".csv", ".sql", ".bak")
| summarize DeletedCount=count() by DeviceName, bin(TimeGenerated, 5m)
| where DeletedCount > 50
```

#### 2. WinRAR Data Exfiltration Detection
**Confidence:** HIGH | **Severity:** High

Monitors WinRAR processes for data staging and exfiltration patterns.

```kql
DeviceProcessEvents
| where ProcessCommandLine has_any ("WinRAR.exe", "rar.exe")
| where ProcessCommandLine has_any ("EXFIL", "-v100m", "-v500m", "-m5")
```

#### 3. Ransomware File Encryption Detection
**Confidence:** CRITICAL | **Severity:** Critical

Detects file encryption patterns and ransom note creation.

```kql
DeviceFileEvents
| where FileName endswith ".safepay" or FileName has "readme_safepay"
```

#### 4. Combined SafePay Ransomware Behavior Detection
**Confidence:** HIGH | **Severity:** Critical

Correlates multiple ransomware indicators for high-confidence detection.

### YARA Rules

| Rule Name | Purpose | Confidence |
|-----------|---------|------------|
| `SafePay_Ransomware_Script` | PowerShell ransomware script detection | HIGH |
| `SafePay_Ransom_Note` | Ransom note content detection | HIGH |
| `Suspicious_Archive_Staging` | Multi-phase archive creation patterns | MEDIUM |
| `Mass_File_Encryption_Tool` | Encryption utility detection | HIGH |

### LimaCharlie D&R Rules

| Rule Name | Trigger | Confidence |
|-----------|---------|------------|
| `safepay-ransomware-execution` | PowerShell with safepay script | CRITICAL |
| `mass-file-operations` | High-frequency file creation/deletion | HIGH |
| `winrar-data-staging` | WinRAR with suspicious patterns | HIGH |
| `ransomware-extension-encryption` | .safepay file creation | CRITICAL |
| `ransom-note-creation` | readme_safepay.txt creation | CRITICAL |

---

## Hardening Guidance

### Quick Implementation

Run the provided PowerShell hardening script with Administrator privileges:

```powershell
# Apply all hardening settings
.\109266e2-2310-40ea-9f63-b97e4b7fda61_hardening.ps1

# Preview changes without applying
.\109266e2-2310-40ea-9f63-b97e4b7fda61_hardening.ps1 -WhatIf

# Revert changes
.\109266e2-2310-40ea-9f63-b97e4b7fda61_hardening.ps1 -Undo
```

### Hardening Components

#### 1. Controlled Folder Access (M1040)

**Purpose:** Prevent unauthorized applications from modifying protected folders

**Implementation:**
```powershell
# Enable Controlled Folder Access
Set-MpPreference -EnableControlledFolderAccess Enabled

# Add protected folders
Add-MpPreference -ControlledFolderAccessProtectedFolders "C:\Users"
```

**Protected by default:** Documents, Pictures, Videos, Music, Desktop, Favorites

#### 2. Attack Surface Reduction Rules (M1040)

**Purpose:** Block ransomware-related behaviors

**Key ASR Rules:**
| GUID | Rule |
|------|------|
| D4F940AB-401B-4EFC-AADC-AD5F3C50688A | Block Office apps from creating child processes |
| 3B576869-A4EC-4529-8536-B80A7769E899 | Block Office apps from creating executable content |
| C1DB55AB-C21A-4637-BB3F-A12568109D35 | Block untrusted executables from USB |
| D1E49AAC-8F56-4280-B9BA-993A6D77406C | Block process creations from PSExec/WMI |

#### 3. Application Control (M1038)

**Purpose:** Block unauthorized utilities like WinRAR from suspicious locations

```powershell
# Block execution from C:\F0 directory
New-AppLockerPolicy -RuleType Path -Deny -Path "C:\F0\*" -User Everyone
```

#### 4. File System Auditing (M1047)

**Purpose:** Detect mass file operations

```powershell
# Enable File System auditing
auditpol /set /subcategory:"File System" /success:enable /failure:enable

# Enable Handle Manipulation auditing
auditpol /set /subcategory:"Handle Manipulation" /success:enable
```

#### 5. Volume Shadow Copy Protection (M1028)

**Purpose:** Protect recovery data from deletion

```powershell
# Enable Volume Shadow Copy Service
Set-Service -Name VSS -StartupType Automatic

# Configure shadow copy schedule
vssadmin add shadowstorage /for=C: /on=C: /maxsize=10%
```

### GPO Deployment

For enterprise deployment via Group Policy:

**Computer Configuration > Windows Settings > Security Settings:**

| Category | Setting | Value |
|----------|---------|-------|
| Windows Defender | Cloud Protection | Advanced |
| Windows Defender | Controlled Folder Access | Enabled |
| ASR Rules | Block ransomware behaviors | Enabled (Block) |
| Audit Policy | File System | Success, Failure |
| AppLocker | Executable Rules | Block C:\F0\* |

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 109266e2-2310-40ea-9f63-b97e4b7fda61 |
| **MITRE ATT&CK** | T1486, T1560.001, T1490, T1083, T1005 |
| **Severity** | CRITICAL |
| **Estimated Response Time** | 1-2 hours |

### 1. Detection Triggers

| Alert Name | Trigger Criteria | Priority |
|------------|------------------|----------|
| SafePay Ransomware Execution | PowerShell script matching safepay patterns | P1 |
| Mass File Encryption | .safepay extension files created | P1 |
| Ransom Note Detection | readme_safepay.txt creation | P1 |
| WinRAR Data Staging | Multiple archive operations from C:\F0 | P1 |
| Mass File Deletion | 50+ files deleted in 5-minute window | P2 |

### 2. Initial Triage (First 5 minutes)

- [ ] **Verify alert is not a test execution** (check for F0RT1KA framework indicators in C:\F0)
- [ ] **Determine scope** - Single host or multiple affected?
- [ ] **Identify user account** - Legitimate admin or compromised?
- [ ] **Check timeline** - When did activity begin? Which phase is active?

**Triage Questions:**
1. Is this a scheduled F0RT1KA security test?
2. Does C:\F0\status.txt exist? What phase does it indicate?
3. Are there .safepay files outside the test directory?
4. Has the ransom note been displayed to users?

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
# Kill PowerShell processes running ransomware script
Get-Process powershell | Where-Object {$_.CommandLine -like "*safepay*"} | Stop-Process -Force

# Kill WinRAR processes from C:\F0
Get-Process | Where-Object {$_.Path -like "C:\F0\*"} | Stop-Process -Force

# Kill Notepad displaying ransom note
Get-Process notepad | Where-Object {$_.CommandLine -like "*readme_safepay*"} | Stop-Process -Force
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

# Copy F0RT1KA execution logs
Copy-Item "C:\F0\*" -Destination "$irPath\F0_artifacts\" -Recurse
```

### 4. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Test execution logs | `C:\F0\*_log.json` | `Copy-Item "C:\F0\*" -Destination "C:\IR\F0\"` |
| Simulation log | `C:\F0\safepay_simulation.log` | `Copy-Item "C:\F0\safepay_simulation.log" "C:\IR\"` |
| Status file | `C:\F0\status.txt` | `Copy-Item "C:\F0\status.txt" "C:\IR\"` |
| Ransom note | `C:\Users\fortika-test\readme_safepay.txt` | `Copy-Item` |
| Archive files | `C:\Users\fortika-test\*.rar` | `Copy-Item "*.rar" "C:\IR\archives\"` |
| Encrypted files | `C:\Users\fortika-test\*.safepay` | Document file list |
| Event logs | System | `wevtutil epl Security C:\IR\Security.evtx` |
| Prefetch | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*" "C:\IR\Prefetch\"` |

#### Timeline Generation
```powershell
# Export relevant event logs
$logs = @("Security", "System", "Microsoft-Windows-Sysmon/Operational", "Microsoft-Windows-PowerShell/Operational")
foreach ($log in $logs) {
    wevtutil epl $log "C:\IR\$($log -replace '/','-').evtx"
}

# Query file creation events
Get-WinEvent -FilterHashtable @{
    LogName = 'Security'
    ID = 4663  # File access
    StartTime = (Get-Date).AddHours(-2)
} | Export-Csv "C:\IR\file_events.csv" -NoTypeInformation
```

### 5. Eradication

#### File Removal
```powershell
# Remove test artifacts (AFTER evidence collection)
Remove-Item -Path "C:\F0\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "C:\Users\fortika-test" -Recurse -Force -ErrorAction SilentlyContinue
```

#### Verify Clean State
```powershell
# Check for remaining .safepay files system-wide
Get-ChildItem -Path C:\ -Filter "*.safepay" -Recurse -ErrorAction SilentlyContinue

# Check for ransom notes
Get-ChildItem -Path C:\ -Filter "readme_safepay.txt" -Recurse -ErrorAction SilentlyContinue

# Verify no suspicious scheduled tasks
Get-ScheduledTask | Where-Object {$_.TaskName -like "*safepay*"}
```

### 6. Recovery

#### System Restoration Checklist

- [ ] Verify all malicious artifacts removed
- [ ] Restore any legitimately affected files from backup
- [ ] Validate security controls are functioning
- [ ] Re-enable network connectivity
- [ ] Verify endpoint protection is active

#### Validation Commands
```powershell
# Verify clean state
Get-ChildItem "C:\F0\" -ErrorAction SilentlyContinue  # Should be empty/not exist
Get-ChildItem "C:\Users\fortika-test\" -ErrorAction SilentlyContinue  # Should be empty/not exist

# Verify Defender is functional
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AntivirusEnabled

# Verify Controlled Folder Access
Get-MpPreference | Select-Object EnableControlledFolderAccess
```

### 7. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which rule/alert triggered first?)
2. What was the detection-to-containment time?
3. Did Controlled Folder Access block any activity?
4. Which phase did the simulation reach before detection?
5. What would have prevented this attack?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Enable mass file operation alerts (50+ files/5min) | HIGH |
| Prevention | Enable Controlled Folder Access in Block mode | CRITICAL |
| Prevention | Block WinRAR execution from non-standard paths | HIGH |
| Prevention | Implement AppLocker/WDAC for C:\F0 directory | HIGH |
| Monitoring | Enable PowerShell Script Block Logging | MEDIUM |
| Backup | Verify offline backup frequency and integrity | CRITICAL |
| Response | Pre-stage IR collection scripts on endpoints | MEDIUM |

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
| Binary Drop | WinRAR.exe in C:\F0\ | Immediate |
| Script Execution | PowerShell -ExecutionPolicy Bypass | Immediate |
| File Creation | Mass file creation (500+ files) | 1-2 minutes |
| Compression | Multiple WinRAR processes | 2-3 minutes |
| Deletion | Mass file deletion alert | 3-4 minutes |
| Encryption | .safepay extension detection | 3-4 minutes |
| Ransom Note | readme_safepay.txt creation | 4-5 minutes |

---

## References

### MITRE ATT&CK
- [T1486 - Data Encrypted for Impact](https://attack.mitre.org/techniques/T1486/)
- [T1560.001 - Archive via Utility](https://attack.mitre.org/techniques/T1560/001/)
- [T1490 - Inhibit System Recovery](https://attack.mitre.org/techniques/T1490/)
- [T1083 - File and Directory Discovery](https://attack.mitre.org/techniques/T1083/)
- [T1005 - Data from Local System](https://attack.mitre.org/techniques/T1005/)
- [M1040 - Behavior Prevention on Endpoint](https://attack.mitre.org/mitigations/M1040/)
- [M1053 - Data Backup](https://attack.mitre.org/mitigations/M1053/)

### Technical Documentation
- [Windows Controlled Folder Access](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/controlled-folders)
- [Attack Surface Reduction Rules](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction)
- [WinRAR Command Line Manual](https://documentation.help/WinRAR/)

---

## Files Included

| File | Description |
|------|-------------|
| `109266e2-2310-40ea-9f63-b97e4b7fda61_DEFENSE_GUIDANCE.md` | This comprehensive defense document |
| `109266e2-2310-40ea-9f63-b97e4b7fda61_detections.kql` | KQL queries for Microsoft Sentinel/Defender |
| `109266e2-2310-40ea-9f63-b97e4b7fda61_rules.yar` | YARA rules for file/memory detection |
| `109266e2-2310-40ea-9f63-b97e4b7fda61_dr_rules.yaml` | LimaCharlie D&R rules |
| `109266e2-2310-40ea-9f63-b97e4b7fda61_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-07*
