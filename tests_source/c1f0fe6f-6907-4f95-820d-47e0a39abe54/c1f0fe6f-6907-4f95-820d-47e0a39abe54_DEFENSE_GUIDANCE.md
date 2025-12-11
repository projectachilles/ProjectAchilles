# Defense Guidance: TrollDisappearKey AMSI Bypass Detection

## Executive Summary

This document provides comprehensive defense guidance for detecting, preventing, and responding to TrollDisappearKey AMSI bypass attacks. TrollDisappearKey is a sophisticated defense evasion tool that manipulates Windows registry queries to disable AMSI (Anti-Malware Scan Interface) provider loading, enabling the execution of malicious .NET assemblies without security scanning.

| Field | Value |
|-------|-------|
| **Test ID** | c1f0fe6f-6907-4f95-820d-47e0a39abe54 |
| **Test Name** | TrollDisappearKey AMSI Bypass Detection |
| **MITRE ATT&CK** | [T1562.001](https://attack.mitre.org/techniques/T1562/001/) - Impair Defenses: Disable or Modify Tools |
| **Tactic** | Defense Evasion |
| **Severity** | High |
| **Test Score** | 7.9/10 |

---

## Threat Overview

### Attack Description

TrollDisappearKey bypasses Windows AMSI protection through API hooking and registry manipulation:

1. **API Hooking**: Hooks the `RegOpenKeyExW` function in KERNELBASE.dll
2. **Registry Redirection**: Intercepts queries for `Software\Microsoft\AMSI\Providers`
3. **Provider Loading Disruption**: Redirects queries to `Software\Microsoft\AMSI\Providers ` (trailing space)
4. **AMSI Bypass**: Security vendor DLLs fail to load, disabling AMSI scanning
5. **Payload Execution**: Downloads and executes arbitrary .NET assemblies (e.g., Seatbelt)

### Technical Details

```
Attack Chain:
[Binary Drop] -> [Hook Installation] -> [Registry Manipulation] -> [AMSI Bypass] -> [Remote Assembly Download] -> [Payload Execution]
```

**Key Indicators:**
- File: `troll_disappear_key.exe` dropped to `c:\F0\`
- Registry key manipulation: `HKLM\Software\Microsoft\AMSI\Providers`
- Remote .NET assembly download from GitHub
- `WebClient.DownloadData()` for assembly retrieval
- `Assembly.Load()` for in-memory execution

### Attack Flow

```
+------------------+     +-----------------+     +-------------------+
|  Drop Binary     | --> |  Install Hook   | --> |  Intercept Reg    |
|  troll_disappear |     |  RegOpenKeyExW  |     |  AMSI\Providers   |
|  _key.exe        |     |  in KERNELBASE  |     |  Queries          |
+------------------+     +-----------------+     +-------------------+
                                                          |
                                                          v
+------------------+     +-----------------+     +-------------------+
|  Execute Payload | <-- |  Download .NET  | <-- |  Redirect to      |
|  Seatbelt.exe    |     |  Assembly from  |     |  "Providers "     |
|  in memory       |     |  Remote URL     |     |  (with space)     |
+------------------+     +-----------------+     +-------------------+
```

---

## MITRE ATT&CK Mapping

### Primary Technique

| Technique | Name | Tactic |
|-----------|------|--------|
| [T1562.001](https://attack.mitre.org/techniques/T1562/001/) | Impair Defenses: Disable or Modify Tools | Defense Evasion |

### Related Techniques

| Technique | Name | Relevance |
|-----------|------|-----------|
| [T1055](https://attack.mitre.org/techniques/T1055/) | Process Injection | Hook installation mechanism |
| [T1112](https://attack.mitre.org/techniques/T1112/) | Modify Registry | Registry manipulation vector |
| [T1105](https://attack.mitre.org/techniques/T1105/) | Ingress Tool Transfer | Remote assembly download |
| [T1620](https://attack.mitre.org/techniques/T1620/) | Reflective Code Loading | In-memory .NET execution |

### Applicable Mitigations

| Mitigation ID | Name | Implementation |
|---------------|------|----------------|
| [M1038](https://attack.mitre.org/mitigations/M1038/) | Execution Prevention | Application control, script blocking |
| [M1024](https://attack.mitre.org/mitigations/M1024/) | Restrict Registry Permissions | Protect AMSI registry keys |
| [M1018](https://attack.mitre.org/mitigations/M1018/) | User Account Management | Limit privileges |
| [M1049](https://attack.mitre.org/mitigations/M1049/) | Antivirus/Antimalware | Endpoint protection |

---

## Detection Rules

### Detection Priority Matrix

| Detection Layer | Confidence | Priority | Description |
|-----------------|------------|----------|-------------|
| AMSI Bypass Indicators | High | P1 | Direct AMSI tampering detection |
| API Hook Installation | High | P1 | Detour/trampoline patterns |
| Registry Manipulation | High | P2 | AMSI provider key access |
| Remote Assembly Download | Medium | P2 | WebClient network activity |
| Process Behavior | Medium | P3 | Suspicious .NET execution patterns |

### Available Detection Files

| File | Format | Purpose |
|------|--------|---------|
| `c1f0fe6f-6907-4f95-820d-47e0a39abe54_detections.kql` | KQL | Microsoft Sentinel/Defender queries |
| `c1f0fe6f-6907-4f95-820d-47e0a39abe54_dr_rules.yaml` | YAML | LimaCharlie D&R rules |
| `c1f0fe6f-6907-4f95-820d-47e0a39abe54_rules.yar` | YARA | File/memory signature rules |

---

## Hardening Guidance

### Quick Wins (Immediate Actions)

1. **Enable PowerShell Constrained Language Mode**
   - Prevents access to dangerous .NET APIs like `Add-Type`
   - Blocks arbitrary code execution in PowerShell

2. **Configure AMSI Logging**
   - Enable Windows Event ID 1116 for AMSI detections
   - Forward AMSI events to SIEM

3. **Block Untrusted .NET Assembly Loading**
   - Configure AppLocker/WDAC policies
   - Restrict `Assembly.Load()` from network sources

4. **Enable Attack Surface Reduction (ASR) Rules**
   - Block untrusted and unsigned processes from USB
   - Block executable content from email and webmail

### Implementation Script

See `c1f0fe6f-6907-4f95-820d-47e0a39abe54_hardening.ps1` for automated hardening.

### Complex Hardening (Requires Planning)

#### 1. AMSI Provider Registry Protection

**MITRE Mitigation:** [M1024](https://attack.mitre.org/mitigations/M1024/) - Restrict Registry Permissions

| Setting | Value |
|---------|-------|
| **Registry Path** | `HKLM\SOFTWARE\Microsoft\AMSI\Providers` |
| **Recommended ACL** | SYSTEM: Full Control, Administrators: Read |
| **Impact Level** | Medium |

**Implementation:**
```powershell
# Restrict AMSI provider registry key permissions
$key = "HKLM:\SOFTWARE\Microsoft\AMSI\Providers"
$acl = Get-Acl $key
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.RegistryAccessRule(
    "BUILTIN\Administrators", "ReadKey", "Allow"
)
$acl.AddAccessRule($rule)
Set-Acl -Path $key -AclObject $acl
```

**Considerations:**
- May impact security software updates
- Test thoroughly in non-production environment
- Document for rollback procedures

#### 2. API Hook Detection via ETW

**Purpose:** Detect RegOpenKeyExW hooking attempts

| Setting | Value |
|---------|-------|
| **Provider** | Microsoft-Windows-Kernel-Registry |
| **Events** | RegOpenKey, RegQueryKey |
| **Impact Level** | Low |

**ETW Provider GUID:** `{70EB4F03-C1DE-4F73-A051-33D13D5413BD}`

#### 3. .NET Assembly Loading Restrictions

**MITRE Mitigation:** [M1038](https://attack.mitre.org/mitigations/M1038/) - Execution Prevention

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > Windows Components >
.NET Framework > Network Security > Restrict .NET Framework from loading assemblies from network locations
```

**Registry Equivalent:**
```
Path: HKLM\SOFTWARE\Microsoft\.NETFramework
Name: AllowStrongNameBypass
Type: REG_DWORD
Value: 0
```

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | c1f0fe6f-6907-4f95-820d-47e0a39abe54 |
| **Test Name** | TrollDisappearKey AMSI Bypass Detection |
| **MITRE ATT&CK** | [T1562.001](https://attack.mitre.org/techniques/T1562/001/) |
| **Severity** | High |
| **Estimated Response Time** | 1-2 hours |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| AMSI Bypass Tool Execution | Process name contains "troll" or "amsi" bypass patterns | High | P1 |
| AMSI Provider Registry Access | Unusual access to `AMSI\Providers` key | High | P1 |
| Remote .NET Assembly Download | WebClient downloading .exe from GitHub | Medium | P2 |
| API Hook Installation | VirtualProtect on KERNELBASE.dll + memory write | High | P1 |
| Seatbelt Execution | Known security enumeration tool patterns | Medium | P2 |

#### Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What user account initiated the process?
3. Was the binary dropped to `c:\F0\` (test framework) or elsewhere?
4. Are there network connections to GitHub or other remote sources?
5. What other processes were spawned by the suspicious binary?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Isolate affected host(s)**
  ```powershell
  # Network isolation via Windows Firewall
  netsh advfirewall set allprofiles firewallpolicy blockinbound,blockoutbound

  # Allow only essential traffic (adjust as needed)
  netsh advfirewall firewall add rule name="Allow DNS" dir=out action=allow protocol=udp remoteport=53
  ```

- [ ] **Terminate malicious processes**
  ```powershell
  # Kill TrollDisappearKey and related processes
  Get-Process | Where-Object { $_.Name -like "*troll*" -or $_.Path -like "*c:\F0\*" } | Stop-Process -Force

  # Kill any suspicious .NET processes loading assemblies
  Get-Process | Where-Object { $_.MainModule.FileName -like "*seatbelt*" } | Stop-Process -Force
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create IR collection directory
  $IRPath = "C:\IR\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  New-Item -ItemType Directory -Path $IRPath -Force

  # Capture running processes with command lines
  Get-CimInstance Win32_Process | Select-Object ProcessId, Name, CommandLine, ExecutablePath |
      Export-Csv "$IRPath\processes.csv" -NoTypeInformation

  # Capture loaded modules (look for hooked DLLs)
  Get-Process | ForEach-Object {
      $_.Modules | Select-Object @{N='ProcessName';E={$_.FileName}}, ModuleName, FileName, BaseAddress
  } | Export-Csv "$IRPath\loaded_modules.csv" -NoTypeInformation

  # Capture network connections
  Get-NetTCPConnection | Export-Csv "$IRPath\tcp_connections.csv" -NoTypeInformation

  # Capture AMSI provider registry state
  Get-ChildItem "HKLM:\SOFTWARE\Microsoft\AMSI\Providers" -ErrorAction SilentlyContinue |
      Export-Csv "$IRPath\amsi_providers.csv" -NoTypeInformation
  ```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| TrollDisappearKey binary | `c:\F0\troll_disappear_key.exe` | `Copy-Item "c:\F0\*" -Destination "$IRPath\F0_artifacts\" -Recurse` |
| Downloaded assemblies | `c:\F0\Seatbelt.exe` | Included in above |
| Test execution logs | `c:\F0\*_log.json` | Included in above |
| AMSI provider registry | `HKLM:\SOFTWARE\Microsoft\AMSI` | `reg export "HKLM\SOFTWARE\Microsoft\AMSI" "$IRPath\amsi_registry.reg"` |
| Prefetch files | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*TROLL*" -Destination "$IRPath\Prefetch\"` |
| Event logs | System, Security, PowerShell | See below |

#### Event Log Collection
```powershell
# Export relevant event logs
$logs = @(
    "Security",
    "System",
    "Microsoft-Windows-PowerShell/Operational",
    "Microsoft-Windows-Windows Defender/Operational",
    "Microsoft-Windows-AMSI/Operational"
)

foreach ($log in $logs) {
    $safeName = $log -replace '[/\\]', '_'
    wevtutil epl $log "$IRPath\$safeName.evtx" 2>$null
}
```

#### Memory Acquisition (if available)
```powershell
# Using WinPMEM (if available)
.\winpmem_mini_x64.exe "$IRPath\memory.raw"

# Or process-specific dump for suspicious processes
$suspiciousPID = (Get-Process | Where-Object { $_.Name -like "*troll*" }).Id
procdump -ma $suspiciousPID "$IRPath\suspicious_process.dmp"
```

---

### 4. Eradication

#### File Removal
```powershell
# Remove attack artifacts (AFTER evidence collection)
$artifactsToRemove = @(
    "c:\F0\troll_disappear_key.exe",
    "c:\F0\Seatbelt.exe",
    "c:\F0\temp_assembly.exe"
)

foreach ($artifact in $artifactsToRemove) {
    if (Test-Path $artifact) {
        Remove-Item -Path $artifact -Force -ErrorAction SilentlyContinue
        Write-Host "Removed: $artifact"
    }
}
```

#### Registry Verification
```powershell
# Verify AMSI providers are intact
$providers = Get-ChildItem "HKLM:\SOFTWARE\Microsoft\AMSI\Providers" -ErrorAction SilentlyContinue
if ($providers) {
    Write-Host "AMSI Providers found: $($providers.Count)"
    $providers | ForEach-Object { Write-Host "  - $($_.PSChildName)" }
} else {
    Write-Host "WARNING: No AMSI providers found - may need restoration"
}

# Check for tampered registry keys (trailing spaces)
$tampered = Get-ChildItem "HKLM:\SOFTWARE\Microsoft\AMSI" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '\s$' }
if ($tampered) {
    Write-Host "WARNING: Found tampered registry keys with trailing spaces"
    $tampered | Remove-Item -Force
}
```

#### AMSI Restoration
```powershell
# Force AMSI reinitialization by restarting dependent services
Restart-Service -Name "WinDefend" -Force -ErrorAction SilentlyContinue
Restart-Service -Name "MsMpSvc" -Force -ErrorAction SilentlyContinue

# Verify AMSI is functional
$testResult = [System.Management.Automation.AmsiUtils]::ScanContent("AMSI Test String", "TestScan")
if ($testResult -eq 0) {
    Write-Host "AMSI scan successful - AMSI is functional"
} else {
    Write-Host "WARNING: AMSI may still be bypassed"
}
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] Verify all malicious artifacts removed
- [ ] Confirm AMSI providers are registered and functional
- [ ] Validate Windows Defender is running and up-to-date
- [ ] Restore any modified security configurations
- [ ] Re-enable network connectivity (after validation)
- [ ] Run full system scan with updated signatures

#### Validation Commands
```powershell
# Verify TrollDisappearKey artifacts removed
$artifactsExist = Test-Path "c:\F0\troll_disappear_key.exe"
Write-Host "TrollDisappearKey exists: $artifactsExist"

# Verify AMSI is functional
try {
    $amsiResult = [System.Management.Automation.AmsiUtils]::ScanContent("Invoke-Mimikatz", "TestScan")
    Write-Host "AMSI scan result: $amsiResult (1 = detected, indicates AMSI working)"
} catch {
    Write-Host "AMSI test failed: $_"
}

# Verify Windows Defender status
$defenderStatus = Get-MpComputerStatus
Write-Host "Defender Real-Time Protection: $($defenderStatus.RealTimeProtectionEnabled)"
Write-Host "Defender AMSI Protection: $($defenderStatus.AMServiceEnabled)"

# Verify no suspicious registry keys
$suspiciousKeys = Get-ChildItem "HKLM:\SOFTWARE\Microsoft\AMSI" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '\s$' }
Write-Host "Tampered registry keys found: $($suspiciousKeys.Count)"
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the AMSI bypass detected? (Which rule/alert?)
2. What was the detection-to-response time?
3. Were existing detection rules effective?
4. What allowed the initial binary execution?
5. Were any defense gaps identified?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Enable AMSI ETW logging and forward to SIEM | High |
| Detection | Implement API hook detection via EDR | High |
| Prevention | Deploy application whitelisting (WDAC/AppLocker) | High |
| Prevention | Restrict .NET assembly loading from network | Medium |
| Prevention | Harden AMSI provider registry permissions | Medium |
| Response | Create automated AMSI validation script | Medium |
| Response | Document AMSI restoration procedures | Low |

---

## References

### MITRE ATT&CK
- [T1562.001 - Impair Defenses: Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/)
- [T1112 - Modify Registry](https://attack.mitre.org/techniques/T1112/)
- [T1620 - Reflective Code Loading](https://attack.mitre.org/techniques/T1620/)
- [M1038 - Execution Prevention](https://attack.mitre.org/mitigations/M1038/)
- [M1024 - Restrict Registry Permissions](https://attack.mitre.org/mitigations/M1024/)

### Microsoft Documentation
- [Antimalware Scan Interface (AMSI)](https://docs.microsoft.com/en-us/windows/win32/amsi/antimalware-scan-interface-portal)
- [Windows Defender Attack Surface Reduction](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction)
- [PowerShell Constrained Language Mode](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes)

### Tool References
- [TrollDisappearKey GitHub Repository](https://github.com/cybersectroll/TrollDisappearKey)
- [Seatbelt Tool](https://github.com/GhostPack/Seatbelt)

---

## Appendix: Detection Files

| File | Description |
|------|-------------|
| `c1f0fe6f-6907-4f95-820d-47e0a39abe54_detections.kql` | Microsoft Sentinel/Defender KQL queries |
| `c1f0fe6f-6907-4f95-820d-47e0a39abe54_dr_rules.yaml` | LimaCharlie D&R rules |
| `c1f0fe6f-6907-4f95-820d-47e0a39abe54_rules.yar` | YARA detection rules |
| `c1f0fe6f-6907-4f95-820d-47e0a39abe54_hardening.ps1` | PowerShell hardening script |

---

*Generated by F0RT1KA Defense Guidance Builder*
*Date: 2025-12-07*
