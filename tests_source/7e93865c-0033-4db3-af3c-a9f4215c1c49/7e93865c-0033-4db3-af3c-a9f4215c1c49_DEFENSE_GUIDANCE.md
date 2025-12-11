# Defense Guidance: Process Injection via CreateRemoteThread

## Executive Summary

This document provides comprehensive defense guidance for protecting against process injection attacks using the CreateRemoteThread technique (MITRE ATT&CK T1055.002). This attack vector is commonly used by malware families including banking trojans, RATs, and ransomware to inject malicious code into legitimate processes, enabling defense evasion, privilege escalation, and persistence.

| Field | Value |
|-------|-------|
| **Test ID** | 7e93865c-0033-4db3-af3c-a9f4215c1c49 |
| **Test Name** | Process Injection via CreateRemoteThread |
| **MITRE ATT&CK** | [T1055.002 - Process Injection: Portable Executable Injection](https://attack.mitre.org/techniques/T1055/002/) |
| **Tactics** | Defense Evasion, Privilege Escalation |
| **Severity** | High |
| **Test Score** | 6.5/10 |

---

## Threat Overview

### Attack Description

This technique involves injecting code into a target process using a classic Windows API sequence:

1. **OpenProcess** - Acquire handle to target process with PROCESS_CREATE_THREAD, PROCESS_VM_OPERATION, PROCESS_VM_WRITE permissions
2. **VirtualAllocEx** - Allocate executable memory (PAGE_EXECUTE_READWRITE) in the target process
3. **WriteProcessMemory** - Write shellcode/payload to the allocated memory region
4. **CreateRemoteThread** - Create a new thread in the target process to execute the injected code

### Real-World Usage

| Threat Actor/Malware | Method |
|---------------------|--------|
| **Carbanak** | Downloads executables and injects directly into new processes |
| **GreyEnergy** | Contains module for injecting PE binaries into remote processes |
| **Brute Ratel C4** | Injects Latrodectus malware into Explorer.exe |
| **Pikabot** | Creates hardcoded processes (e.g., WerFault.exe) and injects decrypted payloads |
| **Rocke** | TermsHost.exe evades defenses by injecting into Notepad.exe |
| **AppleJeus (3CX Attack)** | Uses SigFlip tool to inject arbitrary code |

### Attack Flow

```
[Attacker Tool]
      |
      v
[1] Start Target Process (notepad.exe) -----------> Detection Point: Process Creation
      |
      v
[2] OpenProcess (VM_WRITE|CREATE_THREAD) ---------> Detection Point: Suspicious Handle Access
      |
      v
[3] VirtualAllocEx (PAGE_EXECUTE_READWRITE) ------> Detection Point: RWX Memory Allocation
      |
      v
[4] WriteProcessMemory (shellcode) ----------------> Detection Point: Cross-Process Write
      |
      v
[5] CreateRemoteThread (execute) ------------------> Detection Point: Remote Thread Creation
      |
      v
[Code Execution in Target Context]
```

---

## MITRE ATT&CK Mapping

### Technique Details

| ID | Name | Tactic |
|----|------|--------|
| T1055 | Process Injection | Defense Evasion, Privilege Escalation |
| T1055.002 | Portable Executable Injection | Defense Evasion, Privilege Escalation |

### Applicable Mitigations

| ID | Mitigation | Description |
|----|------------|-------------|
| [M1040](https://attack.mitre.org/mitigations/M1040/) | Behavior Prevention on Endpoint | Configure EDR to block suspicious API sequences (OpenProcess -> VirtualAllocEx -> WriteProcessMemory -> CreateRemoteThread) |

### Detection Recommendations (from MITRE)

**DET0106: Behavioral Detection of PE Injection via Remote Memory Mapping**
- Identifies PE injection through behavioral chain: one process opens a handle to another (OpenProcess), allocates remote memory (VirtualAllocEx), writes PE headers or shellcode (WriteProcessMemory), then creates a new thread (CreateRemoteThread or NtCreateThreadEx) to execute injected code without disk involvement.

---

## Detection Rules

### KQL Queries (Microsoft Sentinel/Defender)

See: `7e93865c-0033-4db3-af3c-a9f4215c1c49_detections.kql`

**Query Categories:**
1. Process Handle Access with Injection Permissions
2. Cross-Process Memory Allocation (PAGE_EXECUTE_READWRITE)
3. WriteProcessMemory Operations
4. CreateRemoteThread Detection
5. Remote Thread Start Address Anomalies
6. Behavioral Correlation - Full Injection Chain
7. F0RT1KA Test Framework Detection
8. Suspicious Parent-Child Process Relationships

### LimaCharlie D&R Rules

See: `7e93865c-0033-4db3-af3c-a9f4215c1c49_dr_rules.yaml`

**Rule Categories:**
1. Remote Thread Creation Detection
2. Sensitive Process Access Monitoring
3. Cross-Process Memory Operations
4. Injection Tool Execution Detection
5. Multi-Indicator Behavioral Correlation

### YARA Rules

See: `7e93865c-0033-4db3-af3c-a9f4215c1c49_rules.yar`

**Rule Categories:**
1. Process Injection Tool Detection
2. Shellcode Pattern Detection
3. CreateRemoteThread API Usage
4. Cross-Process Memory Operation Imports
5. F0RT1KA Framework Binary Detection

---

## Hardening Guidance

### Quick Reference

| Setting | Location | Recommended Value |
|---------|----------|-------------------|
| **Attack Surface Reduction** | Windows Defender | Block process injection behaviors |
| **Credential Guard** | Windows Security | Enabled |
| **Code Integrity** | Windows Security | WDAC/HVCI Enabled |
| **Process Creation Auditing** | Local Security Policy | Success & Failure |

### Hardening Script

See: `7e93865c-0033-4db3-af3c-a9f4215c1c49_hardening.ps1`

**Capabilities:**
- Enables process injection ASR rules
- Configures Credential Guard
- Enables Code Integrity policies
- Sets up comprehensive audit logging
- Includes rollback functionality

### Manual Hardening Steps

#### 1. Enable Attack Surface Reduction Rules

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > Windows Components >
Microsoft Defender Antivirus > Microsoft Defender Exploit Guard > Attack Surface Reduction
```

**Key ASR Rule for Process Injection:**
- GUID: `9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2` - Block credential stealing from LSASS
- GUID: `D1E49AAC-8F56-4280-B9BA-993A6D77406C` - Block process creations from PSExec and WMI

**PowerShell:**
```powershell
# Enable ASR rule to block credential stealing from LSASS
Set-MpPreference -AttackSurfaceReductionRules_Ids 9E6C4E1F-7D60-472F-BA1A-A39EF669E4B2 -AttackSurfaceReductionRules_Actions 1
```

#### 2. Enable Credential Guard

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > System > Device Guard >
Turn On Virtualization Based Security
```

**Registry:**
```
Path: HKLM\SYSTEM\CurrentControlSet\Control\LSA
Name: LsaCfgFlags
Type: REG_DWORD
Value: 1 (with UEFI lock) or 2 (without UEFI lock)
```

#### 3. Enable Process Creation Auditing

**Group Policy Path:**
```
Computer Configuration > Windows Settings > Security Settings >
Advanced Audit Policy Configuration > System Audit Policies > Detailed Tracking
```

**Settings:**
- Audit Process Creation: Success
- Audit Process Termination: Success

**Command Line:**
```cmd
auditpol /set /subcategory:"Process Creation" /success:enable
auditpol /set /subcategory:"Process Termination" /success:enable
```

**Include Command Line in Events:**
```
Path: HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit
Name: ProcessCreationIncludeCmdLine_Enabled
Type: REG_DWORD
Value: 1
```

#### 4. Enable Sysmon for Enhanced Monitoring

**Recommended Sysmon Config Events:**
- Event ID 8: CreateRemoteThread
- Event ID 10: ProcessAccess
- Event ID 1: Process Creation with command line

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 7e93865c-0033-4db3-af3c-a9f4215c1c49 |
| **Test Name** | Process Injection via CreateRemoteThread |
| **MITRE ATT&CK** | T1055.002 |
| **Severity** | High |
| **Estimated Response Time** | 30-60 minutes |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| CreateRemoteThread API Call | Non-standard process creating remote thread | High | P1 |
| Cross-Process Memory Write | WriteProcessMemory to another process | High | P1 |
| RWX Memory Allocation | VirtualAllocEx with PAGE_EXECUTE_READWRITE | Medium | P2 |
| Suspicious Process Handle | OpenProcess with VM_WRITE|CREATE_THREAD | Medium | P2 |
| Injection Chain Correlation | Multiple injection indicators within timeframe | Critical | P1 |

#### Initial Triage Questions

1. Is this a known security test execution (F0RT1KA) or unexpected activity?
2. What process initiated the injection attempt?
3. What process was targeted for injection?
4. Did the injection succeed or was it blocked?
5. What user account is associated with the activity?
6. Is this isolated or part of a broader attack pattern?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Identify the source process**
  ```powershell
  # Get process details for suspected injection source
  Get-Process -Id <source-pid> | Select-Object *
  Get-CimInstance Win32_Process -Filter "ProcessId=<source-pid>" | Select-Object CommandLine, ExecutablePath, ParentProcessId
  ```

- [ ] **Identify the target process**
  ```powershell
  # Check if target process is still running
  Get-Process -Id <target-pid> -ErrorAction SilentlyContinue
  ```

- [ ] **Terminate malicious process chain**
  ```powershell
  # Kill injection source process
  Stop-Process -Id <source-pid> -Force -ErrorAction SilentlyContinue

  # Kill potentially compromised target process
  Stop-Process -Id <target-pid> -Force -ErrorAction SilentlyContinue
  ```

- [ ] **Isolate affected host if needed**
  ```powershell
  # Network isolation via Windows Firewall (use cautiously)
  netsh advfirewall set allprofiles state on
  netsh advfirewall firewall add rule name="IR-Block-Outbound" dir=out action=block enable=yes
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create IR directory
  New-Item -Path "C:\IR" -ItemType Directory -Force

  # Capture running processes
  Get-Process | Export-Csv "C:\IR\processes_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

  # Capture network connections
  Get-NetTCPConnection | Export-Csv "C:\IR\connections_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

  # Capture loaded modules in suspicious process (if still running)
  Get-Process -Id <pid> | Select-Object -ExpandProperty Modules | Export-Csv "C:\IR\modules_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"
  ```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| F0RT1KA Test Logs | `c:\F0\*_log.json` | `Copy-Item "c:\F0\*" -Destination "C:\IR\F0_artifacts\" -Recurse` |
| Security Event Log | System | `wevtutil epl Security C:\IR\Security.evtx` |
| Sysmon Log | System | `wevtutil epl Microsoft-Windows-Sysmon/Operational C:\IR\Sysmon.evtx` |
| Process Memory | Memory | `procdump -ma <pid> C:\IR\` |
| Prefetch Files | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*" -Destination "C:\IR\Prefetch\"` |
| NTFS MFT | System | Use forensic tools (FTK, Autopsy) |

#### Key Event IDs to Review

| Event ID | Source | Description |
|----------|--------|-------------|
| 4688 | Security | Process Creation |
| 4689 | Security | Process Termination |
| 8 | Sysmon | CreateRemoteThread |
| 10 | Sysmon | ProcessAccess |
| 1 | Sysmon | Process Create |

#### Memory Analysis

```powershell
# Using ProcDump to capture memory
procdump -ma <target-pid> C:\IR\target_process.dmp

# Using WinPMEM for full memory acquisition (if available)
.\winpmem_mini_x64.exe C:\IR\memory.raw
```

#### Timeline Generation

```powershell
# Export relevant event logs
$logs = @("Security", "System", "Microsoft-Windows-Sysmon/Operational", "Microsoft-Windows-PowerShell/Operational")
foreach ($log in $logs) {
    try {
        wevtutil epl $log "C:\IR\$($log -replace '/','-').evtx"
    } catch {
        Write-Warning "Could not export $log"
    }
}
```

---

### 4. Eradication

#### Process Termination

```powershell
# Terminate injection source and any spawned processes
Get-CimInstance Win32_Process | Where-Object {
    $_.ParentProcessId -eq <source-pid> -or $_.ProcessId -eq <source-pid>
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
```

#### File Removal (AFTER evidence collection)

```powershell
# Remove F0RT1KA test artifacts
Remove-Item -Path "c:\F0\*" -Recurse -Force -ErrorAction SilentlyContinue

# Remove suspected malware binary
Remove-Item -Path "<malware-path>" -Force -ErrorAction SilentlyContinue
```

#### Registry Cleanup

```powershell
# Check for persistence mechanisms
Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
Get-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue

# Remove if found (replace <key-name> with actual value)
# Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "<key-name>"
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] Verify all malicious processes terminated
- [ ] Verify malicious artifacts removed
- [ ] Scan system with updated antivirus
- [ ] Verify security controls are re-enabled
- [ ] Restore network connectivity (if isolated)
- [ ] Monitor for re-infection indicators

#### Validation Commands

```powershell
# Verify no suspicious processes
Get-Process | Where-Object { $_.Path -like "*c:\F0*" }

# Verify F0 directory is clean
Get-ChildItem "c:\F0\" -ErrorAction SilentlyContinue

# Verify Defender is operational
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AMServiceEnabled

# Run quick scan
Start-MpScan -ScanType QuickScan
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? Which detection rule triggered?
2. What was the detection-to-containment time?
3. What initial access vector was used?
4. What would have prevented this attack?
5. Were there any detection gaps?
6. Is additional monitoring needed for this technique?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Deploy Sysmon with CreateRemoteThread monitoring (Event ID 8) | High |
| Prevention | Enable ASR rules for credential protection | High |
| Prevention | Deploy Credential Guard on critical systems | High |
| Detection | Implement behavioral analytics for injection patterns | Medium |
| Response | Create automated containment playbook | Medium |
| Training | Update SOC runbooks for process injection detection | Low |

---

## References

- [MITRE ATT&CK - T1055.002: Portable Executable Injection](https://attack.mitre.org/techniques/T1055/002/)
- [MITRE ATT&CK - M1040: Behavior Prevention on Endpoint](https://attack.mitre.org/mitigations/M1040/)
- [Microsoft: Attack Surface Reduction Rules](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction)
- [Microsoft: Credential Guard](https://docs.microsoft.com/en-us/windows/security/identity-protection/credential-guard/)
- [Elastic: Detecting Process Injection](https://www.elastic.co/blog/detecting-process-injection)
- [Red Canary: Process Injection Detection](https://redcanary.com/threat-detection-report/techniques/process-injection/)

---

## Appendix: File Listing

| File | Description |
|------|-------------|
| `7e93865c-0033-4db3-af3c-a9f4215c1c49_DEFENSE_GUIDANCE.md` | This comprehensive defense document |
| `7e93865c-0033-4db3-af3c-a9f4215c1c49_detections.kql` | Microsoft Sentinel/Defender KQL queries |
| `7e93865c-0033-4db3-af3c-a9f4215c1c49_dr_rules.yaml` | LimaCharlie Detection & Response rules |
| `7e93865c-0033-4db3-af3c-a9f4215c1c49_rules.yar` | YARA detection rules |
| `7e93865c-0033-4db3-af3c-a9f4215c1c49_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-07*
