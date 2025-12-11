# Defense Guidance: CyberEye RAT - Windows Defender Disabling via PowerShell

## Executive Summary

This document provides comprehensive defense guidance for detecting, preventing, and responding to the CyberEye RAT's Windows Defender disabling technique. The attack simulates a real-world threat actor's approach to neutralizing endpoint protection through PowerShell-based registry manipulation, enabling subsequent malicious activity to proceed undetected.

**Key Findings:**
- Attack requires administrative privileges and targets critical Windows Defender registry keys
- Primary detection opportunities exist at PowerShell execution and registry modification stages
- Defense-in-depth approach combining Tamper Protection, registry ACLs, and monitoring is essential
- Incident response should focus on immediate containment and registry restoration

---

## Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | ecd2514c-512a-4251-a6f4-eb3aa834d401 |
| **Test Name** | CyberEye RAT - Windows Defender Disabling via PowerShell |
| **MITRE ATT&CK** | [T1562.001](https://attack.mitre.org/techniques/T1562/001/) - Impair Defenses: Disable or Modify Tools |
| **Tactic** | Defense Evasion |
| **Severity** | High |
| **Platform** | Windows |
| **Permissions Required** | Administrator |

---

## 1. Threat Overview

### 1.1 Attack Description

The CyberEye RAT employs a PowerShell-based attack chain to systematically disable Windows Defender protection mechanisms. The technique involves:

1. **Script Deployment**: Drops a malicious PowerShell script (`CyberEye-TTPs.ps1`) to `c:\F0`
2. **Execution Policy Bypass**: Executes PowerShell with `-ExecutionPolicy Bypass` to circumvent script restrictions
3. **Privilege Verification**: Confirms administrative access before proceeding
4. **Registry Manipulation**: Modifies critical Windows Defender registry keys to disable protection:
   - Disables Tamper Protection
   - Disables Anti-Spyware functionality
   - Disables Real-Time Protection components (behavior monitoring, on-access protection, real-time scanning)

### 1.2 Attack Flow

```
[Script Drop]        [PowerShell Execution]      [Registry Modification]       [Defender Disabled]
     |                        |                           |                           |
     v                        v                           v                           v
c:\F0\CyberEye-  -->  powershell.exe           -->  HKLM:\...\Windows     -->  Protection
TTPs.ps1              -ExecutionPolicy              Defender\Features\         mechanisms
                      Bypass -File                  TamperProtection=0         neutralized
                      c:\F0\...                     + Policy keys
```

### 1.3 Registry Keys Targeted

| Registry Path | Value Name | Attack Value | Purpose |
|---------------|------------|--------------|---------|
| `HKLM:\SOFTWARE\Microsoft\Windows Defender\Features` | TamperProtection | 0 | Disables anti-tampering |
| `HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender` | DisableAntiSpyware | 1 | Disables Defender entirely |
| `HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection` | DisableBehaviorMonitoring | 1 | Disables behavior analysis |
| `HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection` | DisableOnAccessProtection | 1 | Disables file scanning |
| `HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection` | DisableScanOnRealtimeEnable | 1 | Disables real-time scanning |

---

## 2. MITRE ATT&CK Mapping

### 2.1 Technique Details

| Field | Value |
|-------|-------|
| **Technique** | T1562.001 - Impair Defenses: Disable or Modify Tools |
| **Tactic** | Defense Evasion (TA0005) |
| **Data Sources** | Command, Process, Windows Registry, Service |
| **Defense Bypassed** | Anti-virus, Host intrusion prevention systems, Log analysis |

### 2.2 Applicable Mitigations

| M-Code | Mitigation | Implementation Priority | Description |
|--------|------------|------------------------|-------------|
| [M1024](https://attack.mitre.org/mitigations/M1024/) | Restrict Registry Permissions | **Critical** | Configure ACLs on Windows Defender registry keys to prevent unauthorized modification |
| [M1022](https://attack.mitre.org/mitigations/M1022/) | Restrict File and Directory Permissions | High | Restrict write access to script execution directories |
| [M1047](https://attack.mitre.org/mitigations/M1047/) | Audit | High | Periodically verify Windows Defender is functioning and check for unexpected exclusions |
| [M1054](https://attack.mitre.org/mitigations/M1054/) | Software Configuration | High | Enable Tamper Protection and configure Windows Defender hardening |
| [M1038](https://attack.mitre.org/mitigations/M1038/) | Execution Prevention | Medium | Restrict PowerShell execution policies and implement application control |
| [M1018](https://attack.mitre.org/mitigations/M1018/) | User Account Management | Medium | Enforce least privilege to limit administrator access |

### 2.3 Detection Priority Matrix

| Indicator | Detection Confidence | False Positive Risk | Priority |
|-----------|---------------------|---------------------|----------|
| Registry modification to TamperProtection | High | Low | P1 |
| Registry modification to DisableAntiSpyware | High | Low | P1 |
| PowerShell with -ExecutionPolicy Bypass accessing Defender keys | High | Medium | P1 |
| PowerShell script in c:\F0 directory | High | Low | P1 |
| Real-Time Protection registry modifications | High | Low | P2 |
| Service query for WinDefend after registry changes | Medium | Medium | P3 |

---

## 3. Detection Rules

### 3.1 Microsoft Sentinel/Defender KQL Queries

See `ecd2514c-512a-4251-a6f4-eb3aa834d401_detections.kql` for complete detection queries including:

1. **Windows Defender Tamper Protection Disabled** - Detects TamperProtection registry modification
2. **Windows Defender Anti-Spyware Disabled** - Detects DisableAntiSpyware policy creation
3. **Windows Defender Real-Time Protection Disabled** - Detects RTP component disabling
4. **PowerShell Execution Policy Bypass with Defender Script** - Detects suspicious PowerShell execution
5. **Script Activity in F0RT1KA Test Directory** - Monitors c:\F0 for script files
6. **Behavioral Correlation - Defender Disable Sequence** - Multi-indicator detection
7. **WinDefend Service Query After Registry Modification** - Post-attack reconnaissance detection
8. **PowerShell Defender Registry Access** - Command-line pattern matching

### 3.2 LimaCharlie D&R Rules

See `ecd2514c-512a-4251-a6f4-eb3aa834d401_dr_rules.yaml` for deployment-ready rules including:

1. **Defender Registry Tampering Detection** - Registry modification monitoring
2. **PowerShell Execution Policy Bypass** - Process creation analysis
3. **F0 Directory Script Activity** - File creation detection
4. **Behavioral Correlation** - Multi-event correlation

### 3.3 YARA Rules

See `ecd2514c-512a-4251-a6f4-eb3aa834d401_rules.yar` for file-based detection rules including:

1. **CyberEye_Defender_Disable_Script** - PowerShell script pattern detection
2. **Defender_Registry_Manipulation_Script** - Generic registry manipulation detection
3. **PowerShell_ExecutionPolicy_Bypass** - Bypass technique detection

---

## 4. Hardening Guidance

### 4.1 Quick Wins (Immediate Implementation)

See `ecd2514c-512a-4251-a6f4-eb3aa834d401_hardening.ps1` for ready-to-run PowerShell scripts.

**Key hardening actions:**

| Action | Priority | Difficulty |
|--------|----------|------------|
| Enable Windows Defender Tamper Protection | Critical | Easy |
| Configure registry ACLs on Defender keys | Critical | Medium |
| Enable PowerShell Script Block Logging | High | Easy |
| Configure Controlled Folder Access | High | Medium |
| Implement AppLocker/WDAC policies | High | Hard |
| Enable Attack Surface Reduction rules | High | Medium |

### 4.2 Windows Defender Tamper Protection

**MITRE Mitigation:** [M1054](https://attack.mitre.org/mitigations/M1054/) - Software Configuration

**Implementation:**

| Setting | Value |
|---------|-------|
| **Location** | Windows Security > Virus & threat protection settings |
| **Recommended Value** | On |
| **Default Value** | On (Windows 10 1903+) |
| **Impact Level** | Low |

**Group Policy Path:**
```
Not available via Group Policy - managed via Windows Security or Microsoft Endpoint Manager
```

**Microsoft Intune Configuration:**
```
Endpoint security > Antivirus > Microsoft Defender Antivirus > Tamper Protection: Enabled
```

**Verification Command:**
```powershell
Get-MpComputerStatus | Select-Object IsTamperProtected
# Expected: IsTamperProtected = True
```

**Considerations:**
- Tamper Protection requires cloud-delivered protection to be enabled
- Enterprise management via Microsoft Endpoint Manager recommended
- Cannot be disabled by local administrators when managed via Intune

### 4.3 Registry ACL Hardening

**MITRE Mitigation:** [M1024](https://attack.mitre.org/mitigations/M1024/) - Restrict Registry Permissions

**Target Keys:**
- `HKLM:\SOFTWARE\Microsoft\Windows Defender`
- `HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender`

**Recommended Permissions:**
- SYSTEM: Full Control
- Administrators: Read only (remove Modify/Write)
- TrustedInstaller: Full Control

**Implementation:**
```powershell
# Restrict Defender policy key
$acl = Get-Acl "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.RegistryAccessRule(
    "BUILTIN\Administrators", "ReadKey", "ContainerInherit,ObjectInherit", "None", "Allow"
)
$acl.AddAccessRule($rule)
Set-Acl "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender" $acl
```

**Verification:**
```powershell
Get-Acl "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender" | Format-List
```

### 4.4 PowerShell Security Configuration

**MITRE Mitigation:** [M1038](https://attack.mitre.org/mitigations/M1038/) - Execution Prevention

**Group Policy Settings:**

| Setting | Path | Value |
|---------|------|-------|
| Turn on Script Block Logging | Computer Configuration > Administrative Templates > Windows Components > Windows PowerShell | Enabled |
| Turn on PowerShell Transcription | Computer Configuration > Administrative Templates > Windows Components > Windows PowerShell | Enabled |
| Turn on Module Logging | Computer Configuration > Administrative Templates > Windows Components > Windows PowerShell | Enabled |

**Registry Equivalents:**
```
Path: HKLM\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging
Name: EnableScriptBlockLogging
Type: REG_DWORD
Value: 1

Path: HKLM\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription
Name: EnableTranscripting
Type: REG_DWORD
Value: 1
```

### 4.5 Attack Surface Reduction Rules

**MITRE Mitigation:** [M1038](https://attack.mitre.org/mitigations/M1038/) - Execution Prevention

**Relevant ASR Rules:**

| GUID | Rule Name | Mode |
|------|-----------|------|
| `d4f940ab-401b-4efc-aadc-ad5f3c50688a` | Block all Office applications from creating child processes | Block |
| `9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2` | Block credential stealing from LSASS | Block |
| `b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4` | Block untrusted/unsigned processes from USB | Block |
| `92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b` | Block Win32 API calls from Office macros | Block |

**PowerShell Implementation:**
```powershell
# Enable ASR rules
Set-MpPreference -AttackSurfaceReductionRules_Ids `
    "d4f940ab-401b-4efc-aadc-ad5f3c50688a", `
    "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" `
    -AttackSurfaceReductionRules_Actions Enabled, Enabled
```

---

## 5. Incident Response Playbook

### 5.1 Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | ecd2514c-512a-4251-a6f4-eb3aa834d401 |
| **Test Name** | CyberEye RAT - Windows Defender Disabling |
| **MITRE ATT&CK** | [T1562.001](https://attack.mitre.org/techniques/T1562/001/) |
| **Severity** | High |
| **Estimated Response Time** | 30-60 minutes |

### 5.2 Detection Triggers

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| Defender TamperProtection Disabled | Registry value TamperProtection set to 0 | High | P1 |
| DisableAntiSpyware Policy Created | Registry value DisableAntiSpyware set to 1 | High | P1 |
| PowerShell Bypass with Defender Script | powershell.exe -ExecutionPolicy Bypass with Defender keywords | High | P1 |
| RTP Components Disabled | Multiple Real-Time Protection values modified | High | P2 |
| Script in c:\F0 | PowerShell script created in F0RT1KA test directory | Medium | P2 |

### 5.3 Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What user account is associated with the activity?
3. Are there other hosts showing similar activity (lateral movement)?
4. What is the timeline - when did registry modifications occur?
5. Is Windows Defender still operational on the affected host?

### 5.4 Containment (First 15 minutes)

**Immediate Actions:**

- [ ] **Verify Windows Defender status**
  ```powershell
  # Check Defender operational status
  Get-MpComputerStatus | Select-Object AMRunningMode, RealTimeProtectionEnabled, IsTamperProtected
  ```

- [ ] **Isolate affected host if unauthorized**
  ```powershell
  # Network isolation via Windows Firewall
  New-NetFirewallRule -DisplayName "IR-Isolate-Outbound" -Direction Outbound -Action Block
  New-NetFirewallRule -DisplayName "IR-Isolate-Inbound" -Direction Inbound -Action Block
  ```

- [ ] **Terminate suspicious PowerShell processes**
  ```powershell
  # Kill PowerShell processes with suspicious command lines
  Get-WmiObject Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like "*Bypass*" -and $_.CommandLine -like "*F0*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create IR evidence directory
  New-Item -Path "C:\IR_Evidence" -ItemType Directory -Force

  # Capture running processes
  Get-Process | Export-Csv "C:\IR_Evidence\processes_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

  # Capture PowerShell history
  Get-Content (Get-PSReadLineOption).HistorySavePath | Out-File "C:\IR_Evidence\ps_history.txt"

  # Capture relevant registry state
  reg export "HKLM\SOFTWARE\Microsoft\Windows Defender" "C:\IR_Evidence\defender_registry.reg"
  reg export "HKLM\SOFTWARE\Policies\Microsoft\Windows Defender" "C:\IR_Evidence\defender_policy.reg"
  ```

### 5.5 Evidence Collection

**Critical Artifacts:**

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Attack script | `c:\F0\CyberEye-TTPs.ps1` | `Copy-Item "c:\F0\*" -Destination "C:\IR_Evidence\F0_artifacts\" -Recurse` |
| Script execution log | `%TEMP%\DefenderTest_*.log` | `Copy-Item "$env:TEMP\DefenderTest_*.log" "C:\IR_Evidence\"` |
| PowerShell logs | Event Log | `wevtutil epl "Microsoft-Windows-PowerShell/Operational" "C:\IR_Evidence\PowerShell.evtx"` |
| Security events | Event Log | `wevtutil epl Security "C:\IR_Evidence\Security.evtx"` |
| Sysmon logs | Event Log | `wevtutil epl "Microsoft-Windows-Sysmon/Operational" "C:\IR_Evidence\Sysmon.evtx"` |
| Defender registry | Registry | `reg export "HKLM\SOFTWARE\Microsoft\Windows Defender" "C:\IR_Evidence\defender.reg"` |
| Defender policy | Registry | `reg export "HKLM\SOFTWARE\Policies\Microsoft\Windows Defender" "C:\IR_Evidence\defender_policy.reg"` |

**Event Log Queries:**

```powershell
# PowerShell script execution events (Event ID 4104)
Get-WinEvent -FilterHashtable @{
    LogName = 'Microsoft-Windows-PowerShell/Operational'
    Id = 4104
    StartTime = (Get-Date).AddHours(-24)
} | Where-Object { $_.Message -like "*Defender*" -or $_.Message -like "*TamperProtection*" }

# Registry modification events (Sysmon Event ID 13)
Get-WinEvent -FilterHashtable @{
    LogName = 'Microsoft-Windows-Sysmon/Operational'
    Id = 13
    StartTime = (Get-Date).AddHours(-24)
} | Where-Object { $_.Message -like "*Windows Defender*" }
```

### 5.6 Eradication

**Registry Restoration:**

```powershell
# Remove malicious policy settings
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender" -Name "DisableAntiSpyware" -ErrorAction SilentlyContinue

# Remove Real-Time Protection disabling settings
$rtpPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection"
if (Test-Path $rtpPath) {
    Remove-ItemProperty -Path $rtpPath -Name "DisableBehaviorMonitoring" -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $rtpPath -Name "DisableOnAccessProtection" -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $rtpPath -Name "DisableScanOnRealtimeEnable" -ErrorAction SilentlyContinue
}

# Remove empty policy keys
if (Test-Path $rtpPath) {
    Remove-Item -Path $rtpPath -Force -ErrorAction SilentlyContinue
}
```

**File Removal:**

```powershell
# Remove attack artifacts (AFTER evidence collection)
Remove-Item -Path "c:\F0\CyberEye-TTPs.ps1" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "c:\F0\Cleanup-CyberEye-TTPs.ps1" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:TEMP\DefenderTest_*.log" -Force -ErrorAction SilentlyContinue
```

**Service Restoration:**

```powershell
# Restart Windows Defender service
Restart-Service -Name "WinDefend" -Force -ErrorAction SilentlyContinue

# Verify Defender is operational
Start-Sleep -Seconds 5
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, IsTamperProtected
```

### 5.7 Recovery

**System Restoration Checklist:**

- [ ] Verify all malicious registry values removed
- [ ] Confirm Windows Defender Real-Time Protection is enabled
- [ ] Verify Tamper Protection is active
- [ ] Remove network isolation rules
- [ ] Run a full system scan

**Validation Commands:**

```powershell
# Comprehensive Defender status check
$status = Get-MpComputerStatus
Write-Host "Real-Time Protection: $($status.RealTimeProtectionEnabled)"
Write-Host "Tamper Protected: $($status.IsTamperProtected)"
Write-Host "AM Running Mode: $($status.AMRunningMode)"
Write-Host "AntiSpyware Enabled: $($status.AntispywareEnabled)"
Write-Host "Behavior Monitor Enabled: $($status.BehaviorMonitorEnabled)"
Write-Host "On Access Protection: $($status.OnAccessProtectionEnabled)"

# Verify no attack artifacts remain
Test-Path "c:\F0\CyberEye-TTPs.ps1"  # Should be False

# Remove network isolation
Remove-NetFirewallRule -DisplayName "IR-Isolate-*" -ErrorAction SilentlyContinue
```

### 5.8 Post-Incident

**Lessons Learned Questions:**

1. How was the attack detected? (Which detection rule/alert?)
2. What was the detection-to-response time?
3. Was Tamper Protection enabled? If not, why?
4. What prevented the attack from succeeding (if blocked)?
5. What detection gaps were identified?

**Recommended Improvements:**

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Deploy registry monitoring for Defender keys | High |
| Prevention | Enable Tamper Protection via Intune | Critical |
| Prevention | Implement registry ACL hardening | High |
| Response | Create automated response playbook | Medium |
| Monitoring | Enable PowerShell Script Block Logging | High |

---

## 6. References

### 6.1 External Resources

- [CyberEye RAT Analysis](https://cybersecuritynews.com/cybereye-rat-disable-windows-defender-using-powershell/)
- [MITRE ATT&CK T1562.001](https://attack.mitre.org/techniques/T1562/001/)
- [Microsoft Defender Tamper Protection](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/prevent-changes-to-security-settings-with-tamper-protection)
- [PowerShell Security Best Practices](https://docs.microsoft.com/en-us/powershell/scripting/security/overview)

### 6.2 Related Detection Files

| File | Description |
|------|-------------|
| `ecd2514c-512a-4251-a6f4-eb3aa834d401_detections.kql` | Microsoft Sentinel KQL queries |
| `ecd2514c-512a-4251-a6f4-eb3aa834d401_dr_rules.yaml` | LimaCharlie D&R rules |
| `ecd2514c-512a-4251-a6f4-eb3aa834d401_rules.yar` | YARA detection rules |
| `ecd2514c-512a-4251-a6f4-eb3aa834d401_hardening.ps1` | PowerShell hardening script |

---

**Document Generated:** 2025-12-07
**F0RT1KA Test ID:** ecd2514c-512a-4251-a6f4-eb3aa834d401
**Defense Guidance Builder Version:** 1.0
