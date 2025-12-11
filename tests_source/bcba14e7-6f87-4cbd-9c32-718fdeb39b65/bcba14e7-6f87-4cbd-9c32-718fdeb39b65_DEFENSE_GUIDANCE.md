# Defense Guidance: EDRSilencer Detection

## Executive Summary

This document provides comprehensive defensive guidance for detecting and preventing the attack techniques simulated by the F0RT1KA EDRSilencer Detection test. EDRSilencer is a defense evasion tool that uses Windows Filtering Platform (WFP) APIs to block outbound network traffic from EDR processes, effectively blinding security monitoring solutions.

| Field | Value |
|-------|-------|
| **Test ID** | bcba14e7-6f87-4cbd-9c32-718fdeb39b65 |
| **Test Name** | EDRSilencer Detection |
| **MITRE ATT&CK** | [T1562.001](https://attack.mitre.org/techniques/T1562/001/) - Impair Defenses: Disable or Modify Tools |
| **Tactic** | Defense Evasion |
| **Severity** | High |
| **Test Score** | 7.8/10 |

## Threat Overview

### Attack Description

EDRSilencer is an open-source tool designed to disable security controls by blocking outbound traffic from EDR (Endpoint Detection and Response) processes using Windows Filtering Platform (WFP) APIs. This technique allows adversaries to prevent EDR solutions from communicating with their cloud backends, effectively blinding security monitoring without terminating the EDR processes themselves.

### Attack Flow

1. **Initial Access**: Adversary gains access to target system with administrator privileges
2. **Tool Deployment**: EDRSilencer binary is dropped to `c:\F0\` directory
3. **EDR Discovery**: Tool identifies running EDR processes from a predefined list
4. **WFP Filter Creation**: Creates Windows Filtering Platform filters to block IPv4/IPv6 outbound traffic
5. **EDR Blindness**: Security tools cannot communicate with cloud backends, preventing alerts and telemetry

### Targeted EDR Solutions

EDRSilencer targets the following security solutions:
- Microsoft Defender for Endpoint / Microsoft Defender Antivirus
- CrowdStrike Falcon
- SentinelOne
- Carbon Black EDR / Carbon Black Cloud
- Cylance
- Elastic EDR
- Trellix EDR
- Qualys EDR
- Cybereason
- Tanium
- Palo Alto Networks Traps / Cortex XDR
- FortiEDR
- Cisco Secure Endpoint (Cisco AMP)
- ESET Inspect
- Harfanglab EDR
- TrendMicro Apex One

### Real-World Usage

This technique has been observed in real-world attacks by sophisticated threat actors including:
- **Wizard Spider**: Shut down or uninstalled security applications
- **LockBit**: Disabled Windows Defender and firewall rules
- **Lazarus Group**: Terminated security processes and disabled monitoring
- **APT29**: Used service control to disable security monitoring
- **REvil**: Disabled Symantec servers on victim networks

---

## MITRE ATT&CK Mapping

### Technique Details

| Field | Value |
|-------|-------|
| **Technique** | T1562.001 |
| **Name** | Impair Defenses: Disable or Modify Tools |
| **Tactic** | Defense Evasion (TA0005) |
| **Platform** | Windows |
| **Permissions Required** | Administrator |

### Applicable Mitigations

| Mitigation ID | Name | Description |
|---------------|------|-------------|
| [M1047](https://attack.mitre.org/mitigations/M1047/) | Audit | Periodically verify that EDR tools are functioning and checking in to central console |
| [M1038](https://attack.mitre.org/mitigations/M1038/) | Execution Prevention | Use application controls to restrict execution of unauthorized tools |
| [M1022](https://attack.mitre.org/mitigations/M1022/) | Restrict File and Directory Permissions | Ensure proper permissions prevent disabling security services |
| [M1024](https://attack.mitre.org/mitigations/M1024/) | Restrict Registry Permissions | Implement registry protections for security service keys |
| [M1018](https://attack.mitre.org/mitigations/M1018/) | User Account Management | Maintain proper user permissions to prevent security service disruption |

---

## Detection Rules

### KQL Queries (Microsoft Sentinel/Defender)

See `bcba14e7-6f87-4cbd-9c32-718fdeb39b65_detections.kql` for complete queries.

**Query Summary:**

| Query Name | Confidence | Description |
|------------|------------|-------------|
| EDRSilencer Binary Execution | High | Detects EDRSilencer.exe process creation |
| WFP Filter API Calls | Medium | Detects FwpmFilterAdd0 API usage |
| EDR Process Network Blocking | High | Detects blocking of security process communications |
| F0 Directory Tool Staging | Medium | Detects executable files in c:\F0 |
| Security Process Communication Anomalies | High | Detects EDR telemetry gaps |
| Behavioral Correlation | Critical | Multi-indicator attack chain detection |

### LimaCharlie D&R Rules

See `bcba14e7-6f87-4cbd-9c32-718fdeb39b65_dr_rules.yaml` for complete rules.

**Rule Summary:**

| Rule Name | Event Type | Description |
|-----------|------------|-------------|
| edrsilencer-binary-execution | NEW_PROCESS | Detects EDRSilencer.exe execution |
| edrsilencer-blockedr-command | NEW_PROCESS | Detects blockedr command parameter |
| wfp-filter-manipulation | NEW_PROCESS | Detects WFP-related API abuse |
| f0-directory-file-staging | FILE_CREATE | Detects executable staging in c:\F0 |
| security-tool-communication-block | NEW_TCP4_CONNECTION | Detects blocked EDR communications |

### YARA Rules

See `bcba14e7-6f87-4cbd-9c32-718fdeb39b65_rules.yar` for complete rules.

**Rule Summary:**

| Rule Name | Confidence | Target |
|-----------|------------|--------|
| EDRSilencer_Binary | High | EDRSilencer executable |
| EDRSilencer_Strings | Medium | Files containing EDRSilencer patterns |
| WFP_Filter_Manipulation | Medium | Tools using WFP filtering APIs |

---

## Hardening Guidance

### Quick Wins (Immediate Implementation)

The following hardening measures can be implemented immediately via PowerShell:

1. **Enable Windows Firewall Auditing** - Detect WFP filter modifications
2. **Enable Process Creation Auditing** - Track process execution
3. **Configure ASR Rules** - Block execution from untrusted locations
4. **Enable Tamper Protection** - Prevent EDR modifications
5. **Restrict WFP Access** - Limit WFP API access to authorized processes

See `bcba14e7-6f87-4cbd-9c32-718fdeb39b65_hardening.ps1` for implementation scripts.

### Complex Hardening (Requires Planning)

#### Hardening: Application Control (WDAC/AppLocker)

**MITRE Mitigation:** [M1038](https://attack.mitre.org/mitigations/M1038/) - Execution Prevention

| Setting | Value |
|---------|-------|
| **Location** | Group Policy / Local Policy |
| **Recommended Value** | Block unsigned executables |
| **Default Value** | Not configured |
| **Impact Level** | High |

**Group Policy Path:**
```
Computer Configuration > Administrative Templates > Windows Components > Windows Defender Application Control
```

**Implementation Steps:**
1. Create a WDAC policy baseline using Microsoft-recommended templates
2. Test in audit mode on pilot systems
3. Add legitimate applications to allow rules
4. Deploy in enforcement mode

**Considerations:**
- **Potential Impacts:** May block legitimate unsigned applications
- **Compatibility:** Requires Windows 10/11 Enterprise or Windows Server 2016+
- **Testing:** Test extensively in audit mode before enforcement

#### Hardening: EDR Tamper Protection

**MITRE Mitigation:** [M1047](https://attack.mitre.org/mitigations/M1047/) - Audit

| Setting | Value |
|---------|-------|
| **Location** | Security Center / EDR Console |
| **Recommended Value** | Enabled |
| **Default Value** | Varies by solution |
| **Impact Level** | Low |

**Microsoft Defender Implementation:**
```powershell
# Enable Tamper Protection via PowerShell (requires cloud connectivity)
Set-MpPreference -DisableTamperProtection $false

# Verify status
Get-MpPreference | Select-Object DisableTamperProtection
```

**Registry Equivalent:**
```
Path: HKLM\SOFTWARE\Microsoft\Windows Defender\Features
Name: TamperProtection
Type: REG_DWORD
Value: 5 (Enabled)
```

#### Hardening: Network-Level Protection

**MITRE Mitigation:** [M1037](https://attack.mitre.org/mitigations/M1037/) - Filter Network Traffic

| Setting | Value |
|---------|-------|
| **Location** | Network Security Appliances |
| **Recommended Value** | Monitor EDR communication endpoints |
| **Default Value** | Not configured |
| **Impact Level** | Medium |

**Implementation:**
1. Identify all EDR cloud endpoints used by your security solution
2. Configure network monitoring to alert on connection failures to these endpoints
3. Implement redundant communication paths where possible
4. Configure alerts for sustained connectivity loss

#### Hardening: Privileged Access Management

**MITRE Mitigation:** [M1018](https://attack.mitre.org/mitigations/M1018/) - User Account Management

| Setting | Value |
|---------|-------|
| **Location** | Active Directory / Local Policy |
| **Recommended Value** | Limit local admin accounts |
| **Default Value** | Varies |
| **Impact Level** | Medium |

**Implementation:**
1. Implement Local Administrator Password Solution (LAPS)
2. Remove users from local Administrators group
3. Use Privileged Access Workstations (PAWs) for administrative tasks
4. Implement Just-in-Time (JIT) admin access

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | bcba14e7-6f87-4cbd-9c32-718fdeb39b65 |
| **Test Name** | EDRSilencer Detection |
| **MITRE ATT&CK** | [T1562.001](https://attack.mitre.org/techniques/T1562/001/) |
| **Severity** | High |
| **Estimated Response Time** | 30-60 minutes |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| EDRSilencer Binary Execution | Process name = "EDRSilencer.exe" | High | P1 |
| WFP Filter Manipulation | Process using fwpuclnt.dll with blockedr parameter | High | P1 |
| EDR Communication Failure | EDR process cannot reach cloud endpoints | Medium | P2 |
| F0 Directory Tool Staging | Executable created in c:\F0 | Medium | P2 |
| Security Process Network Block | Blocked connections from EDR processes | High | P1 |

#### Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What is the scope - single host or multiple endpoints affected?
3. What user account is associated with the activity?
4. Are there concurrent security alerts or telemetry gaps?
5. When did EDR last successfully communicate with cloud backend?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Verify EDR connectivity status**
  ```powershell
  # Check Windows Defender connectivity
  Get-MpComputerStatus | Select-Object NISSignatureLastUpdated, AntivirusSignatureLastUpdated, RealTimeProtectionEnabled

  # Test EDR cloud connectivity (adjust URL for your EDR)
  Test-NetConnection -ComputerName "winatp-gw-eus.microsoft.com" -Port 443
  ```

- [ ] **Remove WFP filters immediately**
  ```powershell
  # List current WFP filters (requires admin)
  netsh wfp show filters

  # If EDRSilencer is present, run cleanup
  # WARNING: Only execute if you have confirmed EDRSilencer presence
  # .\EDRSilencer.exe unblockall

  # Alternative: Reset WFP to defaults (CAUTION - affects all filters)
  netsh wfp set options netevents = on
  ```

- [ ] **Isolate affected host(s)**
  ```powershell
  # Network isolation via Windows Firewall (preserve WFP logs first)
  netsh advfirewall export "C:\IR\firewall_backup.wfw"
  netsh advfirewall set allprofiles state on
  netsh advfirewall firewall add rule name="IR_Block_All_Outbound" dir=out action=block
  netsh advfirewall firewall add rule name="IR_Allow_IR_Server" dir=out action=allow remoteip=<IR-SERVER-IP>
  ```

- [ ] **Terminate malicious processes**
  ```powershell
  # Kill EDRSilencer process
  Stop-Process -Name "EDRSilencer" -Force -ErrorAction SilentlyContinue

  # Kill any process running from c:\F0
  Get-Process | Where-Object { $_.Path -like "c:\F0\*" } | Stop-Process -Force
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create IR directory
  New-Item -ItemType Directory -Path "C:\IR" -Force

  # Capture running processes
  Get-Process | Export-Csv "C:\IR\processes_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

  # Capture network connections
  Get-NetTCPConnection | Export-Csv "C:\IR\connections_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"

  # Capture WFP filter state
  netsh wfp show filters file="C:\IR\wfp_filters_$(Get-Date -Format 'yyyyMMdd_HHmmss').xml"

  # Capture WFP state
  netsh wfp show state file="C:\IR\wfp_state_$(Get-Date -Format 'yyyyMMdd_HHmmss').xml"
  ```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| EDRSilencer binary | `c:\F0\EDRSilencer.exe` | `Copy-Item "c:\F0\*" -Destination "C:\IR\F0_artifacts\" -Recurse` |
| WFP Filter State | Memory/WFP Engine | `netsh wfp show filters file="C:\IR\wfp_filters.xml"` |
| WFP Audit Logs | Event Log | `wevtutil epl "Microsoft-Windows-Windows Firewall With Advanced Security/Firewall" "C:\IR\firewall.evtx"` |
| Security Event Log | Event Log | `wevtutil epl Security "C:\IR\Security.evtx"` |
| Sysmon Logs | Event Log | `wevtutil epl "Microsoft-Windows-Sysmon/Operational" "C:\IR\Sysmon.evtx"` |
| Prefetch | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\EDRSILENCER*" -Destination "C:\IR\Prefetch\"` |
| Test Execution Log | `c:\F0\` | `Copy-Item "c:\F0\*_log.json" -Destination "C:\IR\logs\"` |

#### Memory Acquisition
```powershell
# Using WinPMEM (if available)
.\winpmem_mini_x64.exe C:\IR\memory.raw

# Alternative: Create dump of suspicious process
procdump -ma <PID> C:\IR\
```

#### WFP Filter Analysis
```powershell
# Export WFP filters for analysis
netsh wfp show filters file="C:\IR\wfp_filters_detailed.xml"

# Parse XML for EDRSilencer-created filters (look for security process blocking)
[xml]$filters = Get-Content "C:\IR\wfp_filters_detailed.xml"
$filters.wfpdiag.filters.item | Where-Object { $_.displayData.name -like "*EDR*" -or $_.displayData.name -like "*Silencer*" }
```

#### Timeline Generation
```powershell
# Export relevant event logs for timeline analysis
$logs = @(
    "Security",
    "System",
    "Microsoft-Windows-Sysmon/Operational",
    "Microsoft-Windows-Windows Firewall With Advanced Security/Firewall",
    "Microsoft-Windows-WFP/Operational"
)

foreach ($log in $logs) {
    $safeName = $log -replace "/", "-" -replace " ", "_"
    wevtutil epl $log "C:\IR\$safeName.evtx"
}
```

---

### 4. Eradication

#### WFP Filter Removal
```powershell
# List WFP filters to identify malicious entries
netsh wfp show filters > C:\IR\wfp_filter_list.txt

# Remove specific filter by ID (if known)
# netsh wfp delete filter filterid=<filter-id>

# If EDRSilencer binary is available and safe to execute:
# .\EDRSilencer.exe unblockall

# Nuclear option: Reset Windows Filtering Platform (CAUTION)
# This removes ALL WFP filters - use only as last resort
# netsh wfp set options netevents = off
# netsh wfp set options netevents = on
```

#### File Removal
```powershell
# Remove attack artifacts (AFTER evidence collection)
Remove-Item -Path "c:\F0\EDRSilencer.exe" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "c:\F0\*" -Recurse -Force -ErrorAction SilentlyContinue
```

#### Verify EDR Recovery
```powershell
# Restart EDR services
Restart-Service -Name "WinDefend" -Force
Restart-Service -Name "Sense" -Force  # Microsoft Defender ATP

# Verify EDR connectivity
Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, IoavProtectionEnabled, NISEnabled

# Force signature update to verify cloud connectivity
Update-MpSignature
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] Verify all WFP filters created by EDRSilencer are removed
- [ ] Confirm EDR services are running and communicating with cloud
- [ ] Verify security signatures are current
- [ ] Remove malicious artifacts from c:\F0
- [ ] Re-enable network connectivity (remove IR firewall rules)
- [ ] Document all changes made during response

#### Validation Commands
```powershell
# Verify clean state
Get-ChildItem "c:\F0\" -ErrorAction SilentlyContinue  # Should be empty/not exist

# Verify no malicious WFP filters remain
netsh wfp show filters | Select-String -Pattern "EDR|Silencer|Block"

# Verify EDR is operational
Get-MpComputerStatus | Format-List RealTimeProtectionEnabled, IoavProtectionEnabled, BehaviorMonitorEnabled

# Verify network connectivity
Test-NetConnection -ComputerName "winatp-gw-eus.microsoft.com" -Port 443

# Force EDR check-in
Start-MpScan -ScanType QuickScan
```

#### Remove IR Network Isolation
```powershell
# Remove IR firewall rules
netsh advfirewall firewall delete rule name="IR_Block_All_Outbound"
netsh advfirewall firewall delete rule name="IR_Allow_IR_Server"

# Restore original firewall configuration
netsh advfirewall import "C:\IR\firewall_backup.wfw"
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack detected? (Which rule/alert triggered first?)
2. What was the detection-to-response time?
3. Was EDR connectivity monitored before this incident?
4. What gaps in detection or prevention were identified?
5. Did the attacker have admin privileges? How were they obtained?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Implement WFP filter monitoring | High |
| Detection | Add EDR heartbeat/connectivity monitoring | High |
| Prevention | Enable application whitelisting (WDAC/AppLocker) | High |
| Prevention | Implement EDR tamper protection | High |
| Prevention | Restrict local admin access | Medium |
| Response | Create automated WFP filter cleanup script | Medium |
| Response | Develop EDR recovery runbook | Medium |

#### Detection Gap Analysis

| Gap | Current State | Recommended State |
|-----|---------------|-------------------|
| WFP Filter Auditing | Not enabled | Enable Windows Filtering Platform audit logs |
| EDR Connectivity Monitor | Not monitored | Implement heartbeat monitoring with alerting |
| Tool Staging Detection | Limited | Monitor c:\F0 and temp directories for executables |
| Process Execution Logging | Basic | Enable Sysmon with comprehensive configuration |

---

## References

### MITRE ATT&CK
- [T1562.001 - Impair Defenses: Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/)
- [M1047 - Audit](https://attack.mitre.org/mitigations/M1047/)
- [M1038 - Execution Prevention](https://attack.mitre.org/mitigations/M1038/)
- [M1022 - Restrict File and Directory Permissions](https://attack.mitre.org/mitigations/M1022/)
- [M1024 - Restrict Registry Permissions](https://attack.mitre.org/mitigations/M1024/)
- [M1018 - User Account Management](https://attack.mitre.org/mitigations/M1018/)

### Tool References
- [EDRSilencer - GitHub](https://github.com/netero1010/EDRSilencer)
- [FireBlock - MdSec NightHawk](https://www.mdsec.co.uk/2023/09/nighthawk-0-2-6-three-wise-monkeys/)

### Microsoft Documentation
- [Windows Filtering Platform](https://docs.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-start-page)
- [Microsoft Defender Tamper Protection](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/prevent-changes-to-security-settings-with-tamper-protection)
- [Windows Security Event Logging](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/advanced-security-auditing)

---

## Document Information

| Field | Value |
|-------|-------|
| **Generated** | 2024-12-07 |
| **Generator** | F0RT1KA Defense Guidance Builder |
| **Test ID** | bcba14e7-6f87-4cbd-9c32-718fdeb39b65 |
| **Schema Version** | 2.0 |
