# Defense Guidance: MDE Process Injection and API Authentication Bypass

## Executive Summary

This document provides comprehensive defense guidance for F0RT1KA security test **fec68e9b-af59-40c1-abbd-98ec98428444**, which simulates advanced attacks against Microsoft Defender for Endpoint (MDE). The test performs **real process injection attempts** against MsSense.exe, **actual memory patching** of CRYPT32 certificate validation functions, and **live API race conditions** against production endpoints.

**Test Score**: 9.7/10 - Production-accurate attack chain with advanced safety mechanisms

### Attack Overview

| Attribute | Value |
|-----------|-------|
| **Test ID** | fec68e9b-af59-40c1-abbd-98ec98428444 |
| **Test Name** | MDE Process Injection and API Authentication Bypass |
| **Category** | Defense Evasion / Privilege Escalation / Process Injection |
| **Severity** | Critical |
| **Attack Phases** | 11 distinct phases |
| **Primary Targets** | MsSense.exe, CRYPT32.dll, MDE Cloud APIs |

### MITRE ATT&CK Mapping

| Technique ID | Technique Name | Tactic |
|--------------|----------------|--------|
| T1055 | Process Injection | Defense Evasion, Privilege Escalation |
| T1055.001 | Dynamic-link Library Injection | Defense Evasion, Privilege Escalation |
| T1562.001 | Impair Defenses: Disable or Modify Tools | Defense Evasion |
| T1014 | Rootkit | Defense Evasion |
| T1557 | Adversary-in-the-Middle | Credential Access, Collection |
| T1071.001 | Application Layer Protocol: Web Protocols | Command and Control |
| T1140 | Deobfuscate/Decode Files or Information | Defense Evasion |

---

## Threat Overview

### Attack Flow Summary

```
Phase 1: Prerequisites & Environment Validation
    |
    v
Phase 2: MDE Process Discovery (enumerate MsSense.exe)
    |
    v
Phase 3: Process Handle Acquisition (PROCESS_VM_WRITE)
    |
    v
Phase 4: Memory Enumeration (locate CRYPT32.dll)
    |
    v
Phase 5: Memory Patching (CertVerifyCertificateChainPolicy)
    |
    v
Phase 6: Network Proxy Configuration
    |
    v
Phase 7: API Command Interception (race condition)
    |
    v
Phase 8: CloudLR Token Generation Bypass
    |
    v
Phase 9: Isolation Command Spoofing
    |
    v
Phase 10: Configuration Exfiltration (8MB)
    |
    v
Phase 11: Final Verification & Cleanup
```

### Critical Attack Indicators

1. **Process Injection to MDE Agent**: OpenProcess calls with PROCESS_VM_WRITE targeting MsSense.exe
2. **Memory Manipulation**: WriteProcessMemory calls to CRYPT32.dll
3. **Certificate Bypass**: Patching CertVerifyCertificateChainPolicy function
4. **API Abuse**: Unauthenticated requests to winatp-gw endpoints
5. **Command Interception**: Race conditions against /edr/commands/cnc endpoint

---

## MITRE ATT&CK Mitigations

### Process Injection (T1055, T1055.001)

| Mitigation ID | Mitigation Name | Implementation |
|---------------|-----------------|----------------|
| M1040 | Behavior Prevention on Endpoint | Enable ASR rules to block process injection patterns |
| M1026 | Privileged Account Management | Restrict admin rights; use least privilege principle |

**Detection Focus**: Monitor for VirtualAllocEx, WriteProcessMemory, CreateRemoteThread API calls targeting security processes.

### Impair Defenses (T1562.001)

| Mitigation ID | Mitigation Name | Implementation |
|---------------|-----------------|----------------|
| M1047 | Audit | Periodically verify security tools are functioning |
| M1038 | Execution Prevention | Restrict execution of unauthorized tools |
| M1022 | Restrict File and Directory Permissions | Protect security service files |
| M1024 | Restrict Registry Permissions | Protect security configuration keys |
| M1018 | User Account Management | Enforce proper permission boundaries |

### Rootkit / Memory Manipulation (T1014)

**Note**: MITRE states this technique cannot be easily mitigated with preventive controls. Focus on detection:
- Monitor kernel-mode driver/DLL loading
- Detect concealed services and boot component modifications
- Implement runtime integrity checking

### Adversary-in-the-Middle (T1557)

| Mitigation ID | Mitigation Name | Implementation |
|---------------|-----------------|----------------|
| M1042 | Disable or Remove Feature or Program | Remove unnecessary legacy protocols |
| M1041 | Encrypt Sensitive Information | Use strong TLS for all traffic |
| M1037 | Filter Network Traffic | Block unnecessary protocols |
| M1035 | Limit Access to Resource Over Network | Restrict network infrastructure access |
| M1031 | Network Intrusion Prevention | Deploy IPS for MITM detection |
| M1030 | Network Segmentation | Isolate sensitive systems |
| M1017 | User Training | Recognize certificate errors |

---

## Detection Rules

### KQL Queries (Microsoft Sentinel/Defender)

Detection queries are provided in `fec68e9b-af59-40c1-abbd-98ec98428444_detections.kql`.

**Key Detections**:

| Detection | Confidence | MITRE ATT&CK |
|-----------|------------|--------------|
| MDE Process Enumeration | High | T1057 |
| Privileged Handle Acquisition to EDR | Critical | T1055, T1055.001 |
| WriteProcessMemory to Security Processes | Critical | T1055, T1562.001 |
| CRYPT32.dll Memory Access | High | T1014 |
| File Drops to C:\F0 | High | T1105 |
| Watchdog Process Pattern | High | T1055 |
| Unauthenticated MDE API Requests | High | T1071.001, T1557 |
| Rapid API Command Interception | High | T1557 |
| MDE Registry Key Access | Medium | T1552.002 |
| Proxy Configuration Changes | Medium | T1557, T1090 |
| Large Configuration Downloads | High | T1005, T1041 |
| Behavioral Correlation Chain | Critical | Multiple |
| Emergency Restore Script Execution | High | T1059.001 |

**Example Query - Critical Detection**:
```kql
// Detect handle acquisition attempts to MDE processes
DeviceEvents
| where ActionType == "OpenProcessApiCall" or ActionType == "ProcessAccess"
| where FileName in~ ("MsSense.exe", "SenseIR.exe", "MsMpEng.exe")
| where InitiatingProcessFileName !in~ ("MsSense.exe", "SenseIR.exe", "services.exe")
| where AdditionalFields has_any ("PROCESS_VM_WRITE", "PROCESS_CREATE_THREAD")
| extend Severity = "Critical", MitreAttack = "T1055"
```

### LimaCharlie D&R Rules

Detection rules are provided in `fec68e9b-af59-40c1-abbd-98ec98428444_dr_rules.yaml`.

**Key Rules**:

| Rule Name | Event Type | Description |
|-----------|------------|-------------|
| f0rtika-mde-handle-acquisition | SENSITIVE_PROCESS_ACCESS | Handle acquisition to MDE |
| f0rtika-file-drop-f0 | FILE_CREATE | Executable drops to C:\F0 |
| f0rtika-mde-watchdog-spawn | NEW_PROCESS | Watchdog process creation |
| f0rtika-unauthorized-mde-network | NEW_TCP4_CONNECTION | Non-MDE to MDE endpoints |
| f0rtika-proxy-configuration | NEW_PROCESS | netsh proxy changes |
| f0rtika-emergency-restore | NEW_PROCESS | Emergency restore script |
| f0rtika-mde-registry-access | REGISTRY_VALUE_SET | MDE config access |
| f0rtika-test-execution | NEW_PROCESS | Test binary execution |
| f0rtika-mde-attack-chain | RECEIPT | Multi-indicator correlation |

**Example Rule**:
```yaml
rules:
  f0rtika-mde-handle-acquisition:
    detect:
      target: edr
      event: SENSITIVE_PROCESS_ACCESS
      op: and
      rules:
        - op: contains
          path: event/TARGET/FILE_PATH
          value: MsSense.exe
        - op: is not
          path: event/FILE_PATH
          value: MsSense.exe
    respond:
      - action: report
        name: f0rtika-mde-handle-acquisition
```

### YARA Rules

Detection rules are provided in `fec68e9b-af59-40c1-abbd-98ec98428444_rules.yar`.

**Key Rules**:

| Rule Name | Confidence | Description |
|-----------|------------|-------------|
| F0RTIKA_MDE_Process_Injection_Test | High | Main test binary |
| F0RTIKA_MDE_Watchdog_Binary | High | Watchdog process |
| F0RTIKA_Process_Injection_APIs | Medium | Generic injection pattern |
| F0RTIKA_Certificate_Bypass_Pattern | High | CRYPT32 targeting |
| F0RTIKA_MDE_API_Targeting | High | MDE endpoint targeting |
| F0RTIKA_Emergency_Restore_Script | High | Recovery script |
| F0RTIKA_Embedded_PE_Dropper | Medium | Dropper pattern |
| F0RTIKA_Test_Report_JSON | High | Test artifacts |
| F0RTIKA_HighRisk_API_Imports | Medium | PE import analysis |
| F0RTIKA_High_Entropy_Sections | Low | Packed content |

---

## Hardening Guidance

### Quick Wins (Automated)

The hardening script `fec68e9b-af59-40c1-abbd-98ec98428444_hardening.ps1` automates:

1. **Attack Surface Reduction (ASR) Rules**
   - Block process injection patterns
   - Block Office macro abuse
   - Block credential stealing from LSASS

2. **Memory Integrity (HVCI)**
   - Enable Hypervisor-Enforced Code Integrity

3. **Windows Defender Configuration**
   - Real-time protection
   - Behavior monitoring
   - Network protection (Block mode)
   - Cloud protection (Advanced)
   - Controlled Folder Access

4. **Process Protection**
   - LSA Protection (RunAsPPL)
   - Credential Guard

5. **Network Hardening**
   - Disable LLMNR (prevents MITM)
   - Firewall rules

6. **Audit Policies**
   - Process creation auditing
   - Handle manipulation auditing
   - Command line logging

7. **PowerShell Hardening**
   - Script block logging
   - Module logging

**Usage**:
```powershell
# Apply hardening
.\fec68e9b-af59-40c1-abbd-98ec98428444_hardening.ps1

# Audit current settings
.\fec68e9b-af59-40c1-abbd-98ec98428444_hardening.ps1 -Audit

# Rollback changes
.\fec68e9b-af59-40c1-abbd-98ec98428444_hardening.ps1 -Undo
```

### Manual Hardening Steps

#### 1. Enable Process Protection for MDE

Ensure MDE's tamper protection is enabled in Microsoft 365 Defender portal:
- Go to **Settings > Endpoints > Advanced Features**
- Enable **Tamper Protection**

#### 2. Configure ASR Rules via Group Policy

```
Computer Configuration > Administrative Templates > Windows Components >
Microsoft Defender Antivirus > Microsoft Defender Exploit Guard >
Attack Surface Reduction > Configure Attack Surface Reduction rules
```

Enable these rules in Block mode:
- `d1e49aac-8f56-4280-b9ba-993a6d77406c` - Block PSExec/WMI process creation
- `9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2` - Block credential stealing from LSASS
- `75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84` - Block Office code injection

#### 3. Enable Memory Integrity (HVCI)

Via Registry:
```
Path: HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity
Name: Enabled
Type: REG_DWORD
Value: 1
```

**Requires reboot**

#### 4. Enable Credential Guard

Via Registry:
```
Path: HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard
Name: EnableVirtualizationBasedSecurity
Type: REG_DWORD
Value: 1

Name: RequirePlatformSecurityFeatures
Type: REG_DWORD
Value: 1

Name: LsaCfgFlags
Type: REG_DWORD
Value: 1
```

**Requires reboot**

#### 5. Restrict MDE Registry Access

Apply restrictive ACLs to:
```
HKLM\SOFTWARE\Microsoft\Windows Advanced Threat Protection
```

Only SYSTEM and administrators should have access.

#### 6. Network Segmentation

- Ensure only MsSense.exe and SenseIR.exe can connect to winatp-gw endpoints
- Consider application-aware firewall rules
- Monitor for unauthorized connections to MDE infrastructure

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | fec68e9b-af59-40c1-abbd-98ec98428444 |
| **Test Name** | MDE Process Injection and API Authentication Bypass |
| **MITRE ATT&CK** | T1055, T1055.001, T1562.001, T1014, T1557 |
| **Severity** | Critical |
| **Estimated Response Time** | 2-4 hours |

### 1. Detection Triggers

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| EDR Handle Acquisition | OpenProcess to MsSense.exe with VM_WRITE | Critical | P1 |
| Memory Manipulation | WriteProcessMemory to CRYPT32.dll | Critical | P1 |
| API Abuse | Non-MDE process to winatp-gw | High | P2 |
| Test Artifact Drop | Files in C:\F0 directory | High | P2 |
| Attack Chain | 3+ indicators in 30 minutes | Critical | P1 |

### Initial Triage Questions

1. Is this a known authorized security test execution?
2. What is the scope - single host or multiple?
3. What user account initiated the activity?
4. Is MDE still functioning and reporting telemetry?
5. Were any memory patches successfully applied?

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Verify MDE status**
  ```powershell
  Get-Service -Name "Sense" | Select Name, Status
  Get-MpComputerStatus | Select RealTimeProtectionEnabled, IsTamperProtected
  ```

- [ ] **Check for active memory patches**
  ```powershell
  # Look for watchdog process
  Get-Process | Where-Object { $_.ProcessName -like "*watchdog*" }

  # Check F0RT1KA artifacts
  Get-ChildItem "C:\F0" -ErrorAction SilentlyContinue
  ```

- [ ] **Terminate suspicious processes**
  ```powershell
  # Kill test binary if running
  Stop-Process -Name "fec68e9b-af59-40c1-abbd-98ec98428444" -Force -ErrorAction SilentlyContinue

  # Kill watchdog
  Stop-Process -Name "mde_process_watchdog" -Force -ErrorAction SilentlyContinue
  ```

- [ ] **Isolate affected host** (if unauthorized)
  ```powershell
  # Network isolation via Windows Firewall
  netsh advfirewall set allprofiles state on
  netsh advfirewall firewall add rule name="Containment-BlockOutbound" dir=out action=block
  ```

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Test execution logs | `C:\F0\test_execution_log.json` | `Copy-Item "C:\F0\*" -Destination "C:\IR\F0_artifacts\" -Recurse` |
| Process injection report | `C:\F0\process_injection_report.json` | Included in above |
| Memory patch report | `C:\F0\memory_patch_report.json` | Included in above |
| API interception report | `C:\F0\api_interception_report.json` | Included in above |
| Windows Event Logs | Various | See below |

#### Event Log Collection
```powershell
# Create IR directory
New-Item -Path "C:\IR" -ItemType Directory -Force

# Export relevant event logs
$logs = @("Security", "System", "Microsoft-Windows-Sysmon/Operational",
          "Microsoft-Windows-Windows Defender/Operational")
foreach ($log in $logs) {
    wevtutil epl $log "C:\IR\$($log -replace '/','-').evtx"
}

# Export process creation events
Get-WinEvent -FilterHashtable @{LogName='Security';ID=4688} -MaxEvents 1000 |
    Export-Csv "C:\IR\process_creation.csv" -NoTypeInformation
```

#### Memory Acquisition
```powershell
# If memory patching suspected, acquire memory before reboot
# Using WinPMEM (if available)
.\winpmem_mini_x64.exe C:\IR\memory.raw
```

### 4. Eradication

#### Remove Test Artifacts
```powershell
# AFTER evidence collection
Remove-Item -Path "C:\F0\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "C:\F0" -Force -ErrorAction SilentlyContinue
```

#### Restore MDE Functionality
```powershell
# Restart MDE services
Restart-Service -Name "Sense" -Force
Restart-Service -Name "WinDefend" -Force

# Verify services are running
Get-Service -Name "Sense", "WinDefend" | Select Name, Status
```

#### If Memory Patches Were Applied
```powershell
# Run emergency restore if available
if (Test-Path "C:\F0\emergency_restore.ps1") {
    & "C:\F0\emergency_restore.ps1" -Force
}

# Or reboot to clear memory patches
Restart-Computer -Force
```

### 5. Recovery

#### System Restoration Checklist

- [ ] Verify all test artifacts removed
- [ ] Confirm MDE service is running and reporting
- [ ] Verify tamper protection is enabled
- [ ] Check MDE portal for device status
- [ ] Validate network connectivity to MDE endpoints
- [ ] Run AV scan to ensure no persistence
- [ ] Reconnect to network (after validation)

#### Validation Commands
```powershell
# Verify clean state
Get-ChildItem "C:\F0" -ErrorAction SilentlyContinue  # Should not exist

# Verify MDE is operational
$status = Get-MpComputerStatus
Write-Host "Real-time Protection: $($status.RealTimeProtectionEnabled)"
Write-Host "Tamper Protected: $($status.IsTamperProtected)"
Write-Host "AV Signature Age: $($status.AntivirusSignatureAge) days"

# Verify services
Get-Service -Name "Sense", "WinDefend" | Format-Table Name, Status, StartType

# Verify network connectivity to MDE
Test-NetConnection -ComputerName "winatp-gw-eus.microsoft.com" -Port 443
```

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which rule/alert?)
2. What was the detection-to-response time?
3. Were all 11 attack phases detected?
4. Which protections successfully blocked the attack?
5. What would have prevented this attack?
6. What detection gaps were identified?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Deploy all KQL queries to Sentinel | High |
| Detection | Enable LimaCharlie D&R rules | High |
| Prevention | Enable all ASR rules in Block mode | Critical |
| Prevention | Enable Memory Integrity (HVCI) | Critical |
| Prevention | Enable Tamper Protection | Critical |
| Visibility | Enable command line auditing | High |
| Visibility | Deploy Sysmon with appropriate config | High |
| Response | Document IR procedures for EDR attacks | Medium |

---

## References

### MITRE ATT&CK
- [T1055 - Process Injection](https://attack.mitre.org/techniques/T1055/)
- [T1055.001 - Dynamic-link Library Injection](https://attack.mitre.org/techniques/T1055/001/)
- [T1562.001 - Impair Defenses: Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/)
- [T1014 - Rootkit](https://attack.mitre.org/techniques/T1014/)
- [T1557 - Adversary-in-the-Middle](https://attack.mitre.org/techniques/T1557/)
- [T1071.001 - Application Layer Protocol: Web Protocols](https://attack.mitre.org/techniques/T1071/001/)

### Research
- [InfoGuard Labs - Attacking EDR Part 5: MDE Vulnerabilities](https://labs.infoguard.ch/posts/attacking_edr_part5_vulnerabilities_in_defender_for_endpoint_communication/)
- [Microsoft Security Response Center](https://msrc.microsoft.com/)

### Microsoft Documentation
- [Attack Surface Reduction Rules](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction-rules-reference)
- [Memory Integrity (HVCI)](https://docs.microsoft.com/en-us/windows/security/threat-protection/device-guard/enable-virtualization-based-protection-of-code-integrity)
- [Tamper Protection](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/prevent-changes-to-security-settings-with-tamper-protection)

---

## Generated Files

| File | Description |
|------|-------------|
| `fec68e9b-af59-40c1-abbd-98ec98428444_DEFENSE_GUIDANCE.md` | This comprehensive defense document |
| `fec68e9b-af59-40c1-abbd-98ec98428444_detections.kql` | 13 KQL detection queries for Microsoft Sentinel/Defender |
| `fec68e9b-af59-40c1-abbd-98ec98428444_dr_rules.yaml` | 12 LimaCharlie D&R rules |
| `fec68e9b-af59-40c1-abbd-98ec98428444_rules.yar` | 10 YARA detection rules |
| `fec68e9b-af59-40c1-abbd-98ec98428444_hardening.ps1` | PowerShell hardening script with 8 security sections |

---

**Generated**: 2025-12-07
**F0RT1KA Defense Guidance Builder**
**Test Version**: 1.0
