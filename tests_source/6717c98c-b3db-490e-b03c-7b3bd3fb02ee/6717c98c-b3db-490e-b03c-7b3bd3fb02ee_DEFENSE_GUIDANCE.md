# Defense Guidance: SafePay Go-Native Ransomware Simulation

## Executive Summary

This document provides comprehensive defense guidance for detecting, preventing, and responding to attack techniques simulated by the SafePay Go-Native Ransomware test. The test implements a complete ransomware kill chain including mass file creation, data staging via WinRAR compression, selective file deletion, file encryption simulation, and ransom note generation.

| Field | Value |
|-------|-------|
| **Test ID** | `6717c98c-b3db-490e-b03c-7b3bd3fb02ee` |
| **Test Name** | SafePay Go-Native Ransomware Simulation |
| **Severity** | Critical |
| **Test Score** | 9.0/10 |

---

## Threat Overview

### Attack Description

The SafePay ransomware simulation demonstrates a sophisticated, multi-phase ransomware attack implemented entirely in Go. Key characteristics include:

1. **Directory Enumeration** - Creates and traverses corporate directory structures
2. **Mass File Generation** - Creates 800-1000 realistic corporate documents
3. **Data Staging** - Archives data using embedded WinRAR.exe for exfiltration preparation
4. **Selective Deletion** - Deletes 65% of original files to complicate recovery
5. **Encryption Simulation** - Base64-encodes remaining files with `.safepay` extension
6. **Ransom Note Delivery** - Creates and displays ransom note via Notepad

### Attack Flow

```
[Initial Access] -> [File Discovery] -> [Mass File Creation] -> [Data Staging]
                                                                      |
                                                                      v
[Ransom Note] <- [File Encryption] <- [Mass Deletion] <- [WinRAR Archives]
```

### Key Indicators

| Indicator Type | Value |
|---------------|-------|
| File Extension | `.safepay` |
| Ransom Note | `readme_safepay.txt` |
| Target Directory | `C:\Users\fortika-test\` |
| Staging Tool | `WinRAR.exe` dropped to `C:\F0\` |
| Log File | `C:\F0\safepay_simulation.log` |
| Archive Pattern | `*_Archive_YYYYMMDD.rar`, `EXFIL_Master_*.rar` |

---

## MITRE ATT&CK Mapping

| Technique ID | Technique Name | Tactic | Description |
|-------------|---------------|--------|-------------|
| [T1486](https://attack.mitre.org/techniques/T1486/) | Data Encrypted for Impact | Impact | Encrypts files with `.safepay` extension |
| [T1560.001](https://attack.mitre.org/techniques/T1560/001/) | Archive Collected Data: Archive via Utility | Collection | Uses WinRAR for data staging |
| [T1490](https://attack.mitre.org/techniques/T1490/) | Inhibit System Recovery | Impact | Deletes original files after encryption |
| [T1083](https://attack.mitre.org/techniques/T1083/) | File and Directory Discovery | Discovery | Traverses directory structures |
| [T1005](https://attack.mitre.org/techniques/T1005/) | Data from Local System | Collection | Targets local user directories |
| [T1071.001](https://attack.mitre.org/techniques/T1071/001/) | Application Layer Protocol: Web | C2 | Simulates C2 communication patterns |

### Technique-to-Mitigation Mapping

| Technique | Mitigations | Implementation Priority |
|-----------|-------------|------------------------|
| T1486 | M1040 (Behavior Prevention), M1053 (Data Backup) | Critical |
| T1560.001 | M1047 (Audit) | High |
| T1490 | M1053 (Data Backup), M1038 (Execution Prevention), M1028 (OS Config) | Critical |
| T1083 | Monitoring, Access Controls | Medium |
| T1005 | M1057 (Data Loss Prevention) | High |

---

## Detection Rules

### KQL Queries (Microsoft Sentinel/Defender)

Comprehensive KQL detection queries are provided in:
- **File**: `6717c98c-b3db-490e-b03c-7b3bd3fb02ee_detections.kql`

Key detections include:
1. Mass file creation in user directories (>150 files/minute)
2. WinRAR compression with exfiltration-style arguments
3. Selective mass file deletion patterns
4. File encryption with `.safepay` extension
5. Ransom note creation and display
6. Archive staging with department/exfiltration naming
7. Go binary exhibiting ransomware behaviors
8. Correlation query for multi-phase detection

### LimaCharlie D&R Rules

Detection and Response rules for LimaCharlie are provided in:
- **File**: `6717c98c-b3db-490e-b03c-7b3bd3fb02ee_dr_rules.yaml`

Rules cover:
1. Safepay file extension creation
2. WinRAR execution with suspicious arguments
3. Mass file deletion patterns
4. Ransom note creation
5. Binary drop to C:\F0
6. Multi-indicator behavioral correlation

### YARA Rules

File and memory detection signatures are provided in:
- **File**: `6717c98c-b3db-490e-b03c-7b3bd3fb02ee_rules.yar`

Rules detect:
1. SafePay ransom note content
2. Go binary with embedded WinRAR
3. Encrypted file markers
4. Archive naming patterns
5. PowerShell disk space enumeration

---

## Hardening Guidance

### Quick Wins (Automated)

PowerShell hardening scripts are provided in:
- **File**: `6717c98c-b3db-490e-b03c-7b3bd3fb02ee_hardening.ps1`

Automated hardening includes:
1. Attack Surface Reduction (ASR) rules
2. Controlled Folder Access (CFA)
3. WinRAR execution restrictions via AppLocker
4. Windows Defender real-time protection
5. Backup verification checks

### M1040 - Behavior Prevention on Endpoint

**Implementation Priority**: Critical

| Setting | Value |
|---------|-------|
| **Location** | Windows Security > Virus & threat protection |
| **Recommended Value** | Enabled with cloud-delivered protection |
| **Impact Level** | Low |

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > Windows Components >
Microsoft Defender Antivirus > Real-time Protection > Turn on behavior monitoring
```

**Registry:**
```
Path: HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection
Name: DisableBehaviorMonitoring
Type: REG_DWORD
Value: 0
```

**ASR Rules to Enable:**
| Rule GUID | Rule Name |
|-----------|-----------|
| `d4f940ab-401b-4efc-aadc-ad5f3c50688a` | Block all Office applications from creating child processes |
| `3b576869-a4ec-4529-8536-b80a7769e899` | Block Office applications from creating executable content |
| `5beb7efe-fd9a-4556-801d-275e5ffc04cc` | Block execution of potentially obfuscated scripts |
| `be9ba2d9-53ea-4cdc-84e5-9b1eeee46550` | Block executable content from email client and webmail |
| `c1db55ab-c21a-4637-bb3f-a12568109d35` | Use advanced protection against ransomware |

### M1053 - Data Backup

**Implementation Priority**: Critical

**Recommendations:**
1. Implement 3-2-1 backup strategy (3 copies, 2 media types, 1 offsite)
2. Enable Windows Shadow Copies with protection
3. Use immutable backup storage
4. Test restore procedures regularly
5. Enable Volume Shadow Copy protection

**Verification Command:**
```powershell
# Check Volume Shadow Copy service status
Get-Service VSS | Select-Object Name, Status, StartType

# List existing shadow copies
vssadmin list shadows
```

### M1038 - Execution Prevention

**Implementation Priority**: High

**Block WinRAR from Untrusted Locations:**

Create AppLocker rule to block WinRAR execution from non-standard paths:

```powershell
# Block WinRAR execution from C:\F0 and user temp directories
New-AppLockerPolicy -RuleType Path -Path "C:\F0\WinRAR.exe" -Action Deny -User Everyone
New-AppLockerPolicy -RuleType Path -Path "%TEMP%\WinRAR.exe" -Action Deny -User Everyone
```

### M1057 - Data Loss Prevention

**Implementation Priority**: High

**Recommendations:**
1. Enable Controlled Folder Access
2. Monitor for mass file operations
3. Block unauthorized compression utilities
4. Alert on file extension changes

**Enable Controlled Folder Access:**
```powershell
Set-MpPreference -EnableControlledFolderAccess Enabled
Add-MpPreference -ControlledFolderAccessProtectedFolders "C:\Users\*\Documents"
Add-MpPreference -ControlledFolderAccessProtectedFolders "C:\Users\*\Desktop"
```

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | `6717c98c-b3db-490e-b03c-7b3bd3fb02ee` |
| **Test Name** | SafePay Go-Native Ransomware Simulation |
| **MITRE ATT&CK** | T1486, T1560.001, T1490, T1083, T1005, T1071.001 |
| **Severity** | Critical |
| **Estimated Response Time** | 2-4 hours |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| Mass File Creation | >150 files created in user directory within 1 minute | High | P1 |
| Safepay Encryption | Files with `.safepay` extension created | Critical | P1 |
| WinRAR Data Staging | WinRAR.exe with `-r`, `-m`, archive arguments | High | P1 |
| Mass Deletion | >50 document files deleted within 3 hours | High | P1 |
| Ransom Note | `readme_safepay.txt` created | Critical | P1 |

#### Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What is the scope - single host or multiple endpoints?
3. What user account is associated with the activity?
4. What is the timeline of file system activity?
5. Are shadow copies intact?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Isolate affected host(s)**
  ```powershell
  # Network isolation via Windows Firewall
  netsh advfirewall set allprofiles state on
  netsh advfirewall firewall add rule name="IR-Block-All-Outbound" dir=out action=block
  netsh advfirewall firewall add rule name="IR-Block-All-Inbound" dir=in action=block

  # Allow only IR team access (replace IP with IR workstation)
  netsh advfirewall firewall add rule name="IR-Allow-Admin" dir=in action=allow remoteip=192.168.1.100/32
  ```

- [ ] **Terminate malicious processes**
  ```powershell
  # Kill ransomware process (adjust name as needed)
  Get-Process | Where-Object { $_.Path -like "C:\F0\*" } | Stop-Process -Force

  # Kill WinRAR if running
  Stop-Process -Name "WinRAR" -Force -ErrorAction SilentlyContinue

  # Kill notepad displaying ransom note
  Get-Process notepad | Where-Object { $_.MainWindowTitle -like "*safepay*" } | Stop-Process -Force
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create evidence directory
  $irDir = "C:\IR_Evidence\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  New-Item -ItemType Directory -Path $irDir -Force

  # Capture running processes
  Get-Process | Select-Object * | Export-Csv "$irDir\processes.csv" -NoTypeInformation

  # Capture network connections
  Get-NetTCPConnection | Export-Csv "$irDir\tcp_connections.csv" -NoTypeInformation
  Get-NetUDPEndpoint | Export-Csv "$irDir\udp_endpoints.csv" -NoTypeInformation

  # Capture loaded modules
  Get-Process | ForEach-Object {
      $_.Modules | Select-Object @{N='Process';E={$_.ProcessName}}, FileName, FileVersion
  } | Export-Csv "$irDir\loaded_modules.csv" -NoTypeInformation
  ```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Test execution logs | `C:\F0\safepay_simulation.log` | `Copy-Item "C:\F0\*" -Destination "$irDir\F0_artifacts\" -Recurse` |
| Encrypted files | `C:\Users\fortika-test\*.safepay` | `Get-ChildItem -Path "C:\Users\fortika-test" -Filter "*.safepay" -Recurse` |
| Ransom notes | `readme_safepay.txt` | `Get-ChildItem -Path "C:\Users" -Filter "readme_safepay.txt" -Recurse` |
| Archive files | `*.rar` files | `Get-ChildItem -Path "C:\Users\fortika-test" -Filter "*.rar" -Recurse` |
| Prefetch | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*" -Destination "$irDir\Prefetch\"` |
| Event logs | System | See commands below |

#### Event Log Collection
```powershell
# Export relevant event logs
$logs = @(
    "Security",
    "System",
    "Application",
    "Microsoft-Windows-Sysmon/Operational",
    "Microsoft-Windows-PowerShell/Operational",
    "Microsoft-Windows-Windows Defender/Operational"
)

foreach ($log in $logs) {
    try {
        wevtutil epl $log "$irDir\$($log -replace '/', '_').evtx"
        Write-Host "[+] Exported: $log"
    } catch {
        Write-Host "[!] Failed to export: $log"
    }
}
```

#### File System Timeline
```powershell
# Generate timeline of recently modified files
Get-ChildItem -Path "C:\Users\fortika-test" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-6) } |
    Select-Object FullName, LastWriteTime, Length, Extension |
    Sort-Object LastWriteTime |
    Export-Csv "$irDir\file_timeline.csv" -NoTypeInformation
```

#### Memory Acquisition
```powershell
# Using WinPMEM (if available)
# Download from: https://github.com/Velocidex/WinPmem
.\winpmem_mini_x64.exe "$irDir\memory.raw"

# Alternative: Use Magnet RAM Capture or similar tool
```

---

### 4. Eradication

#### File Removal (AFTER Evidence Collection)
```powershell
# Remove F0RT1KA test artifacts
Remove-Item -Path "C:\F0\*" -Recurse -Force -ErrorAction SilentlyContinue

# Remove encrypted files
Get-ChildItem -Path "C:\Users\fortika-test" -Filter "*.safepay" -Recurse |
    Remove-Item -Force -ErrorAction SilentlyContinue

# Remove ransom notes
Get-ChildItem -Path "C:\Users" -Filter "readme_safepay.txt" -Recurse |
    Remove-Item -Force -ErrorAction SilentlyContinue

# Remove archive files created during attack
Get-ChildItem -Path "C:\Users\fortika-test" -Filter "*.rar" -Recurse |
    Where-Object { $_.Name -match "(Archive|Data|EXFIL)" } |
    Remove-Item -Force -ErrorAction SilentlyContinue
```

#### Persistence Check
```powershell
# Check for unauthorized scheduled tasks
Get-ScheduledTask | Where-Object {
    $_.Actions.Execute -like "*safepay*" -or
    $_.Actions.Execute -like "*C:\F0\*"
}

# Check for suspicious services
Get-Service | Where-Object {
    $_.PathName -like "*C:\F0\*" -or
    $_.DisplayName -like "*safepay*"
}

# Check Run keys
Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
Get-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] Verify all malicious artifacts removed
- [ ] Check shadow copies availability
  ```powershell
  vssadmin list shadows
  ```
- [ ] Restore files from backup if needed
- [ ] Re-enable security controls
  ```powershell
  Set-MpPreference -DisableRealtimeMonitoring $false
  Set-MpPreference -EnableControlledFolderAccess Enabled
  ```
- [ ] Remove network isolation
  ```powershell
  netsh advfirewall firewall delete rule name="IR-Block-All-Outbound"
  netsh advfirewall firewall delete rule name="IR-Block-All-Inbound"
  netsh advfirewall firewall delete rule name="IR-Allow-Admin"
  ```

#### Validation Commands
```powershell
# Verify clean state - no safepay files
$safepayFiles = Get-ChildItem -Path "C:\" -Filter "*.safepay" -Recurse -ErrorAction SilentlyContinue
if ($safepayFiles.Count -eq 0) {
    Write-Host "[+] No .safepay files found - system clean"
} else {
    Write-Host "[!] WARNING: $($safepayFiles.Count) .safepay files still present"
    $safepayFiles | Select-Object FullName
}

# Verify F0 directory clean
if (-not (Test-Path "C:\F0\WinRAR.exe")) {
    Write-Host "[+] WinRAR.exe removed from C:\F0"
} else {
    Write-Host "[!] WARNING: WinRAR.exe still present in C:\F0"
}

# Verify no ransom notes
$ransomNotes = Get-ChildItem -Path "C:\Users" -Filter "readme_safepay.txt" -Recurse -ErrorAction SilentlyContinue
if ($ransomNotes.Count -eq 0) {
    Write-Host "[+] No ransom notes found"
} else {
    Write-Host "[!] WARNING: Ransom notes still present"
}
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which rule/alert triggered first?)
2. What was the detection-to-containment time?
3. Were shadow copies protected/available for recovery?
4. What detection gaps were identified?
5. Was the attack simulation or real threat activity?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Enable Sysmon with file creation/deletion logging | High |
| Detection | Implement behavioral analytics for mass file operations | High |
| Prevention | Enable Controlled Folder Access on all endpoints | Critical |
| Prevention | Block execution of compression utilities from temp directories | High |
| Prevention | Enable Attack Surface Reduction rules | Critical |
| Response | Pre-stage memory acquisition tools on endpoints | Medium |
| Recovery | Implement immutable backup solution | Critical |
| Recovery | Test shadow copy restoration procedures | High |

---

## References

### MITRE ATT&CK
- [T1486 - Data Encrypted for Impact](https://attack.mitre.org/techniques/T1486/)
- [T1560.001 - Archive Collected Data: Archive via Utility](https://attack.mitre.org/techniques/T1560/001/)
- [T1490 - Inhibit System Recovery](https://attack.mitre.org/techniques/T1490/)
- [T1083 - File and Directory Discovery](https://attack.mitre.org/techniques/T1083/)
- [T1005 - Data from Local System](https://attack.mitre.org/techniques/T1005/)

### Microsoft Security
- [Attack Surface Reduction Rules](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction)
- [Controlled Folder Access](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/controlled-folders)
- [Windows Defender Configuration](https://docs.microsoft.com/en-us/windows/security/threat-protection/microsoft-defender-antivirus/configure-microsoft-defender-antivirus-features)

### Ransomware Defense
- [CISA Ransomware Guide](https://www.cisa.gov/stopransomware)
- [No More Ransom Project](https://www.nomoreransom.org/)

---

## Related Files

| File | Description |
|------|-------------|
| `6717c98c-b3db-490e-b03c-7b3bd3fb02ee_detections.kql` | Microsoft Sentinel/Defender KQL queries |
| `6717c98c-b3db-490e-b03c-7b3bd3fb02ee_dr_rules.yaml` | LimaCharlie D&R rules |
| `6717c98c-b3db-490e-b03c-7b3bd3fb02ee_rules.yar` | YARA detection rules |
| `6717c98c-b3db-490e-b03c-7b3bd3fb02ee_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-07*
