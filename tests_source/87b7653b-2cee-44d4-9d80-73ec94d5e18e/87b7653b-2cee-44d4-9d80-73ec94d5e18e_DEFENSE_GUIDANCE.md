# EDR-Freeze Defense Evasion - Comprehensive Defense Guidance

**Test ID**: 87b7653b-2cee-44d4-9d80-73ec94d5e18e
**Test Name**: EDR-Freeze Defense Evasion
**Created**: 2025-12-07
**Author**: F0RT1KA Defense Guidance Builder

---

## Executive Summary

This document provides comprehensive defensive guidance for protecting against the EDR-Freeze defense evasion technique. EDR-Freeze exploits Windows Error Reporting (WerFaultSecure.exe) to suspend security processes including Windows Defender and EDR agents, creating a temporary window for malicious activity.

**Key Findings:**
- The attack abuses legitimate Windows components (WerFaultSecure.exe) for malicious purposes
- No vulnerable drivers required - operates entirely in user mode
- Exploits PPL (Protected Process Light) mechanism through race condition
- Creates temporary "coma state" in security processes
- Followed by validation attacks (e.g., malicious downloads via certutil)

**Defensive Priority**: HIGH - This technique directly disables security controls and enables follow-on attacks.

---

## 1. Threat Overview

### 1.1 Attack Summary

| Attribute | Value |
|-----------|-------|
| **Test ID** | 87b7653b-2cee-44d4-9d80-73ec94d5e18e |
| **Test Name** | EDR-Freeze Defense Evasion |
| **Test Score** | 8.6/10 |
| **Primary Technique** | T1562.001 - Impair Defenses: Disable or Modify Tools |
| **Secondary Techniques** | T1055 (Process Injection), T1574 (Hijack Execution Flow) |
| **Tactic** | Defense Evasion |
| **Platform** | Windows (including Windows 11 24H2) |
| **Permissions Required** | User |
| **Difficulty** | Moderate |

### 1.2 Attack Flow

```
[1] Drop EDR-Freeze.exe to C:\F0
         |
         v
[2] Identify Defender Process (MsMpEng.exe, MpDefenderCoreService.exe, NisSrv.exe)
         |
         v
[3] Execute EDR-Freeze with target PID and duration
         |
         v
[4] WerFaultSecure.exe suspends target via MiniDumpWriteDump
         |
         v
[5] EDR-Freeze suspends WerFaultSecure (race condition exploit)
         |
         v
[6] Security process remains in "coma state"
         |
         v
[7] Validation: Download malicious tool (Seatbelt.exe) via certutil
         |
         v
[8] WerFaultSecure terminated, security process resumes
```

### 1.3 Technical Mechanism

**Race Condition Exploit:**
1. EDR-Freeze launches WerFaultSecure.exe with parameters to dump a target security process
2. WerFaultSecure calls `MiniDumpWriteDump()` which suspends all threads in the target
3. EDR-Freeze immediately suspends WerFaultSecure before dump completion
4. Target security process remains suspended indefinitely (until WerFaultSecure is released)
5. Attacker performs malicious actions during suspension window
6. WerFaultSecure is terminated, allowing normal process resumption

**PPL Exploitation:**
- Uses `CreateProcessAsPPL` to launch WerFaultSecure with WinTCB protection level
- Allows interaction with Protected Process Light (PPL) security processes
- Bypasses normal process protection mechanisms

---

## 2. MITRE ATT&CK Mapping with Mitigations

### 2.1 Technique-to-Mitigation Matrix

| Technique | Name | Applicable Mitigations |
|-----------|------|----------------------|
| T1562.001 | Impair Defenses: Disable or Modify Tools | M1047, M1038, M1022, M1024, M1018 |
| T1055 | Process Injection | M1040, M1026 |
| T1574 | Hijack Execution Flow | M1013, M1047, M1040, M1038, M1022, M1044, M1024, M1051, M1018 |

### 2.2 Mitigation Details

| ID | Name | Description | Applicability |
|----|------|-------------|---------------|
| **M1047** | Audit | Periodically verify security tools function properly. Monitor for unexpected exclusion paths. Audit WerFaultSecure usage patterns. | HIGH |
| **M1040** | Behavior Prevention on Endpoint | Configure endpoint security to block process injection sequences. Enable ASR rules. | HIGH |
| **M1038** | Execution Prevention | Use application control (AppLocker/WDAC) to prevent unauthorized tool execution. | HIGH |
| **M1022** | Restrict File and Directory Permissions | Prevent file writes to sensitive directories (C:\F0, temp folders). | MEDIUM |
| **M1024** | Restrict Registry Permissions | Prevent unauthorized Registry modifications to security services. | MEDIUM |
| **M1018** | User Account Management | Limit user privileges to prevent security service manipulation. | MEDIUM |
| **M1026** | Privileged Account Management | Restrict process manipulation capabilities to administrative accounts only. | MEDIUM |
| **M1044** | Restrict Library Loading | Enable Safe DLL Search Mode. Prevent unauthorized DLL loading. | LOW |

### 2.3 Detection Priority Matrix

| Detection Category | Priority | Confidence | Coverage |
|-------------------|----------|------------|----------|
| WerFaultSecure abuse patterns | P1 - Critical | HIGH | T1562.001, T1574 |
| Security process suspension | P1 - Critical | HIGH | T1562.001 |
| Certutil malicious downloads | P2 - High | HIGH | T1105 |
| File staging in C:\F0 | P2 - High | MEDIUM | T1074 |
| PPL process creation | P3 - Medium | MEDIUM | T1055, T1574 |
| Behavioral correlation | P1 - Critical | VERY HIGH | Full chain |

---

## 3. Detection Rules

### 3.1 KQL Queries (Microsoft Sentinel/Defender)

See file: `87b7653b-2cee-44d4-9d80-73ec94d5e18e_detections.kql`

**Query Summary:**

| Query # | Name | Confidence | Description |
|---------|------|------------|-------------|
| 1 | WerFaultSecure Security Process Targeting | HIGH | Detects WerFaultSecure launched with security process parameters |
| 2 | Certutil Executable Download | HIGH | Detects certutil downloading executable files |
| 3 | Security Process Suspension Anomalies | HIGH | Detects thread suspension in security processes |
| 4 | WerFaultSecure PPL Creation | HIGH | Detects PPL process creation patterns |
| 5 | Full Attack Chain Correlation | VERY HIGH | Correlates multiple indicators for high-confidence detection |
| 6 | File Staging in Suspicious Locations | MEDIUM | Detects file creation in C:\F0 and temp directories |
| 7 | CreateProcessAsPPL Detection | HIGH | Detects PPL process creation attempts |
| 8 | Defender Process Anomalies | CRITICAL | Detects termination/suspension of Defender processes |
| 9 | LOLBin Network Downloads | HIGH | Detects LOLBins downloading from known repositories |
| 10 | Multi-Indicator Correlation | CRITICAL | Time-based correlation of multiple suspicious events |

### 3.2 LimaCharlie D&R Rules

See file: `87b7653b-2cee-44d4-9d80-73ec94d5e18e_dr_rules.yaml`

**Rule Summary:**

| Rule Name | Event Type | Description |
|-----------|------------|-------------|
| edr-freeze-werfaultsecure-abuse | NEW_PROCESS | Detects WerFaultSecure targeting security processes |
| edr-freeze-certutil-download | NEW_PROCESS | Detects certutil downloading executables |
| edr-freeze-file-staging | FILE_CREATE | Detects executable staging in C:\F0 |
| edr-freeze-tool-execution | NEW_PROCESS | Detects EDR-Freeze.exe execution |
| edr-freeze-ppl-creation | NEW_PROCESS | Detects PPL process creation attempts |

### 3.3 YARA Rules

See file: `87b7653b-2cee-44d4-9d80-73ec94d5e18e_rules.yar`

**Rule Summary:**

| Rule Name | Target | Description |
|-----------|--------|-------------|
| EDR_Freeze_Tool | File/Memory | Detects EDR-Freeze tool signatures and patterns |
| EDR_Freeze_Embedded_Binary | File | Detects Go binaries with embedded EDR-Freeze |
| Seatbelt_Tool | File | Detects Seatbelt reconnaissance tool |
| Certutil_Download_Pattern | Process/Memory | Detects certutil download command patterns |

---

## 4. Hardening Guidance

### 4.1 Quick Wins (PowerShell Scripts)

See file: `87b7653b-2cee-44d4-9d80-73ec94d5e18e_hardening.ps1`

**Implemented Protections:**

| Protection | Description | Impact |
|------------|-------------|--------|
| ASR Rules | Block credential stealing, process injection, Office macro code | Medium |
| Defender Tamper Protection | Prevents unauthorized changes to Defender settings | Low |
| Certutil Restrictions | AppLocker rules to restrict certutil execution | Low-Medium |
| C:\F0 Directory Monitoring | NTFS auditing on attack staging directory | Low |
| WerFaultSecure Monitoring | Enhanced auditing for WER components | Low |

### 4.2 Complex Hardening Guidance

#### 4.2.1 Attack Surface Reduction (ASR) Rules

**MITRE Mitigation:** [M1040](https://attack.mitre.org/mitigations/M1040/) - Behavior Prevention on Endpoint

**Applicable Techniques:** T1562.001, T1055, T1574

**Recommended ASR Rules:**

| GUID | Rule Name | Recommendation |
|------|-----------|----------------|
| `56a863a9-875e-4185-98a7-b882c64b5ce5` | Block abuse of exploited vulnerable signed drivers | Enable |
| `d4f940ab-401b-4efc-aadc-ad5f3c50688a` | Block all Office applications from creating child processes | Enable |
| `3b576869-a4ec-4529-8536-b80a7769e899` | Block Office applications from creating executable content | Enable |
| `75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84` | Block Office applications from injecting code into other processes | Enable |
| `e6db77e5-3df2-4cf1-b95a-636979351e5b` | Block persistence through WMI event subscription | Enable |
| `d1e49aac-8f56-4280-b9ba-993a6d77406c` | Block process creations originating from PSExec and WMI commands | Enable |

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > Windows Components >
Microsoft Defender Antivirus > Microsoft Defender Exploit Guard >
Attack Surface Reduction > Configure Attack Surface Reduction rules
```

**PowerShell Equivalent:**
```powershell
# Enable ASR rules in Block mode
Set-MpPreference -AttackSurfaceReductionRules_Ids `
    "56a863a9-875e-4185-98a7-b882c64b5ce5", `
    "d4f940ab-401b-4efc-aadc-ad5f3c50688a", `
    "3b576869-a4ec-4529-8536-b80a7769e899", `
    "75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84" `
    -AttackSurfaceReductionRules_Actions Enabled
```

**Verification:**
```powershell
Get-MpPreference | Select-Object -ExpandProperty AttackSurfaceReductionRules_Ids
```

**Considerations:**
- Test in Audit mode before enabling Block mode
- May impact legitimate software that performs similar actions
- Document exceptions for business-critical applications

---

#### 4.2.2 Windows Defender Tamper Protection

**MITRE Mitigation:** [M1047](https://attack.mitre.org/mitigations/M1047/) - Audit, [M1024](https://attack.mitre.org/mitigations/M1024/) - Restrict Registry Permissions

**Applicable Techniques:** T1562.001

**Implementation:**

| Setting | Value |
|---------|-------|
| **Location** | Microsoft 365 Defender Portal or Intune |
| **Recommended Value** | Enabled |
| **Default Value** | Enabled (managed devices) |
| **Impact Level** | Low |

**Intune Configuration:**
```
Endpoint Security > Antivirus > Microsoft Defender Antivirus >
Tamper Protection > Enable
```

**Registry Check (Read-Only):**
```
Path: HKLM\SOFTWARE\Microsoft\Windows Defender\Features
Name: TamperProtection
Type: REG_DWORD
Value: 5 (Enabled)
```

**Verification:**
```powershell
Get-MpComputerStatus | Select-Object IsTamperProtected
```

**Considerations:**
- Cannot be disabled locally when managed by cloud
- Requires Microsoft 365 Defender or Intune
- Protects against attempts to disable Defender via Registry

---

#### 4.2.3 Credential Guard

**MITRE Mitigation:** [M1026](https://attack.mitre.org/mitigations/M1026/) - Privileged Account Management

**Applicable Techniques:** T1055

**Implementation:**

| Setting | Value |
|---------|-------|
| **Location** | Group Policy / Registry |
| **Recommended Value** | Enabled with UEFI Lock |
| **Default Value** | Disabled |
| **Impact Level** | Medium |

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > System >
Device Guard > Turn On Virtualization Based Security
```

**Registry Equivalent:**
```
Path: HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard
Name: EnableVirtualizationBasedSecurity
Type: REG_DWORD
Value: 1

Path: HKLM\SYSTEM\CurrentControlSet\Control\Lsa
Name: LsaCfgFlags
Type: REG_DWORD
Value: 1 (Enabled with UEFI lock)
```

**Verification:**
```powershell
Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard
```

**Considerations:**
- Requires compatible hardware (TPM 2.0, UEFI, Secure Boot)
- May impact some legacy applications
- Cannot be disabled without physical access when UEFI-locked

---

#### 4.2.4 Windows Defender Application Control (WDAC)

**MITRE Mitigation:** [M1038](https://attack.mitre.org/mitigations/M1038/) - Execution Prevention

**Applicable Techniques:** T1562.001, T1574

**Implementation Guidance:**

1. **Create Base Policy:**
```powershell
# Generate policy from reference system
New-CIPolicy -Level Publisher -FilePath "C:\Policies\BasePolicy.xml" -UserPEs
```

2. **Add Deny Rules for Known Attack Tools:**
```powershell
# Block EDR-Freeze patterns
$DenyRule = New-CIPolicyRule -DriverFilePath "C:\F0\EDR-Freeze.exe" -Level Hash -Deny
Merge-CIPolicy -PolicyPaths "C:\Policies\BasePolicy.xml" -OutputFilePath "C:\Policies\MergedPolicy.xml" -Rules $DenyRule
```

3. **Deploy Policy:**
```powershell
ConvertFrom-CIPolicy "C:\Policies\MergedPolicy.xml" "C:\Windows\System32\CodeIntegrity\SIPolicy.p7b"
```

**Considerations:**
- Requires extensive testing before enforcement
- Start in Audit mode to identify legitimate software
- Use Microsoft's recommended block rules as baseline
- Consider managed installer integration for software deployment

---

#### 4.2.5 AppLocker for Certutil Restriction

**MITRE Mitigation:** [M1038](https://attack.mitre.org/mitigations/M1038/) - Execution Prevention

**Applicable Techniques:** T1105 (Ingress Tool Transfer)

**Implementation:**

| Setting | Value |
|---------|-------|
| **Location** | Group Policy - AppLocker |
| **Target** | certutil.exe |
| **Rule Type** | Executable Rules |
| **Action** | Deny for standard users |

**Group Policy Path:**
```
Computer Configuration > Windows Settings > Security Settings >
Application Control Policies > AppLocker > Executable Rules
```

**PowerShell Rule Creation:**
```powershell
# Create AppLocker rule to restrict certutil
$RuleXml = @"
<FilePublisherRule Id="$(New-Guid)" Name="Restrict certutil.exe" Description="Block certutil for non-admins" UserOrGroupSid="S-1-5-32-545" Action="Deny">
  <Conditions>
    <FilePublisherCondition PublisherName="O=MICROSOFT CORPORATION" ProductName="*" BinaryName="CERTUTIL.EXE">
      <BinaryVersionRange LowSection="*" HighSection="*"/>
    </FilePublisherCondition>
  </Conditions>
</FilePublisherRule>
"@
```

**Considerations:**
- May impact legitimate certificate management tasks
- Consider allowing execution only from administrative accounts
- Create exceptions for specific business processes

---

## 5. Incident Response Playbook

### 5.1 Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 87b7653b-2cee-44d4-9d80-73ec94d5e18e |
| **Test Name** | EDR-Freeze Defense Evasion |
| **MITRE ATT&CK** | [T1562.001](https://attack.mitre.org/techniques/T1562/001/), [T1055](https://attack.mitre.org/techniques/T1055/), [T1574](https://attack.mitre.org/techniques/T1574/) |
| **Severity** | HIGH |
| **Estimated Response Time** | 30-60 minutes |

---

### 5.2 Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| WerFaultSecure Security Process Targeting | WerFaultSecure.exe launched with MsMpEng/Defender process parameters | HIGH | P1 |
| Certutil Executable Download | certutil.exe with -urlcache/-urlfetch downloading .exe files | HIGH | P1 |
| EDR-Freeze Tool Execution | Process named EDR-Freeze.exe or matching hash | VERY HIGH | P1 |
| Security Process Suspension | Defender processes with suspended threads > 5 seconds | HIGH | P1 |
| Attack Chain Correlation | Multiple indicators within 90-second window | VERY HIGH | P1 |

#### Initial Triage Questions

1. Is this activity associated with a known security test (F0RT1KA framework)?
2. What is the scope - single host or multiple hosts?
3. What user account initiated the activity?
4. What processes were targeted for suspension?
5. Were any malicious downloads successful?
6. What is the timeline of suspicious activity?

---

### 5.3 Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Verify alert legitimacy**
  ```powershell
  # Check for F0RT1KA test markers
  Get-ChildItem "C:\F0" -ErrorAction SilentlyContinue
  Get-Content "C:\F0\*_log.json" -ErrorAction SilentlyContinue
  ```

- [ ] **Isolate affected host(s)**
  ```powershell
  # Network isolation via Windows Firewall (if not a test)
  netsh advfirewall set allprofiles state on
  netsh advfirewall firewall add rule name="IR-Block-All-Outbound" dir=out action=block
  netsh advfirewall firewall add rule name="IR-Block-All-Inbound" dir=in action=block

  # Allow only incident response traffic
  netsh advfirewall firewall add rule name="IR-Allow-RDP" dir=in action=allow protocol=tcp localport=3389
  ```

- [ ] **Terminate malicious processes**
  ```powershell
  # Kill EDR-Freeze if running
  Stop-Process -Name "EDR-Freeze" -Force -ErrorAction SilentlyContinue

  # Kill any suspended WerFaultSecure processes
  Get-Process WerFaultSecure -ErrorAction SilentlyContinue | Stop-Process -Force

  # Verify Defender processes are running
  Get-Process MsMpEng, MpDefenderCoreService, NisSrv -ErrorAction SilentlyContinue
  ```

- [ ] **Restart security services if suspended**
  ```powershell
  # Restart Windows Defender services
  Restart-Service WinDefend -Force
  Restart-Service WdNisSvc -Force

  # Verify services are running
  Get-Service WinDefend, WdNisSvc | Format-Table Name, Status
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create evidence directory
  $EvidenceDir = "C:\IR\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  New-Item -Path $EvidenceDir -ItemType Directory -Force

  # Capture running processes
  Get-Process | Export-Csv "$EvidenceDir\processes.csv" -NoTypeInformation

  # Capture network connections
  Get-NetTCPConnection | Export-Csv "$EvidenceDir\tcp_connections.csv" -NoTypeInformation
  Get-NetUDPEndpoint | Export-Csv "$EvidenceDir\udp_endpoints.csv" -NoTypeInformation

  # Capture loaded modules in suspicious processes
  Get-Process WerFaultSecure -ErrorAction SilentlyContinue |
      ForEach-Object { $_.Modules } |
      Export-Csv "$EvidenceDir\werfaultsecure_modules.csv" -NoTypeInformation
  ```

---

### 5.4 Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Test execution logs | `C:\F0\*_log.json` | `Copy-Item "C:\F0\*" -Destination "$EvidenceDir\F0_artifacts\" -Recurse` |
| EDR-Freeze binary | `C:\F0\EDR-Freeze.exe` | `Copy-Item "C:\F0\EDR-Freeze.exe" "$EvidenceDir\"` |
| Downloaded malware | `C:\F0\Seatbelt.exe` | `Copy-Item "C:\F0\Seatbelt.exe" "$EvidenceDir\" -ErrorAction SilentlyContinue` |
| Security Event Logs | System | `wevtutil epl Security "$EvidenceDir\Security.evtx"` |
| Sysmon Logs | Sysmon | `wevtutil epl "Microsoft-Windows-Sysmon/Operational" "$EvidenceDir\Sysmon.evtx"` |
| WER Logs | `C:\ProgramData\Microsoft\Windows\WER\` | `Copy-Item "C:\ProgramData\Microsoft\Windows\WER\*" "$EvidenceDir\WER\" -Recurse` |
| Prefetch | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*WERFAULTSECURE*" "$EvidenceDir\Prefetch\"` |

#### Memory Acquisition

```powershell
# If process memory is needed (requires admin tools)
# Using procdump (if available)
.\procdump.exe -ma WerFaultSecure "$EvidenceDir\werfaultsecure.dmp"

# Capture Defender process state
.\procdump.exe -ma MsMpEng "$EvidenceDir\msmpeng.dmp"
```

#### Timeline Generation

```powershell
# Export relevant event logs
$Logs = @(
    "Security",
    "System",
    "Microsoft-Windows-Sysmon/Operational",
    "Microsoft-Windows-Windows Defender/Operational",
    "Microsoft-Windows-PowerShell/Operational"
)

foreach ($Log in $Logs) {
    $SafeName = $Log -replace "[/\\]", "_"
    wevtutil epl $Log "$EvidenceDir\$SafeName.evtx" 2>$null
}

# Generate timeline from Security log
Get-WinEvent -FilterHashtable @{LogName='Security'; StartTime=(Get-Date).AddHours(-2)} |
    Select-Object TimeCreated, Id, Message |
    Export-Csv "$EvidenceDir\security_timeline.csv" -NoTypeInformation
```

---

### 5.5 Eradication

#### File Removal (AFTER evidence collection)

```powershell
# Remove attack artifacts
Remove-Item -Path "C:\F0\EDR-Freeze.exe" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "C:\F0\Seatbelt.exe" -Force -ErrorAction SilentlyContinue

# Remove any other suspicious executables in C:\F0
Get-ChildItem "C:\F0\*.exe" | Remove-Item -Force

# Verify removal
Get-ChildItem "C:\F0" -ErrorAction SilentlyContinue
```

#### Service Verification

```powershell
# Verify Defender services are healthy
Get-MpComputerStatus | Select-Object `
    AntivirusEnabled,
    AntispywareEnabled,
    RealTimeProtectionEnabled,
    IsTamperProtected,
    AntivirusSignatureLastUpdated

# Force Defender signature update
Update-MpSignature

# Run quick scan to verify functionality
Start-MpScan -ScanType QuickScan
```

#### Registry Cleanup

```powershell
# Check for any persistence mechanisms
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue

# Check scheduled tasks
Get-ScheduledTask | Where-Object { $_.Actions.Execute -like "*EDR*" -or $_.Actions.Execute -like "*F0*" }
```

---

### 5.6 Recovery

#### System Restoration Checklist

- [ ] Verify all malicious artifacts removed
- [ ] Confirm Defender processes are running and not suspended
- [ ] Confirm Defender real-time protection is enabled
- [ ] Run full system scan
- [ ] Restore network connectivity (if isolated)
- [ ] Verify security event logging is functioning

#### Validation Commands

```powershell
# Verify clean state
$CleanCheck = @{
    "F0 Directory Empty" = (Get-ChildItem "C:\F0\*.exe" -ErrorAction SilentlyContinue).Count -eq 0
    "Defender Running" = (Get-Service WinDefend).Status -eq "Running"
    "Real-time Protection" = (Get-MpComputerStatus).RealTimeProtectionEnabled
    "No Suspended WerFault" = (Get-Process WerFaultSecure -ErrorAction SilentlyContinue) -eq $null
}

$CleanCheck | Format-Table -AutoSize

# Remove network isolation (if applied)
netsh advfirewall firewall delete rule name="IR-Block-All-Outbound"
netsh advfirewall firewall delete rule name="IR-Block-All-Inbound"
netsh advfirewall firewall delete rule name="IR-Allow-RDP"
```

---

### 5.7 Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which detection rule triggered?)
2. What was the time from initial activity to detection?
3. What was the time from detection to containment?
4. Were Defender processes actually suspended successfully?
5. What additional detections could have caught this earlier?
6. Are there any gaps in our ASR rule coverage?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| **Detection** | Deploy WerFaultSecure monitoring query to production | HIGH |
| **Detection** | Enable Sysmon with thread suspension logging | HIGH |
| **Prevention** | Enable all recommended ASR rules | HIGH |
| **Prevention** | Deploy WDAC policy blocking unsigned executables from C:\F0 | MEDIUM |
| **Prevention** | Restrict certutil execution via AppLocker | MEDIUM |
| **Response** | Create automated containment runbook | MEDIUM |
| **Visibility** | Enable PowerShell Script Block Logging | HIGH |
| **Visibility** | Deploy enhanced WER auditing | MEDIUM |

---

## 6. References

### 6.1 MITRE ATT&CK

- [T1562.001 - Impair Defenses: Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/)
- [T1055 - Process Injection](https://attack.mitre.org/techniques/T1055/)
- [T1574 - Hijack Execution Flow](https://attack.mitre.org/techniques/T1574/)
- [M1047 - Audit](https://attack.mitre.org/mitigations/M1047/)
- [M1040 - Behavior Prevention on Endpoint](https://attack.mitre.org/mitigations/M1040/)
- [M1038 - Execution Prevention](https://attack.mitre.org/mitigations/M1038/)

### 6.2 Vendor Documentation

- [Microsoft - Attack Surface Reduction Rules](https://learn.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction-rules-reference)
- [Microsoft - Tamper Protection](https://learn.microsoft.com/en-us/microsoft-365/security/defender-endpoint/prevent-changes-to-security-settings-with-tamper-protection)
- [Microsoft - Windows Defender Application Control](https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-defender-application-control/wdac-and-applocker-overview)

### 6.3 Threat Intelligence

- [EDR-Freeze: A Tool That Puts EDRs And Antivirus Into A Coma State](https://www.zerosalarium.com/2025/09/EDR-Freeze-Puts-EDRs-Antivirus-Into-Coma.html)
- [EDR-Freeze GitHub Repository](https://github.com/TwoSevenOneT/EDR-Freeze)
- [CreateProcessAsPPL Tool](https://github.com/TwoSevenOneT/CreateProcessAsPPL)

---

## 7. Appendix: Associated Files

| File | Description |
|------|-------------|
| `87b7653b-2cee-44d4-9d80-73ec94d5e18e_detections.kql` | Microsoft Sentinel/Defender KQL queries |
| `87b7653b-2cee-44d4-9d80-73ec94d5e18e_dr_rules.yaml` | LimaCharlie Detection & Response rules |
| `87b7653b-2cee-44d4-9d80-73ec94d5e18e_rules.yar` | YARA detection rules |
| `87b7653b-2cee-44d4-9d80-73ec94d5e18e_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Version: 1.0.0*
*Date: 2025-12-07*
