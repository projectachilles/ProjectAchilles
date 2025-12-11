# Defense Guidance: Multi-Stage Ransomware Killchain Simulation

## Executive Summary

This document provides comprehensive defensive guidance for protecting against the attack techniques simulated by F0RT1KA test **5ed12ef2-5e29-49a2-8f26-269d8e9edcea** (Multi-Stage Ransomware Killchain). The test simulates a complete 5-stage ransomware attack chain based on documented threat actor behaviors from Conti, LockBit, and BlackCat/ALPHV ransomware families.

**Test ID:** 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
**Test Name:** Multi-Stage Ransomware Killchain Simulation
**Severity:** Critical
**MITRE ATT&CK Techniques:** T1204.002, T1134.001, T1083, T1486, T1491.001

---

## Threat Overview

### Attack Chain Summary

| Stage | Technique | Tactic | Description | Critical |
|-------|-----------|--------|-------------|----------|
| 1 | T1204.002 | Execution | User Execution - Malicious File | No |
| 2 | T1134.001 | Privilege Escalation | Access Token Manipulation | **Yes** |
| 3 | T1083 | Discovery | File and Directory Discovery | No |
| 4 | T1486 | Impact | Data Encrypted for Impact | **Yes** |
| 5 | T1491.001 | Impact | Internal Defacement (Ransom Notes) | No |

### Attack Flow

```
Initial Execution (T1204.002)
         |
         v
Privilege Escalation (T1134.001) <-- CRITICAL DETECTION POINT
         |
         v
File Discovery (T1083)
         |
         v
Encryption (T1486) <-- CRITICAL DETECTION POINT
         |
         v
Ransom Note Deployment (T1491.001)
```

### Threat Actor References

- **Conti Ransomware**: Token manipulation, rapid encryption, multi-location ransom notes
- **LockBit 3.0**: Multi-stage execution, privilege escalation, aggressive file discovery
- **BlackCat/ALPHV**: AES-256 encryption, wallpaper modification, multiple ransom note formats

---

## MITRE ATT&CK Mapping with Mitigations

### Technique-to-Mitigation Matrix

| Technique | Technique Name | Applicable Mitigations |
|-----------|----------------|------------------------|
| T1204.002 | User Execution: Malicious File | M1040, M1038, M1017 |
| T1134.001 | Access Token Manipulation | M1026, M1018 |
| T1083 | File and Directory Discovery | (Detection-focused) |
| T1486 | Data Encrypted for Impact | M1040, M1053 |
| T1491.001 | Internal Defacement | M1053 |

### Mitigation Details

#### M1040 - Behavior Prevention on Endpoint
**Applicable Techniques:** T1204.002, T1486

Enable Attack Surface Reduction (ASR) rules and cloud-delivered protection to block ransomware-like file execution and potentially malicious executables that don't meet prevalence, age, or trusted list criteria.

**Implementation:**
```powershell
# Enable ASR rules for ransomware protection
Set-MpPreference -AttackSurfaceReductionRules_Ids `
    "d4f940ab-401b-4efc-aadc-ad5f3c50688a",`    # Block executable files from running
    "3b576869-a4ec-4529-8536-b80a7769e899",`    # Block Office applications from creating executables
    "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550",`    # Block executable content from email
    "c1db55ab-c21a-4637-bb3f-a12568109d35" `    # Use advanced protection against ransomware
    -AttackSurfaceReductionRules_Actions Enabled
```

#### M1053 - Data Backup
**Applicable Techniques:** T1486, T1491.001

Implement regular backup procedures with offline/air-gapped storage. Enable versioning in cloud environments.

**Key Requirements:**
- 3-2-1 backup strategy (3 copies, 2 media types, 1 offsite)
- Air-gapped backup storage
- Regular backup testing and verification
- Immutable backup copies where possible

#### M1026 - Privileged Account Management
**Applicable Techniques:** T1134.001

Restrict token creation permissions via Group Policy:
- "Create a token object" - Local System only
- "Replace a process level token" - Local System only

**GPO Path:**
```
Computer Configuration > Windows Settings > Security Settings >
Local Policies > User Rights Assignment
```

#### M1038 - Execution Prevention
**Applicable Techniques:** T1204.002

Deploy application control (AppLocker, WDAC) to block executables masquerading as other file types.

#### M1018 - User Account Management
**Applicable Techniques:** T1134.001

Implement least-privilege access controls ensuring users have minimal necessary permissions.

#### M1017 - User Training
**Applicable Techniques:** T1204.002

Security awareness training on phishing, suspicious files, and social engineering tactics.

---

## Detection Rules

### KQL Queries (Microsoft Sentinel/Defender)

See `5ed12ef2-5e29-49a2-8f26-269d8e9edcea_detections.kql` for complete detection queries.

**Query Categories:**
1. Mass File Operations Detection (Stage 4)
2. Token Manipulation Detection (Stage 2)
3. File Extension Changes Detection (Stage 4)
4. Ransom Note Deployment Detection (Stage 5)
5. Privilege Escalation Detection (Stage 2)
6. Multi-Stage Behavioral Correlation

### LimaCharlie D&R Rules

See `5ed12ef2-5e29-49a2-8f26-269d8e9edcea_dr_rules.yaml` for deployment-ready rules.

**Rule Categories:**
1. F0RT1KA Test Execution Detection
2. Token Manipulation Attempts
3. Rapid File Encryption Pattern
4. Ransom Note Creation
5. Behavioral Correlation Rule

### YARA Rules

See `5ed12ef2-5e29-49a2-8f26-269d8e9edcea_rules.yar` for file and memory detection signatures.

**Rule Categories:**
1. Ransomware Component Detection
2. Ransom Note Content Detection
3. Encrypted File Marker Detection
4. Stage Binary Signatures

---

## Hardening Guidance

### Quick Wins (Immediate Implementation)

See `5ed12ef2-5e29-49a2-8f26-269d8e9edcea_hardening.ps1` for automated hardening script.

**Script Capabilities:**
- Enable Controlled Folder Access
- Configure ASR rules
- Restrict token manipulation
- Enable tamper protection
- Configure Windows Firewall rules
- Support for undo/rollback

### Complex Hardening

#### 1. Controlled Folder Access

**MITRE Mitigation:** M1040 - Behavior Prevention on Endpoint

| Setting | Value |
|---------|-------|
| **Location** | Windows Security > Virus & threat protection |
| **Recommended Value** | Enabled |
| **Default Value** | Disabled |
| **Impact Level** | Medium |

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > Windows Components >
Microsoft Defender Antivirus > Microsoft Defender Exploit Guard >
Controlled Folder Access > Configure Controlled folder access
```

**Registry Equivalent:**
```
Path: HKLM\SOFTWARE\Microsoft\Windows Defender\Windows Defender Exploit Guard\Controlled Folder Access
Name: EnableControlledFolderAccess
Type: REG_DWORD
Value: 1
```

**Verification Command:**
```powershell
Get-MpPreference | Select-Object EnableControlledFolderAccess
```

**Considerations:**
- May block legitimate applications from writing to protected folders
- Whitelist required applications before deployment
- Monitor for false positives during rollout

#### 2. Restrict Token Manipulation

**MITRE Mitigation:** M1026 - Privileged Account Management

| Setting | Value |
|---------|-------|
| **Location** | Local Security Policy |
| **Recommended Value** | Local System only |
| **Default Value** | Not configured |
| **Impact Level** | Low |

**Group Policy Path:**
```
Computer Configuration > Windows Settings > Security Settings >
Local Policies > User Rights Assignment > Create a token object
```

**Verification Command:**
```powershell
secedit /export /cfg c:\temp\secpol.cfg
Select-String "SeCreateTokenPrivilege" c:\temp\secpol.cfg
```

#### 3. Application Control (AppLocker/WDAC)

**MITRE Mitigation:** M1038 - Execution Prevention

**Recommended Rules:**
- Block executables in user-writable directories
- Block script execution from Downloads/Temp
- Whitelist approved applications only

**AppLocker Quick Start:**
```powershell
# Create default rules
Set-AppLockerPolicy -XMLPolicy (Get-AppLockerPolicy -Effective -Xml) -LDAP
```

#### 4. Disable Dangerous Privileges

**MITRE Mitigation:** M1026 - Privileged Account Management

Restrict the following privileges via GPO:
- SeDebugPrivilege - Debug programs
- SeBackupPrivilege - Backup files and directories
- SeRestorePrivilege - Restore files and directories
- SeTakeOwnershipPrivilege - Take ownership of files

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 5ed12ef2-5e29-49a2-8f26-269d8e9edcea |
| **Test Name** | Multi-Stage Ransomware Killchain Simulation |
| **MITRE ATT&CK** | [T1204.002](https://attack.mitre.org/techniques/T1204/002/), [T1134.001](https://attack.mitre.org/techniques/T1134/001/), [T1083](https://attack.mitre.org/techniques/T1083/), [T1486](https://attack.mitre.org/techniques/T1486/), [T1491.001](https://attack.mitre.org/techniques/T1491/001/) |
| **Severity** | Critical |
| **Estimated Response Time** | 2-4 hours |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| Mass File Encryption | >50 files modified in 5 min window | High | P1 |
| Token Manipulation | OpenProcess on winlogon/lsass | High | P1 |
| Privilege Escalation | SeDebugPrivilege enabled | High | P2 |
| Ransom Note Deployment | README_RANSOMWARE.txt created | High | P2 |
| File Extension Change | .f0rtika extension added | High | P1 |
| Rapid File Discovery | >100 files enumerated rapidly | Medium | P3 |

#### Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What is the scope - single host or multiple endpoints?
3. What user account is associated with the activity?
4. What is the timeline of activity (stages executed)?
5. Are encrypted files (.f0rtika) present?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Isolate affected host(s)**
  ```powershell
  # Network isolation via Windows Firewall
  New-NetFirewallRule -DisplayName "IR_Block_Outbound" -Direction Outbound -Action Block
  New-NetFirewallRule -DisplayName "IR_Block_Inbound" -Direction Inbound -Action Block

  # Allow management traffic only
  New-NetFirewallRule -DisplayName "IR_Allow_RDP" -Direction Inbound -LocalPort 3389 -Protocol TCP -Action Allow
  ```

- [ ] **Terminate malicious processes**
  ```powershell
  # Kill F0RT1KA test processes
  Get-Process | Where-Object { $_.Path -like "C:\F0\*" } | Stop-Process -Force

  # Kill by specific stage binary names
  @(
      "5ed12ef2-5e29-49a2-8f26-269d8e9edcea*"
  ) | ForEach-Object {
      Get-Process -Name $_ -ErrorAction SilentlyContinue | Stop-Process -Force
  }
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create evidence directory
  $evidenceDir = "C:\IR_Evidence_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  New-Item -ItemType Directory -Path $evidenceDir -Force

  # Capture running processes
  Get-Process | Export-Csv "$evidenceDir\processes.csv" -NoTypeInformation

  # Capture network connections
  Get-NetTCPConnection | Export-Csv "$evidenceDir\tcp_connections.csv" -NoTypeInformation
  Get-NetUDPEndpoint | Export-Csv "$evidenceDir\udp_endpoints.csv" -NoTypeInformation

  # Capture loaded modules
  Get-Process | ForEach-Object {
      $_.Modules | Select-Object ModuleName, FileName
  } | Export-Csv "$evidenceDir\loaded_modules.csv" -NoTypeInformation
  ```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Test execution logs | `C:\F0\test_execution_log.json` | `Copy-Item "C:\F0\*" -Destination "$evidenceDir\F0_artifacts\" -Recurse` |
| Encrypted files | `C:\F0\test_documents\*.f0rtika` | `Get-ChildItem "C:\F0" -Recurse -Filter "*.f0rtika"` |
| Ransom notes | Multiple locations | See collection script below |
| Event logs | System/Security | `wevtutil epl Security "$evidenceDir\Security.evtx"` |
| Prefetch | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*" -Destination "$evidenceDir\Prefetch\"` |
| Master key | `C:\F0\MASTER_KEY.key` | `Copy-Item "C:\F0\MASTER_KEY.key" "$evidenceDir\"` |

#### Ransom Note Collection
```powershell
# Collect ransom notes from all deployment locations
$ransomNotePaths = @(
    "C:\F0\README_RANSOMWARE.txt",
    "C:\F0\YOUR_FILES_ENCRYPTED.html",
    "$env:USERPROFILE\Desktop\README_RANSOMWARE.txt",
    "$env:USERPROFILE\Desktop\YOUR_FILES_ENCRYPTED.html",
    "$env:USERPROFILE\Documents\README_RANSOMWARE.txt",
    "$env:USERPROFILE\Documents\YOUR_FILES_ENCRYPTED.html",
    "C:\Users\Public\Desktop\README_RANSOMWARE.txt",
    "C:\Users\Public\Desktop\YOUR_FILES_ENCRYPTED.html"
)

$ransomNotePaths | ForEach-Object {
    if (Test-Path $_) {
        Copy-Item $_ "$evidenceDir\ransom_notes\" -Force
    }
}
```

#### Event Log Collection
```powershell
# Export relevant event logs
$logs = @(
    "Security",
    "System",
    "Microsoft-Windows-Sysmon/Operational",
    "Microsoft-Windows-Windows Defender/Operational",
    "Microsoft-Windows-PowerShell/Operational"
)

foreach ($log in $logs) {
    $safeLogName = $log -replace '/', '_'
    wevtutil epl $log "$evidenceDir\$safeLogName.evtx" 2>$null
}
```

---

### 4. Eradication

#### File Removal (AFTER evidence collection)

```powershell
# Remove F0RT1KA test artifacts
Remove-Item -Path "C:\F0" -Recurse -Force -ErrorAction SilentlyContinue

# Remove ransom notes from user directories
$ransomFiles = @(
    "README_RANSOMWARE.txt",
    "YOUR_FILES_ENCRYPTED.html",
    "PAYMENT_INSTRUCTIONS.txt"
)

$locations = @(
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Documents",
    "$env:USERPROFILE",
    "C:\Users\Public\Desktop"
)

foreach ($location in $locations) {
    foreach ($file in $ransomFiles) {
        $path = Join-Path $location $file
        if (Test-Path $path) {
            Remove-Item $path -Force
            Write-Host "Removed: $path"
        }
    }
}
```

#### Registry Cleanup

```powershell
# Remove wallpaper modification (if applied)
$desktopKey = "HKCU:\Control Panel\Desktop"
$originalWallpaper = Get-ItemProperty $desktopKey -Name Wallpaper -ErrorAction SilentlyContinue

if ($originalWallpaper.Wallpaper -like "*ransomware*") {
    Set-ItemProperty $desktopKey -Name Wallpaper -Value ""
    Write-Host "Reverted wallpaper setting"
}

# Remove any persistence (if test added it)
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Remove-ItemProperty $runKey -Name "Ransomware" -ErrorAction SilentlyContinue
```

#### Use Recovery Script

If the test deployed the recovery script:
```powershell
# Run F0RT1KA recovery script
if (Test-Path "C:\F0\ransomware_recovery.ps1") {
    powershell -ExecutionPolicy Bypass -File "C:\F0\ransomware_recovery.ps1"
}
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] Verify all malicious artifacts removed
- [ ] Restore any modified configurations
- [ ] Re-enable security controls
- [ ] Verify EDR/AV is operational
- [ ] Remove network isolation (after validation)
- [ ] Verify backup integrity

#### Validation Commands

```powershell
# Verify clean state
Write-Host "=== Verification Checks ==="

# Check F0 directory is gone
if (Test-Path "C:\F0") {
    Write-Host "[WARN] C:\F0 still exists" -ForegroundColor Yellow
    Get-ChildItem "C:\F0" -Recurse
} else {
    Write-Host "[OK] C:\F0 removed" -ForegroundColor Green
}

# Check for encrypted files
$encryptedFiles = Get-ChildItem -Path $env:USERPROFILE -Recurse -Filter "*.f0rtika" -ErrorAction SilentlyContinue
if ($encryptedFiles) {
    Write-Host "[WARN] Encrypted files still present:" -ForegroundColor Yellow
    $encryptedFiles | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "[OK] No encrypted files found" -ForegroundColor Green
}

# Check for ransom notes
$ransomNoteLocations = @(
    "$env:USERPROFILE\Desktop\README_RANSOMWARE.txt",
    "$env:USERPROFILE\Documents\README_RANSOMWARE.txt"
)
$notesFound = $ransomNoteLocations | Where-Object { Test-Path $_ }
if ($notesFound) {
    Write-Host "[WARN] Ransom notes still present:" -ForegroundColor Yellow
    $notesFound | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "[OK] No ransom notes found" -ForegroundColor Green
}

# Verify Defender is running
$defenderStatus = Get-MpComputerStatus
if ($defenderStatus.AntivirusEnabled) {
    Write-Host "[OK] Windows Defender enabled" -ForegroundColor Green
} else {
    Write-Host "[WARN] Windows Defender disabled" -ForegroundColor Yellow
}
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which rule/alert triggered?)
2. At which stage was the attack blocked (if protected)?
3. What was the detection-to-response time?
4. Were all 5 stages logged appropriately?
5. What would have prevented this attack at an earlier stage?
6. What detection gaps were identified?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Deploy mass file operation detection rules | High |
| Detection | Implement token manipulation monitoring | High |
| Prevention | Enable Controlled Folder Access | High |
| Prevention | Deploy ASR rules for ransomware | High |
| Prevention | Implement application control | Medium |
| Response | Create automated containment playbook | Medium |
| Recovery | Verify backup and recovery procedures | High |

#### Security Control Validation

After remediation, re-run the F0RT1KA test to validate protections:
```powershell
# Re-run test to verify protection
C:\path\to\5ed12ef2-5e29-49a2-8f26-269d8e9edcea.exe

# Check exit code
$exitCode = $LASTEXITCODE
switch ($exitCode) {
    126 { Write-Host "PROTECTED: Attack blocked by EDR" -ForegroundColor Green }
    105 { Write-Host "PROTECTED: Binary quarantined" -ForegroundColor Green }
    101 { Write-Host "VULNERABLE: Attack succeeded" -ForegroundColor Red }
    999 { Write-Host "ERROR: Test failed to run" -ForegroundColor Yellow }
}
```

---

## References

### MITRE ATT&CK

- [T1204.002 - User Execution: Malicious File](https://attack.mitre.org/techniques/T1204/002/)
- [T1134.001 - Access Token Manipulation](https://attack.mitre.org/techniques/T1134/001/)
- [T1083 - File and Directory Discovery](https://attack.mitre.org/techniques/T1083/)
- [T1486 - Data Encrypted for Impact](https://attack.mitre.org/techniques/T1486/)
- [T1491.001 - Defacement: Internal Defacement](https://attack.mitre.org/techniques/T1491/001/)

### Mitigations

- [M1040 - Behavior Prevention on Endpoint](https://attack.mitre.org/mitigations/M1040/)
- [M1053 - Data Backup](https://attack.mitre.org/mitigations/M1053/)
- [M1026 - Privileged Account Management](https://attack.mitre.org/mitigations/M1026/)
- [M1038 - Execution Prevention](https://attack.mitre.org/mitigations/M1038/)
- [M1018 - User Account Management](https://attack.mitre.org/mitigations/M1018/)
- [M1017 - User Training](https://attack.mitre.org/mitigations/M1017/)

### Microsoft Security

- [Attack Surface Reduction Rules](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction)
- [Controlled Folder Access](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/controlled-folders)
- [Windows Defender Application Control](https://docs.microsoft.com/en-us/windows/security/threat-protection/windows-defender-application-control/wdac-and-applocker-overview)

### Threat Intelligence

- [CISA Ransomware Guide](https://www.cisa.gov/stopransomware)
- [NIST Ransomware Risk Management](https://www.nist.gov/itl/applied-cybersecurity/nist-cybersecurity-insights/ransomware-risk-management)

---

## Appendix: Detection Rule Files

| File | Purpose |
|------|---------|
| `5ed12ef2-5e29-49a2-8f26-269d8e9edcea_detections.kql` | Microsoft Sentinel KQL queries |
| `5ed12ef2-5e29-49a2-8f26-269d8e9edcea_dr_rules.yaml` | LimaCharlie D&R rules |
| `5ed12ef2-5e29-49a2-8f26-269d8e9edcea_rules.yar` | YARA detection rules |
| `5ed12ef2-5e29-49a2-8f26-269d8e9edcea_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2024-01-15*
