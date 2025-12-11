# Defense Guidance: Akira Ransomware BYOVD Attack Chain

## Executive Summary

This document provides comprehensive defensive guidance against the Akira Ransomware BYOVD (Bring Your Own Vulnerable Driver) attack chain, which combines vulnerable driver exploitation with Windows Defender registry manipulation for defense evasion.

| Field | Value |
|-------|-------|
| **Test ID** | c3634a9c-e8c9-44a8-992b-0faeca14f612 |
| **Test Name** | Akira Ransomware BYOVD Attack Chain |
| **MITRE ATT&CK** | T1068 (Exploitation for Privilege Escalation), T1562.001 (Impair Defenses: Disable or Modify Tools) |
| **Severity** | Critical |
| **Score** | 8.9/10 |

---

## Threat Overview

The Akira ransomware group employs a sophisticated multi-stage BYOVD attack that:

1. **Deploys Vulnerable Drivers**: Drops legitimate but vulnerable drivers (rwdrv.sys - ThrottleStop driver) that can be exploited for kernel-level access
2. **Registers Malicious Services**: Creates Windows kernel services (`mgdsrv`, `KMHLPSVC`) to load drivers
3. **Manipulates Security Controls**: Uses PowerShell to modify Windows Defender registry settings
4. **Bypasses Tamper Protection**: Attempts to disable real-time protection and tamper protection mechanisms

### Attack Flow

```
[Initial Access] --> [Drop Vulnerable Driver: rwdrv.sys]
                          |
                          v
              [Drop Malicious Helper: hlpdrv.sys]
                          |
                          v
              [Create Service: mgdsrv (kernel mode)]
                          |
                          v
              [Create Service: KMHLPSVC (kernel mode)]
                          |
                          v
              [Execute PowerShell: defender_disable.ps1]
                          |
                          v
              [Modify Registry: DisableAntiSpyware = 1]
                          |
                          v
              [Disable Tamper Protection]
                          |
                          v
              [Ransomware Deployment]
```

---

## MITRE ATT&CK Mapping with Mitigations

### T1068 - Exploitation for Privilege Escalation

| Mitigation ID | Mitigation Name | Implementation |
|---------------|-----------------|----------------|
| **M1051** | Update Software | Maintain current Windows patches and driver updates |
| **M1038** | Execution Prevention | Block execution of known vulnerable drivers via WDAC/AppLocker |
| **M1050** | Exploit Protection | Deploy EMET/Exploit Guard for behavioral detection |
| **M1048** | Application Isolation | Use virtualization to limit exploitation impact |

### T1562.001 - Impair Defenses: Disable or Modify Tools

| Mitigation ID | Mitigation Name | Implementation |
|---------------|-----------------|----------------|
| **M1047** | Audit | Enable auditing for registry modifications and service creation |
| **M1038** | Execution Prevention | Restrict PowerShell execution and script execution |
| **M1024** | Restrict Registry Permissions | Protect Windows Defender registry keys |
| **M1022** | Restrict File/Directory Permissions | Prevent unauthorized driver file creation |
| **M1018** | User Account Management | Limit administrative privileges |

---

## Detection Rules

### KQL Queries (Microsoft Sentinel/Defender)

See `c3634a9c-e8c9-44a8-992b-0faeca14f612_detections.kql` for complete queries including:

1. **Driver File Drop Detection** - Monitors for .sys files in suspicious locations
2. **Vulnerable Driver Signature Detection** - Detects known vulnerable driver hashes
3. **Service Creation Monitoring** - Alerts on kernel service registration
4. **Defender Registry Tampering** - Detects DisableAntiSpyware modifications
5. **PowerShell Execution Policy Bypass** - Monitors for -ExecutionPolicy Bypass
6. **Behavioral Correlation** - Multi-indicator high-confidence detection

### LimaCharlie D&R Rules

See `c3634a9c-e8c9-44a8-992b-0faeca14f612_dr_rules.yaml` for deployment-ready rules.

### YARA Rules

See `c3634a9c-e8c9-44a8-992b-0faeca14f612_rules.yar` for file-based detection.

---

## Hardening Guidance

### Quick Wins (Immediate Implementation)

Run the PowerShell hardening script:
```powershell
.\c3634a9c-e8c9-44a8-992b-0faeca14f612_hardening.ps1
```

The script implements:
1. **Driver Signature Enforcement** - Requires signed drivers
2. **Vulnerable Driver Blocklist** - Blocks known exploitable drivers
3. **Windows Defender Tamper Protection** - Protects security settings
4. **Service Creation Auditing** - Enables Event ID 7045 logging
5. **Registry Auditing** - Monitors Defender policy key changes

### Advanced Hardening

#### 1. Windows Defender Application Control (WDAC)

**Purpose**: Block unsigned and vulnerable drivers

```xml
<!-- WDAC Policy to block vulnerable drivers -->
<SiPolicy>
  <Rules>
    <Rule>
      <Option>Enabled:UMCI</Option>
    </Rule>
    <Rule>
      <Option>Enabled:Boot Menu Protection</Option>
    </Rule>
    <Rule>
      <Option>Required:WHQL</Option>
    </Rule>
  </Rules>
  <FileRules>
    <!-- Block rwdrv.sys by hash -->
    <Deny ID="ID_DENY_RWDRV" FriendlyName="ThrottleStop Vulnerable Driver"
          Hash="<SHA256_HASH_OF_RWDRV.SYS>" />
  </FileRules>
</SiPolicy>
```

**Group Policy Path**:
```
Computer Configuration > Administrative Templates > System > Device Installation > Device Installation Restrictions
```

#### 2. Hypervisor-Protected Code Integrity (HVCI)

**Purpose**: Kernel-level protection against driver exploitation

**Registry Setting**:
```
Path: HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard
Name: EnableVirtualizationBasedSecurity
Type: REG_DWORD
Value: 1
```

**Verification**:
```powershell
Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard
```

#### 3. Microsoft Vulnerable Driver Blocklist

**Purpose**: Block known exploitable drivers at kernel level

**Enable via Registry**:
```powershell
# Enable vulnerable driver blocklist
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Config" `
    -Name "VulnerableDriverBlocklistEnable" -Value 1 -Type DWord

# Force update of blocklist
gpupdate /force
```

**Verification**:
```powershell
Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Config" |
    Select-Object VulnerableDriverBlocklistEnable
```

#### 4. Protect Windows Defender Registry Keys

**Registry Keys to Protect**:
| Key | Purpose |
|-----|---------|
| `HKLM\SOFTWARE\Policies\Microsoft\Windows Defender` | Policy settings |
| `HKLM\SOFTWARE\Microsoft\Windows Defender\Features` | Feature toggles |
| `HKLM\SOFTWARE\Microsoft\Windows Defender\Real-Time Protection` | RTP settings |

**Audit Configuration**:
```powershell
# Enable registry auditing for Defender keys
$acl = Get-Acl "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
$rule = New-Object System.Security.AccessControl.RegistryAuditRule(
    "Everyone",
    "SetValue,Delete",
    "ContainerInherit,ObjectInherit",
    "None",
    "Success,Failure"
)
$acl.AddAuditRule($rule)
Set-Acl "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender" $acl
```

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | c3634a9c-e8c9-44a8-992b-0faeca14f612 |
| **Attack Type** | BYOVD + Defense Evasion |
| **Severity** | Critical |
| **Estimated Response Time** | 1-2 hours |
| **Required Skills** | Windows internals, driver analysis, registry forensics |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| Driver Drop in C:\F0 | .sys file created in C:\F0\ | High | P1 |
| Vulnerable Driver Hash | Known rwdrv.sys hash detected | High | P1 |
| Service Creation mgdsrv | Service with name "mgdsrv" created | High | P1 |
| Defender Registry Modified | DisableAntiSpyware set to 1 | Critical | P1 |
| PowerShell ExecutionPolicy Bypass | -ExecutionPolicy Bypass detected | Medium | P2 |

#### Initial Triage Questions

1. Is this a known F0RT1KA security test or unexpected activity?
2. What is the scope - single host or multiple endpoints?
3. What user account is associated with the activity?
4. Has ransomware deployment been observed?
5. Is Windows Defender still functional?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Isolate affected host(s)**
```powershell
# Network isolation via Windows Firewall
netsh advfirewall set allprofiles firewallpolicy blockinbound,blockoutbound
```

- [ ] **Stop malicious services**
```powershell
# Stop and disable the malicious services
Stop-Service -Name "mgdsrv" -Force -ErrorAction SilentlyContinue
Stop-Service -Name "KMHLPSVC" -Force -ErrorAction SilentlyContinue
sc.exe config mgdsrv start= disabled
sc.exe config KMHLPSVC start= disabled
```

- [ ] **Preserve volatile evidence**
```powershell
# Create incident response directory
$irPath = "C:\IR_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -Path $irPath -ItemType Directory -Force

# Capture running processes
Get-Process | Export-Csv "$irPath\processes.csv" -NoTypeInformation

# Capture services
Get-Service | Export-Csv "$irPath\services.csv" -NoTypeInformation

# Capture loaded drivers
Get-WmiObject Win32_SystemDriver | Export-Csv "$irPath\drivers.csv" -NoTypeInformation

# Capture network connections
Get-NetTCPConnection | Export-Csv "$irPath\connections.csv" -NoTypeInformation
```

- [ ] **Verify Windows Defender status**
```powershell
# Check if Defender is still operational
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled,
    AntivirusEnabled, AntispywareEnabled, BehaviorMonitorEnabled |
    Export-Csv "$irPath\defender_status.csv" -NoTypeInformation

# Check for DisableAntiSpyware registry setting
Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender" `
    -Name DisableAntiSpyware -ErrorAction SilentlyContinue
```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Driver files | `C:\F0\*.sys` | `Copy-Item "C:\F0\*" -Destination "$irPath\F0_artifacts\" -Recurse` |
| PowerShell script | `C:\F0\defender_disable.ps1` | `Copy-Item "C:\F0\defender_disable.ps1" -Destination "$irPath\"` |
| Status file | `C:\F0\status.txt` | `Copy-Item "C:\F0\status.txt" -Destination "$irPath\"` |
| Test execution log | `C:\F0\*_log.json` | `Copy-Item "C:\F0\*_log.json" -Destination "$irPath\"` |
| Service registry | `HKLM\SYSTEM\CurrentControlSet\Services\mgdsrv` | Export via regedit |
| Defender policy | `HKLM\SOFTWARE\Policies\Microsoft\Windows Defender` | Export via regedit |

#### Registry Export
```powershell
# Export relevant registry keys
reg export "HKLM\SYSTEM\CurrentControlSet\Services\mgdsrv" "$irPath\svc_mgdsrv.reg" 2>$null
reg export "HKLM\SYSTEM\CurrentControlSet\Services\KMHLPSVC" "$irPath\svc_kmhlpsvc.reg" 2>$null
reg export "HKLM\SOFTWARE\Policies\Microsoft\Windows Defender" "$irPath\defender_policy.reg" 2>$null
reg export "HKLM\SOFTWARE\Microsoft\Windows Defender" "$irPath\defender_config.reg" 2>$null
```

#### Event Log Export
```powershell
# Export relevant event logs
$logs = @("Security", "System", "Microsoft-Windows-Sysmon/Operational",
          "Microsoft-Windows-PowerShell/Operational")
foreach ($log in $logs) {
    try {
        wevtutil epl $log "$irPath\$($log -replace '/','-').evtx"
    } catch {
        Write-Warning "Failed to export $log"
    }
}
```

#### Driver Analysis
```powershell
# Calculate hashes of dropped drivers
Get-ChildItem "C:\F0\*.sys" | ForEach-Object {
    [PSCustomObject]@{
        FileName = $_.Name
        SHA256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
        SHA1 = (Get-FileHash $_.FullName -Algorithm SHA1).Hash
        MD5 = (Get-FileHash $_.FullName -Algorithm MD5).Hash
        Size = $_.Length
    }
} | Export-Csv "$irPath\driver_hashes.csv" -NoTypeInformation
```

---

### 4. Eradication

#### Service Removal
```powershell
# Delete malicious services (AFTER evidence collection)
sc.exe stop mgdsrv
sc.exe stop KMHLPSVC
sc.exe delete mgdsrv
sc.exe delete KMHLPSVC
```

#### File Removal
```powershell
# Remove attack artifacts (AFTER evidence collection)
$filesToRemove = @(
    "C:\F0\rwdrv.sys",
    "C:\F0\hlpdrv.sys",
    "C:\F0\defender_disable.ps1",
    "C:\F0\status.txt"
)

foreach ($file in $filesToRemove) {
    if (Test-Path $file) {
        Remove-Item $file -Force -ErrorAction SilentlyContinue
        Write-Host "Removed: $file"
    }
}
```

#### Registry Cleanup
```powershell
# Remove DisableAntiSpyware setting
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender" `
    -Name "DisableAntiSpyware" -ErrorAction SilentlyContinue

# Remove TamperProtection modification
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows Defender\Features" `
    -Name "TamperProtection" -ErrorAction SilentlyContinue

# Remove Real-Time Protection modifications
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection" `
    -Name "DisableRealtimeMonitoring" -ErrorAction SilentlyContinue
```

#### Restore Windows Defender
```powershell
# Re-enable Windows Defender
Set-MpPreference -DisableRealtimeMonitoring $false
Set-MpPreference -MAPSReporting Advanced
Start-Service -Name WinDefend -ErrorAction SilentlyContinue

# Verify restoration
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AntivirusEnabled
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] All malicious services deleted
- [ ] All driver files removed
- [ ] Registry modifications reverted
- [ ] Windows Defender operational
- [ ] Tamper Protection re-enabled
- [ ] Network connectivity restored

#### Validation Commands
```powershell
# Verify clean state
Write-Host "=== Validation Results ===" -ForegroundColor Cyan

# Check for residual files
$residualFiles = Get-ChildItem "C:\F0\" -ErrorAction SilentlyContinue
if ($residualFiles) {
    Write-Host "[!] Residual files found in C:\F0\" -ForegroundColor Red
} else {
    Write-Host "[+] C:\F0\ is clean" -ForegroundColor Green
}

# Check for residual services
$services = @("mgdsrv", "KMHLPSVC")
foreach ($svc in $services) {
    if (Get-Service -Name $svc -ErrorAction SilentlyContinue) {
        Write-Host "[!] Service still exists: $svc" -ForegroundColor Red
    } else {
        Write-Host "[+] Service removed: $svc" -ForegroundColor Green
    }
}

# Check Defender status
$defender = Get-MpComputerStatus
if ($defender.RealTimeProtectionEnabled) {
    Write-Host "[+] Real-Time Protection: Enabled" -ForegroundColor Green
} else {
    Write-Host "[!] Real-Time Protection: DISABLED" -ForegroundColor Red
}

# Check DisableAntiSpyware
$disableAS = Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender" `
    -Name DisableAntiSpyware -ErrorAction SilentlyContinue
if ($disableAS.DisableAntiSpyware -eq 1) {
    Write-Host "[!] DisableAntiSpyware: Still set to 1" -ForegroundColor Red
} else {
    Write-Host "[+] DisableAntiSpyware: Clean" -ForegroundColor Green
}
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? Which detection rule triggered first?
2. What was the detection-to-response time?
3. Was signature detection or behavioral detection more effective?
4. Were there gaps in logging or visibility?
5. What would have prevented this attack entirely?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| **Detection** | Deploy vulnerable driver blocklist | High |
| **Detection** | Enable Sysmon for driver load events (Event ID 6) | High |
| **Prevention** | Implement WDAC policy to block unsigned drivers | High |
| **Prevention** | Enable HVCI for kernel protection | High |
| **Prevention** | Restrict administrative access | Medium |
| **Response** | Create automated containment playbook | Medium |
| **Monitoring** | Enable registry auditing on Defender keys | Medium |

---

## References

- [MITRE ATT&CK - T1068: Exploitation for Privilege Escalation](https://attack.mitre.org/techniques/T1068/)
- [MITRE ATT&CK - T1562.001: Impair Defenses: Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/)
- [Microsoft Vulnerable Driver Blocklist](https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-defender-application-control/microsoft-recommended-driver-block-rules)
- [Windows Defender Application Control](https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-defender-application-control/wdac-and-applocker-overview)
- [Hypervisor-Protected Code Integrity](https://learn.microsoft.com/en-us/windows/security/hardware-security/enable-virtualization-based-protection-of-code-integrity)

---

## Document Information

| Field | Value |
|-------|-------|
| **Created** | 2025-12-07 |
| **Author** | F0RT1KA Defense Guidance Builder |
| **Version** | 1.0 |
| **Classification** | Internal Use |

---

**Related Files:**
- `c3634a9c-e8c9-44a8-992b-0faeca14f612_detections.kql` - KQL detection queries
- `c3634a9c-e8c9-44a8-992b-0faeca14f612_dr_rules.yaml` - LimaCharlie D&R rules
- `c3634a9c-e8c9-44a8-992b-0faeca14f612_rules.yar` - YARA detection rules
- `c3634a9c-e8c9-44a8-992b-0faeca14f612_hardening.ps1` - PowerShell hardening script
