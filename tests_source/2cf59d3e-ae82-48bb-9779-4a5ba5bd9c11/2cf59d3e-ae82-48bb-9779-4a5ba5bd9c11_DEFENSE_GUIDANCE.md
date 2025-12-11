# Defense Guidance: SafePay UAC Bypass & Defense Evasion

## Executive Summary

This document provides comprehensive defensive guidance for detecting, preventing, and responding to the attack techniques simulated by the F0RT1KA security test **SafePay UAC Bypass & Defense Evasion** (Test ID: `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11`).

The test simulates a sophisticated multi-stage attack that:
1. Bypasses User Account Control (UAC) via the CMSTPLUA COM interface
2. Establishes registry-based persistence via Run keys
3. Attempts to disable Windows Defender through GUI automation

These techniques are actively used by the SafePay ransomware family and represent a serious threat to enterprise environments.

---

## Threat Overview

| Field | Value |
|-------|-------|
| **Test ID** | 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11 |
| **Test Name** | SafePay UAC Bypass & Defense Evasion |
| **Category** | Privilege Escalation / Defense Evasion |
| **Severity** | High |
| **Test Score** | 8.3/10 |

### Attack Chain Summary

```
[Initial Access] --> [Script Drop] --> [UAC Bypass] --> [Persistence] --> [Defense Evasion]
     |                   |                 |                |                    |
     v                   v                 v                v                    v
  Execution        c:\F0\*.ps1       CMSTPLUA COM     Registry Run      Defender Disable
                                     Auto-Elevate       Keys             GUI Automation
```

### Key Indicators

| Indicator Type | Value |
|---------------|-------|
| **Script Path** | `c:\F0\safepay_uac_bypass.ps1` |
| **COM GUID** | `{3E5FC7F9-9A51-4367-9063-A120244FBEC7}` (CMSTPLUA) |
| **Registry Path** | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` |
| **Registry Name** | `SafePayService` |
| **Registry Value** | `6F22-C16F-0C71-688A` |

---

## MITRE ATT&CK Mapping

| Technique ID | Technique Name | Tactic | Description |
|--------------|----------------|--------|-------------|
| [T1548.002](https://attack.mitre.org/techniques/T1548/002/) | Abuse Elevation Control Mechanism: Bypass User Account Control | Privilege Escalation, Defense Evasion | Uses CMSTPLUA COM object to bypass UAC |
| [T1562.001](https://attack.mitre.org/techniques/T1562/001/) | Impair Defenses: Disable or Modify Tools | Defense Evasion | Attempts to disable Windows Defender |
| [T1547.001](https://attack.mitre.org/techniques/T1547/001/) | Boot or Logon Autostart Execution: Registry Run Keys | Persistence | Creates autorun registry entry |

### Applicable Mitigations

| Mitigation ID | Name | Applicable Techniques |
|---------------|------|----------------------|
| [M1047](https://attack.mitre.org/mitigations/M1047/) | Audit | T1548.002, T1562.001 |
| [M1026](https://attack.mitre.org/mitigations/M1026/) | Privileged Account Management | T1548.002 |
| [M1051](https://attack.mitre.org/mitigations/M1051/) | Update Software | T1548.002 |
| [M1052](https://attack.mitre.org/mitigations/M1052/) | User Account Control | T1548.002 |
| [M1038](https://attack.mitre.org/mitigations/M1038/) | Execution Prevention | T1562.001 |
| [M1022](https://attack.mitre.org/mitigations/M1022/) | Restrict File and Directory Permissions | T1562.001 |
| [M1024](https://attack.mitre.org/mitigations/M1024/) | Restrict Registry Permissions | T1562.001 |
| [M1018](https://attack.mitre.org/mitigations/M1018/) | User Account Management | T1562.001 |

---

## Detection Rules

### KQL Queries (Microsoft Sentinel/Defender)

See companion file: `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_detections.kql`

**Query Categories:**
1. **CMSTPLUA COM Object Detection** - Detects UAC bypass via COM object creation
2. **PowerShell Execution Policy Bypass** - Suspicious script execution patterns
3. **Registry Run Key Persistence** - Autorun persistence creation
4. **SafePay-Specific Indicators** - Known malware signatures and values
5. **Defense Evasion Behavior** - Windows Defender tampering attempts
6. **Behavioral Correlation** - Multi-indicator high-confidence detection

### LimaCharlie D&R Rules

See companion file: `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_dr_rules.yaml`

**Rule Coverage:**
- NEW_PROCESS events for PowerShell execution policy bypass
- REGISTRY_VALUE_SET events for Run key persistence
- FILE_CREATE events for suspicious script drops

### YARA Rules

See companion file: `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_rules.yar`

**Detection Targets:**
- CMSTPLUA COM GUID patterns
- SafePay-specific registry value patterns
- PowerShell execution bypass patterns
- GUI automation P/Invoke signatures

---

## Hardening Guidance

### Quick Wins (PowerShell Scripts)

See companion file: `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_hardening.ps1`

**Script Capabilities:**
- UAC enforcement settings
- PowerShell execution policy hardening
- Registry Run key monitoring/restrictions
- Tamper protection verification
- Automatic rollback support

### UAC Hardening (M1052)

**Group Policy Path:**
```
Computer Configuration > Windows Settings > Security Settings >
Local Policies > Security Options > User Account Control: Run all administrators in Admin Approval Mode
```

**Registry Equivalent:**
```
Path: HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System
Name: EnableLUA
Type: REG_DWORD
Value: 1
```

**Additional UAC Settings:**

| Setting | Value | Purpose |
|---------|-------|---------|
| `ConsentPromptBehaviorAdmin` | 2 | Prompt for credentials on secure desktop |
| `PromptOnSecureDesktop` | 1 | Force secure desktop for prompts |
| `EnableVirtualization` | 1 | Enable file/registry virtualization |
| `FilterAdministratorToken` | 1 | Filter built-in admin token |

### Privileged Account Management (M1026)

Remove standard users from local Administrators group:
```powershell
# List current local admin members
Get-LocalGroupMember -Group "Administrators"

# Remove user from local admins
Remove-LocalGroupMember -Group "Administrators" -Member "DOMAIN\User"
```

### Attack Surface Reduction Rules (M1038)

Enable ASR rules to block script execution:
```powershell
# Block Office applications from creating executable content
Set-MpPreference -AttackSurfaceReductionRules_Ids d4f940ab-401b-4efc-aadc-ad5f3c50688a -AttackSurfaceReductionRules_Actions Enabled

# Block executable content from email client and webmail
Set-MpPreference -AttackSurfaceReductionRules_Ids be9ba2d9-53ea-4cdc-84e5-9b1eeee46550 -AttackSurfaceReductionRules_Actions Enabled

# Block process creations from PSExec and WMI commands
Set-MpPreference -AttackSurfaceReductionRules_Ids d1e49aac-8f56-4280-b9ba-993a6d77406c -AttackSurfaceReductionRules_Actions Enabled
```

### Defender Tamper Protection

Ensure Tamper Protection is enabled:
```powershell
# Check tamper protection status
Get-MpComputerStatus | Select-Object IsTamperProtected

# Tamper Protection can only be enabled via:
# 1. Microsoft 365 Defender portal
# 2. Intune/Configuration Manager
# 3. Windows Security app
```

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11 |
| **Test Name** | SafePay UAC Bypass & Defense Evasion |
| **MITRE ATT&CK** | T1548.002, T1562.001, T1547.001 |
| **Severity** | High |
| **Estimated Response Time** | 30-60 minutes |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| CMSTPLUA UAC Bypass | COM object creation with GUID {3E5FC7F9-9A51-4367-9063-A120244FBEC7} | High | P1 |
| SafePay Registry Persistence | Run key value = "6F22-C16F-0C71-688A" | High | P1 |
| Suspicious PowerShell Bypass | `-ExecutionPolicy Bypass` with script from c:\F0 | High | P2 |
| Defender Tampering Attempt | GUI automation targeting Windows Security | Medium | P2 |
| Registry Run Key Modification | New value at CurrentVersion\Run from suspicious process | Medium | P3 |

#### Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What is the scope - single host or multiple?
3. What user account is associated with the activity?
4. What is the timeline - when did activity first occur?
5. Has the registry persistence been verified as present?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Isolate affected host(s)**
  ```powershell
  # Network isolation via Windows Firewall
  netsh advfirewall set allprofiles state on
  netsh advfirewall firewall add rule name="IR-Block-All-Outbound" dir=out action=block
  netsh advfirewall firewall add rule name="IR-Block-All-Inbound" dir=in action=block

  # Allow RDP for IR team (adjust IP as needed)
  netsh advfirewall firewall add rule name="IR-Allow-RDP" dir=in protocol=tcp localport=3389 action=allow remoteip=10.0.0.0/8
  ```

- [ ] **Remove persistence immediately**
  ```powershell
  # Remove SafePay registry persistence
  Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SafePayService" -ErrorAction SilentlyContinue

  # Verify removal
  Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SafePayService" -ErrorAction SilentlyContinue
  ```

- [ ] **Terminate malicious processes**
  ```powershell
  # Kill any PowerShell processes running from c:\F0
  Get-Process -Name powershell, pwsh -ErrorAction SilentlyContinue | Where-Object {
      $_.MainModule.FileName -match "c:\\F0" -or
      (Get-WmiObject Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match "c:\\F0"
  } | Stop-Process -Force
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create IR evidence directory
  $IRPath = "C:\IR\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  New-Item -ItemType Directory -Path $IRPath -Force

  # Capture running processes
  Get-Process | Export-Csv "$IRPath\processes.csv" -NoTypeInformation

  # Capture network connections
  Get-NetTCPConnection | Export-Csv "$IRPath\tcp_connections.csv" -NoTypeInformation
  Get-NetUDPEndpoint | Export-Csv "$IRPath\udp_endpoints.csv" -NoTypeInformation

  # Capture registry Run keys
  Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" | Export-Csv "$IRPath\run_keys_hkcu.csv" -NoTypeInformation
  Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" | Export-Csv "$IRPath\run_keys_hklm.csv" -NoTypeInformation

  # Capture scheduled tasks
  Get-ScheduledTask | Export-Csv "$IRPath\scheduled_tasks.csv" -NoTypeInformation
  ```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| F0RT1KA test artifacts | `c:\F0\*` | `Copy-Item "c:\F0\*" -Destination "$IRPath\F0_artifacts\" -Recurse` |
| PowerShell script | `c:\F0\safepay_uac_bypass.ps1` | `Copy-Item "c:\F0\safepay_uac_bypass.ps1" -Destination "$IRPath\"` |
| Test execution log | `c:\F0\*_log.json` | `Copy-Item "c:\F0\*_log.json" -Destination "$IRPath\"` |
| Security event log | `Security.evtx` | `wevtutil epl Security "$IRPath\Security.evtx"` |
| PowerShell logs | `Microsoft-Windows-PowerShell` | `wevtutil epl "Microsoft-Windows-PowerShell/Operational" "$IRPath\PowerShell.evtx"` |
| Prefetch files | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*POWERSHELL*" -Destination "$IRPath\Prefetch\"` |

#### Registry Evidence Collection
```powershell
# Export relevant registry hives
reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" "$IRPath\reg_hkcu_run.reg"
reg export "HKCU\Software\Classes\CLSID" "$IRPath\reg_hkcu_clsid.reg"
reg export "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "$IRPath\reg_uac_settings.reg"
```

#### PowerShell Script Block Logging
```powershell
# Get PowerShell script block logs (shows actual script content)
Get-WinEvent -LogName "Microsoft-Windows-PowerShell/Operational" -FilterXPath "*[System[EventID=4104]]" |
    Select-Object TimeCreated, Message |
    Export-Csv "$IRPath\powershell_scriptblocks.csv" -NoTypeInformation
```

#### COM Object Creation Events
```powershell
# Get COM object creation events
Get-WinEvent -LogName "Microsoft-Windows-Security-Auditing" -FilterXPath "*[System[EventID=4688]]" |
    Where-Object { $_.Message -match "CMSTPLUA|3E5FC7F9-9A51-4367-9063-A120244FBEC7" } |
    Export-Csv "$IRPath\com_creation_events.csv" -NoTypeInformation
```

---

### 4. Eradication

#### File Removal
```powershell
# Remove attack artifacts (AFTER evidence collection)
Remove-Item -Path "c:\F0\safepay_uac_bypass.ps1" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "c:\F0\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "c:\F0" -Force -ErrorAction SilentlyContinue

# Verify removal
Test-Path "c:\F0"  # Should return False
```

#### Registry Cleanup
```powershell
# Remove SafePay persistence entries
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SafePayService" -ErrorAction SilentlyContinue

# Check for other suspicious Run key entries
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" | Format-List
Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" | Format-List
```

#### Verify Defender Status
```powershell
# Ensure Windows Defender is functioning
Get-MpComputerStatus | Select-Object AMServiceEnabled, RealTimeProtectionEnabled, IsTamperProtected, AntivirusSignatureLastUpdated

# Force signature update
Update-MpSignature

# Run quick scan
Start-MpScan -ScanType QuickScan
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] All malicious artifacts removed
- [ ] Registry persistence entries deleted
- [ ] Windows Defender status verified as enabled
- [ ] UAC settings verified at expected level
- [ ] Network connectivity restored (after validation)
- [ ] User credentials rotated (if compromised)

#### Validation Commands
```powershell
# Verify clean state
Write-Host "=== Verification Results ===" -ForegroundColor Cyan

# Check F0 directory
$f0Exists = Test-Path "c:\F0"
Write-Host "c:\F0 directory exists: $f0Exists" -ForegroundColor $(if($f0Exists){"Red"}else{"Green"})

# Check SafePay persistence
$safepayKey = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SafePayService" -ErrorAction SilentlyContinue
Write-Host "SafePayService registry key exists: $($null -ne $safepayKey)" -ForegroundColor $(if($null -ne $safepayKey){"Red"}else{"Green"})

# Check Defender status
$defenderStatus = Get-MpComputerStatus
Write-Host "Real-Time Protection enabled: $($defenderStatus.RealTimeProtectionEnabled)" -ForegroundColor $(if($defenderStatus.RealTimeProtectionEnabled){"Green"}else{"Red"})
Write-Host "Tamper Protection enabled: $($defenderStatus.IsTamperProtected)" -ForegroundColor $(if($defenderStatus.IsTamperProtected){"Green"}else{"Yellow"})

# Check UAC status
$uacEnabled = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name EnableLUA).EnableLUA
Write-Host "UAC enabled: $($uacEnabled -eq 1)" -ForegroundColor $(if($uacEnabled -eq 1){"Green"}else{"Red"})
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which detection rule/alert?)
2. What was the detection-to-response time?
3. What would have prevented this attack?
4. What detection gaps were identified?
5. Were UAC settings at the highest level?
6. Was Tamper Protection enabled?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| **Prevention** | Enable UAC at highest level (AlwaysNotify) | High |
| **Prevention** | Enable Tamper Protection | High |
| **Prevention** | Implement PowerShell Constrained Language Mode | High |
| **Detection** | Deploy KQL queries from this guidance | High |
| **Detection** | Enable PowerShell Script Block Logging | High |
| **Detection** | Monitor Registry Run key modifications | Medium |
| **Response** | Create automated containment playbook | Medium |
| **Hardening** | Remove users from local Administrators group | Medium |

---

## References

### MITRE ATT&CK
- [T1548.002 - Bypass User Account Control](https://attack.mitre.org/techniques/T1548/002/)
- [T1562.001 - Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/)
- [T1547.001 - Registry Run Keys](https://attack.mitre.org/techniques/T1547/001/)

### Mitigations
- [M1047 - Audit](https://attack.mitre.org/mitigations/M1047/)
- [M1026 - Privileged Account Management](https://attack.mitre.org/mitigations/M1026/)
- [M1051 - Update Software](https://attack.mitre.org/mitigations/M1051/)
- [M1052 - User Account Control](https://attack.mitre.org/mitigations/M1052/)
- [M1038 - Execution Prevention](https://attack.mitre.org/mitigations/M1038/)

### External Resources
- [CMSTPLUA UAC Bypass Documentation](https://www.activecyber.us/activelabs/windows-uac-bypass)
- [SafePay Malware Analysis - Secureworks](https://www.secureworks.com/research/safepay-malware)
- [Microsoft - UAC Group Policy Settings](https://docs.microsoft.com/en-us/windows/security/identity-protection/user-account-control/user-account-control-group-policy-and-registry-key-settings)

---

## Companion Files

| File | Description |
|------|-------------|
| `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_detections.kql` | KQL detection queries for Microsoft Sentinel/Defender |
| `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_dr_rules.yaml` | LimaCharlie D&R rules (file format) |
| `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_rules.yar` | YARA detection rules |
| `2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_hardening.ps1` | PowerShell hardening script with rollback |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-07*
