# Defense Guidance: Data Exfiltration and Encryption Simulation

## Executive Summary

This defense guidance document provides comprehensive detection rules, hardening measures, and incident response procedures for the F0RT1KA security test simulating advanced data exfiltration and encryption techniques. The test evaluates EDR/AV capabilities against multi-phase attacks including Azure cloud storage reconnaissance, data staging and exfiltration, process masquerading, and ransomware-like encryption behavior.

**Test Overview:**

| Field | Value |
|-------|-------|
| **Test ID** | 4b4bd24c-fff5-4de8-982e-6d0fa5e22284 |
| **Test Name** | Data Exfiltration and Encryption Simulation |
| **Test Score** | 9.1/10 |
| **Primary Tactics** | Exfiltration, Impact, Discovery, Defense Evasion |
| **Primary Techniques** | T1020, T1041, T1486, T1055, T1083 |

---

## Threat Overview

This test simulates sophisticated attack techniques observed in advanced persistent threat (APT) campaigns and modern ransomware operations that prioritize data exfiltration before encryption. The attack flow represents "double extortion" tactics where data theft precedes encryption, making data exfiltration often more damaging than encryption itself.

### Attack Phases

1. **Azure Storage Reconnaissance (T1083, T1018)**
   - Discovery of Azure Storage Explorer configurations
   - Azure CLI credential enumeration
   - Registry analysis for stored cloud connections
   - Browser credential mining for Azure portal tokens
   - Environment variable scanning for cloud credentials

2. **Data Staging and Exfiltration (T1020, T1041)**
   - High-value data identification (documents, databases, certificates)
   - Data staging operations to temporary directories
   - Archive compression using PowerShell Compress-Archive
   - Simulated cloud upload patterns

3. **Process Masquerading (T1055)**
   - Deployment of encryption binary masquerading as conhost.exe
   - Execution from non-standard location (C:\F0)
   - Behavioral evasion through legitimate process impersonation

4. **Encryption Simulation (T1486)**
   - Test file creation and transformation
   - CPU-intensive operations mimicking encryption
   - Ransom note deployment
   - File extension modification patterns

---

## MITRE ATT&CK Mapping with Mitigations

| Technique | Name | Applicable Mitigations |
|-----------|------|------------------------|
| [T1020](https://attack.mitre.org/techniques/T1020/) | Automated Exfiltration | Network Traffic Analysis, Data Loss Prevention |
| [T1041](https://attack.mitre.org/techniques/T1041/) | Exfiltration Over C2 Channel | M1057 (Data Loss Prevention), M1031 (Network Intrusion Prevention) |
| [T1486](https://attack.mitre.org/techniques/T1486/) | Data Encrypted for Impact | M1053 (Data Backup), M1040 (Behavior Prevention on Endpoint) |
| [T1055](https://attack.mitre.org/techniques/T1055/) | Process Injection | M1040 (Behavior Prevention), M1026 (Privileged Account Management) |
| [T1083](https://attack.mitre.org/techniques/T1083/) | File and Directory Discovery | Audit Policy, Access Control Lists |

### Mitigation Details

**M1057 - Data Loss Prevention**
- Deploy DLP solutions to detect sensitive data being compressed or staged
- Monitor for bulk file access patterns followed by network transmission
- Alert on Compress-Archive usage with suspicious file collections

**M1031 - Network Intrusion Prevention**
- Deploy network-based detection for unusual outbound data volumes
- Monitor encrypted traffic to cloud storage endpoints
- Implement egress filtering for untrusted cloud destinations

**M1040 - Behavior Prevention on Endpoint**
- Enable Attack Surface Reduction (ASR) rules on Windows 10/11
- Block untrusted executables in user-writable directories
- Detect ransomware-like file operation patterns

**M1053 - Data Backup**
- Implement 3-2-1 backup strategy (3 copies, 2 media types, 1 offsite)
- Enable Volume Shadow Copy protection
- Test backup restoration procedures regularly

**M1026 - Privileged Account Management**
- Restrict access to Azure CLI and cloud credential files
- Implement least privilege for cloud storage access
- Monitor privileged account activity for credential harvesting

---

## Detection Rules Summary

This guidance includes the following detection artifacts:

| File | Format | Purpose |
|------|--------|---------|
| `4b4bd24c-fff5-4de8-982e-6d0fa5e22284_detections.kql` | KQL | Microsoft Sentinel/Defender detection queries |
| `4b4bd24c-fff5-4de8-982e-6d0fa5e22284_dr_rules.yaml` | YAML | LimaCharlie D&R rules |
| `4b4bd24c-fff5-4de8-982e-6d0fa5e22284_rules.yar` | YARA | File and memory pattern detection |
| `4b4bd24c-fff5-4de8-982e-6d0fa5e22284_hardening.ps1` | PowerShell | Automated hardening script |

---

## KQL Detection Queries

See `4b4bd24c-fff5-4de8-982e-6d0fa5e22284_detections.kql` for complete queries including:

1. **Azure Storage Explorer Reconnaissance Detection** - Detects PowerShell accessing Azure configuration directories
2. **Azure CLI Credential File Access** - Monitors access to sensitive Azure CLI files
3. **Data Staging and Compression Detection** - Identifies Compress-Archive with high-value file types
4. **High-Volume File Enumeration** - Detects mass file discovery operations
5. **Process Masquerading - conhost.exe from Unusual Location** - Identifies conhost.exe running from non-standard paths
6. **Ransom Note Creation Detection** - Monitors for common ransom note file names
7. **Encryption Behavioral Indicators** - Detects file extension changes and high-frequency writes
8. **Multi-Phase Exfiltration Correlation** - Correlates reconnaissance, staging, and exfiltration activities

---

## LimaCharlie D&R Rules

See `4b4bd24c-fff5-4de8-982e-6d0fa5e22284_dr_rules.yaml` for deployment-ready rules including:

1. **f0rtika-azure-recon** - Azure Storage configuration access detection
2. **f0rtika-data-staging** - Data staging directory creation and compression
3. **f0rtika-process-masquerade** - System process execution from unusual locations
4. **f0rtika-encryption-behavior** - File encryption pattern detection
5. **f0rtika-ransom-note** - Ransom note file creation detection

---

## YARA Rules

See `4b4bd24c-fff5-4de8-982e-6d0fa5e22284_rules.yar` for file and memory detection rules including:

1. **F0RTIKA_AzureReconScript** - PowerShell Azure reconnaissance patterns
2. **F0RTIKA_DataExfiltrationScript** - Data staging and exfiltration indicators
3. **F0RTIKA_MasqueradedEncryptor** - Masqueraded binary detection
4. **F0RTIKA_RansomNote** - Ransom note content patterns
5. **F0RTIKA_EncryptedFileMarker** - Encrypted file indicators

---

## Hardening Guidance

### Quick Wins (Automated via PowerShell)

See `4b4bd24c-fff5-4de8-982e-6d0fa5e22284_hardening.ps1` for automated implementation:

1. **Enable Attack Surface Reduction Rules** - Block ransomware-like behavior
2. **Restrict PowerShell Execution** - Constrained Language Mode for non-admin users
3. **Block Execution from F0 Directory** - Software Restriction Policy
4. **Enable Controlled Folder Access** - Protect against unauthorized file access
5. **Audit Cloud Configuration Access** - Enable file system auditing

### Complex Hardening (Manual Implementation Required)

#### Azure Credential Protection

**MITRE Mitigation:** [M1026](https://attack.mitre.org/mitigations/M1026/) - Privileged Account Management

| Setting | Value |
|---------|-------|
| **Location** | Azure CLI credential directories |
| **Recommended Action** | Restrict access to `%USERPROFILE%\.azure` |
| **Impact Level** | Medium |

**Group Policy Path:**
```
Not available via GPO - Use NTFS permissions
```

**Implementation:**
```powershell
# Restrict access to Azure CLI directory
$azurePath = "$env:USERPROFILE\.azure"
if (Test-Path $azurePath) {
    $acl = Get-Acl $azurePath
    $acl.SetAccessRuleProtection($true, $false)
    # Allow only current user
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $env:USERNAME, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"
    )
    $acl.AddAccessRule($rule)
    Set-Acl -Path $azurePath -AclObject $acl
}
```

#### Cloud Storage Egress Monitoring

**MITRE Mitigation:** [M1031](https://attack.mitre.org/mitigations/M1031/) - Network Intrusion Prevention

| Setting | Value |
|---------|-------|
| **Location** | Network firewall/proxy |
| **Recommended Action** | Monitor uploads to cloud storage domains |
| **Impact Level** | Low |

**Domains to Monitor:**
- `*.blob.core.windows.net` (Azure Blob Storage)
- `*.s3.amazonaws.com` (AWS S3)
- `*.storage.googleapis.com` (Google Cloud Storage)
- `api.dropboxapi.com` (Dropbox)
- `graph.microsoft.com/v1.0/me/drive` (OneDrive)

#### Volume Shadow Copy Protection

**MITRE Mitigation:** [M1053](https://attack.mitre.org/mitigations/M1053/) - Data Backup

| Setting | Value |
|---------|-------|
| **Location** | Windows Volume Shadow Copy Service |
| **Recommended Action** | Protect VSS from unauthorized deletion |
| **Impact Level** | Low |

**Implementation:**
```powershell
# Enable VSS writer protection
vssadmin list shadows
# Create scheduled VSS snapshots
wmic shadowcopy call create Volume=C:\
```

---

## Incident Response Playbook

### Quick Reference

| Field | Value |
|-------|-------|
| **Test ID** | 4b4bd24c-fff5-4de8-982e-6d0fa5e22284 |
| **Test Name** | Data Exfiltration and Encryption Simulation |
| **MITRE ATT&CK** | [T1020](https://attack.mitre.org/techniques/T1020/), [T1041](https://attack.mitre.org/techniques/T1041/), [T1486](https://attack.mitre.org/techniques/T1486/), [T1055](https://attack.mitre.org/techniques/T1055/), [T1083](https://attack.mitre.org/techniques/T1083/) |
| **Severity** | Critical |
| **Estimated Response Time** | 30-60 minutes |

---

### 1. Detection Triggers

#### Alert Conditions

| Detection Name | Trigger Criteria | Confidence | Priority |
|----------------|------------------|------------|----------|
| Azure Storage Reconnaissance | PowerShell accessing Azure config paths | High | P2 |
| Azure CLI Credential Access | File read of accessTokens.json or azureProfile.json | High | P1 |
| Data Staging Detection | Compress-Archive with high-value extensions | High | P1 |
| Process Masquerading | conhost.exe from C:\F0 | High | P1 |
| Ransom Note Creation | DECRYPT_INSTRUCTIONS.txt creation | Critical | P1 |
| Encryption Behavior | High-frequency .encrypted file creation | Critical | P1 |

#### Initial Triage Questions

1. Is this a known F0RT1KA test execution or unexpected activity?
2. What user account is associated with the activity?
3. What cloud services/credentials may have been accessed?
4. Is there evidence of actual data exfiltration (network logs)?
5. What is the scope - single host or multiple?

---

### 2. Containment

#### Immediate Actions (First 15 minutes)

- [ ] **Isolate affected host(s)**
  ```powershell
  # Network isolation via Windows Firewall
  netsh advfirewall set allprofiles state on
  netsh advfirewall firewall add rule name="IR-Block-Outbound" dir=out action=block enable=yes
  netsh advfirewall firewall add rule name="IR-Block-Inbound" dir=in action=block enable=yes
  # Allow only specific IR workstation
  netsh advfirewall firewall add rule name="IR-Allow-IR-Station" dir=in action=allow remoteip=<IR_WORKSTATION_IP>
  ```

- [ ] **Terminate malicious processes**
  ```powershell
  # Kill suspicious PowerShell processes
  Get-Process -Name powershell, pwsh | Where-Object {
      $_.CommandLine -like "*azure*" -or $_.CommandLine -like "*exfiltration*"
  } | Stop-Process -Force

  # Kill masqueraded conhost from F0 directory
  Get-Process -Name conhost | Where-Object {
      $_.Path -like "*F0*"
  } | Stop-Process -Force
  ```

- [ ] **Preserve volatile evidence**
  ```powershell
  # Create IR evidence directory
  $irDir = "C:\IR_Evidence_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  New-Item -ItemType Directory -Path $irDir -Force

  # Capture running processes
  Get-Process | Select-Object Id, ProcessName, Path, CommandLine, StartTime |
      Export-Csv "$irDir\processes.csv" -NoTypeInformation

  # Capture network connections
  Get-NetTCPConnection | Export-Csv "$irDir\tcp_connections.csv" -NoTypeInformation
  Get-NetUDPEndpoint | Export-Csv "$irDir\udp_endpoints.csv" -NoTypeInformation

  # Capture PowerShell history
  Copy-Item "$env:APPDATA\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt" `
      -Destination "$irDir\ps_history.txt" -ErrorAction SilentlyContinue
  ```

- [ ] **Revoke cloud credentials**
  ```powershell
  # Azure CLI logout
  az logout --username all 2>$null

  # Document Azure credential files before removal
  $azureDir = "$env:USERPROFILE\.azure"
  if (Test-Path $azureDir) {
      Copy-Item -Path $azureDir -Destination "$irDir\azure_creds_backup" -Recurse
  }
  ```

---

### 3. Evidence Collection

#### Critical Artifacts

| Artifact | Location | Collection Command |
|----------|----------|-------------------|
| Test execution logs | `C:\F0\*_log.json` | `Copy-Item "C:\F0\*" -Destination "$irDir\F0_artifacts\" -Recurse` |
| Azure reconnaissance data | `C:\F0\azure_storage_info.json` | `Copy-Item "C:\F0\azure_storage_info.json" -Destination "$irDir\"` |
| Staged data archive | `C:\F0\staged_data.zip` | `Copy-Item "C:\F0\staged_data.zip" -Destination "$irDir\"` |
| Exfiltration status | `C:\F0\exfiltration_status.txt` | `Copy-Item "C:\F0\exfiltration_status.txt" -Destination "$irDir\"` |
| PowerShell scripts | `C:\F0\*.ps1` | `Copy-Item "C:\F0\*.ps1" -Destination "$irDir\"` |
| Masqueraded binary | `C:\F0\conhost.exe` | `Copy-Item "C:\F0\conhost.exe" -Destination "$irDir\"` |
| Event logs | System | See below |
| Prefetch files | `C:\Windows\Prefetch\` | `Copy-Item "C:\Windows\Prefetch\*CONHOST*" -Destination "$irDir\Prefetch\"` |

#### Event Log Collection
```powershell
# Export relevant event logs
$logs = @("Security", "System", "Microsoft-Windows-Sysmon/Operational",
          "Microsoft-Windows-PowerShell/Operational", "Windows PowerShell")

foreach ($log in $logs) {
    $safeName = $log -replace '[/\\]', '_'
    wevtutil epl $log "$irDir\$safeName.evtx" 2>$null
}
```

#### Timeline Generation
```powershell
# Create timeline of recent file activity in F0 directory
Get-ChildItem "C:\F0" -Recurse |
    Select-Object FullName, CreationTime, LastWriteTime, LastAccessTime, Length |
    Sort-Object LastWriteTime |
    Export-Csv "$irDir\f0_timeline.csv" -NoTypeInformation

# Recent PowerShell execution events
Get-WinEvent -LogName "Microsoft-Windows-PowerShell/Operational" -MaxEvents 500 |
    Where-Object { $_.TimeCreated -gt (Get-Date).AddHours(-24) } |
    Export-Csv "$irDir\ps_events.csv" -NoTypeInformation
```

---

### 4. Eradication

#### File Removal
```powershell
# AFTER evidence collection - Remove attack artifacts
$artifactsToRemove = @(
    "C:\F0\azure_reconnaissance.ps1",
    "C:\F0\data_exfiltration.ps1",
    "C:\F0\conhost.exe",
    "C:\F0\exfiltration_status.txt",
    "C:\F0\azure_storage_info.json",
    "C:\F0\staged_data.zip",
    "C:\F0\staging"
)

foreach ($artifact in $artifactsToRemove) {
    if (Test-Path $artifact) {
        Remove-Item -Path $artifact -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Removed: $artifact"
    }
}

# Remove test-created encrypted files
Get-ChildItem "C:\F0" -Recurse -Filter "*.encrypted" | Remove-Item -Force
Get-ChildItem "C:\F0" -Recurse -Filter "DECRYPT_INSTRUCTIONS.txt" | Remove-Item -Force
```

#### Scheduled Task Cleanup
```powershell
# Check for persistence via scheduled tasks
Get-ScheduledTask | Where-Object {
    $_.Actions.Execute -like "*F0*" -or $_.Actions.Arguments -like "*exfiltration*"
} | Unregister-ScheduledTask -Confirm:$false
```

#### Registry Cleanup
```powershell
# Remove any registry persistence (if applicable)
$regPaths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
)

foreach ($path in $regPaths) {
    Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
        ForEach-Object {
            $_.PSObject.Properties | Where-Object { $_.Value -like "*F0*" } |
                ForEach-Object { Remove-ItemProperty -Path $path -Name $_.Name -ErrorAction SilentlyContinue }
        }
}
```

---

### 5. Recovery

#### System Restoration Checklist

- [ ] Verify all malicious artifacts removed
- [ ] Confirm no persistence mechanisms remain
- [ ] Rotate Azure/cloud credentials
- [ ] Re-enable security controls
- [ ] Reconnect to network (after validation)
- [ ] Verify backup integrity

#### Validation Commands
```powershell
# Verify F0 directory is clean
Get-ChildItem "C:\F0\" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "(azure|exfiltration|conhost|staging|encrypted)" }

# Verify no suspicious scheduled tasks
Get-ScheduledTask | Where-Object { $_.Actions.Execute -like "*powershell*" } |
    Select-Object TaskName, State, Actions

# Verify no suspicious services
Get-Service | Where-Object { $_.PathName -like "*F0*" }

# Verify network connectivity restored
Test-NetConnection -ComputerName "login.microsoftonline.com" -Port 443
```

#### Credential Rotation
```powershell
# Force Azure CLI re-authentication
az login

# Verify Azure account security
az account show
az ad signed-in-user show

# Consider rotating:
# - Azure Storage Account keys
# - Service Principal secrets
# - Managed Identity credentials
```

---

### 6. Post-Incident

#### Lessons Learned Questions

1. How was the attack initially detected? (Which rule/alert?)
2. What was the detection-to-response time?
3. Were all attack phases detected independently?
4. What prevented earlier detection of the reconnaissance phase?
5. Were cloud credentials actually exposed?
6. What would have prevented this attack?
7. What detection gaps were identified?

#### Recommended Improvements

| Area | Recommendation | Priority |
|------|----------------|----------|
| Detection | Enable Azure CLI access auditing | High |
| Detection | Deploy YARA rules for reconnaissance scripts | High |
| Detection | Add KQL queries to Sentinel | High |
| Prevention | Enable Controlled Folder Access | High |
| Prevention | Restrict PowerShell to Constrained Language Mode | Medium |
| Prevention | Block execution from C:\F0 via AppLocker | High |
| Response | Create automated containment runbook | Medium |
| Response | Pre-stage IR tooling on endpoints | Low |

---

## References

- [MITRE ATT&CK T1020 - Automated Exfiltration](https://attack.mitre.org/techniques/T1020/)
- [MITRE ATT&CK T1041 - Exfiltration Over C2 Channel](https://attack.mitre.org/techniques/T1041/)
- [MITRE ATT&CK T1486 - Data Encrypted for Impact](https://attack.mitre.org/techniques/T1486/)
- [MITRE ATT&CK T1055 - Process Injection](https://attack.mitre.org/techniques/T1055/)
- [MITRE ATT&CK T1083 - File and Directory Discovery](https://attack.mitre.org/techniques/T1083/)
- [Microsoft Attack Surface Reduction Rules](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/attack-surface-reduction-rules-reference)
- [Windows Defender Controlled Folder Access](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/controlled-folders)
- [Azure CLI Security Best Practices](https://docs.microsoft.com/en-us/cli/azure/azure-cli-security-guidance)

---

*Generated by F0RT1KA Defense Guidance Builder*
*Test ID: 4b4bd24c-fff5-4de8-982e-6d0fa5e22284*
