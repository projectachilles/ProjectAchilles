# Gunra Ransomware Simulation

**Test Score**: **8.2/10**

This VST simulates the behavior of Gunra Ransomware, a recently observed ransomware strain that employs advanced encryption methods and double-extortion tactics. The test replicates key malicious behaviors observed in Gunra ransomware attacks to validate endpoint detection and response (EDR) capabilities against ransomware threats.

## Overview

Gunra Ransomware is a sophisticated threat that targets Windows systems globally across various industries including real estate, pharmaceuticals, and manufacturing. It employs a double-extortion technique by encrypting victim files and threatening to leak stolen data on Tor-hosted extortion sites. The ransomware is notable for its five-day deadline strategy, creating urgency and panic among victims.

## MITRE ATT&CK Techniques

This test covers multiple MITRE ATT&CK techniques:

- **T1486** - Data Encrypted for Impact: Encrypts files with .ENCRT extension
- **T1490** - Inhibit System Recovery: Deletes shadow copies via Windows Management Instrumentation (WMI)
- **T1082** - System Information Discovery: Gathers hostname, username, and OS information
- **T1083** - File and Directory Discovery: Enumerates files for encryption
- **T1622** - Debugger Evasion: Simulates anti-debugging checks (IsDebuggerPresent)

## How It Works

> **Safety**: This test simulates ransomware behavior in a controlled manner. It creates test files in `c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d`, simulates encryption by renaming them with .ENCRT extension, and drops a ransom note. No actual encryption algorithms are used. **Note**: The test does NOT include automatic cleanup - use the provided PowerShell script `Cleanup-GunraTest.ps1` to remove test artifacts after execution.

### Test Steps:

1. **Anti-Debugging Check**: Simulates the IsDebuggerPresent API call used by Gunra to detect analysis environments
2. **System Information Discovery**: Gathers system hostname, current user, and OS information (T1082)
3. **Test Environment Setup**: Creates a test directory at `c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d` with sample files
4. **Shadow Copy Deletion Simulation**: Checks access to Volume Shadow Copy service without actually deleting (T1490) - SAFE MODE
5. **File Enumeration**: Scans the test directory for files to encrypt (T1083)
6. **File Encryption Simulation**: Renames files with .ENCRT extension and marks them as encrypted (T1486)
7. **Ransom Note Deployment**: Drops "R3ADM3.txt" ransom note in the test directory (T1486)
8. **Verification**: Confirms that encrypted files and ransom note exist
9. If all steps succeed without intervention, exit `UNPROTECTED` (101)
10. If security solution blocks any critical step, exit `PROTECTED` (126)

### Example Output:

```bash
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Starting test at: 2024-10-13T10:35:00
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Starting Gunra Ransomware simulation test
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Performing anti-debugging check
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Gathering system information
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] System hostname: DESKTOP-TEST01
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Current user: testuser
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Operating system: Windows_NT
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Setting up test environment in c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Created test file: document1.docx
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Created test file: spreadsheet1.xlsx
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Created test file: presentation1.pptx
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Created test file: image1.jpg
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Created test file: data.pdf
[2024-10-13T10:35:00][94b248c0-a104-48c3-b4a5-3d45028c407d] Simulating shadow copy deletion via WMI (SAFE MODE - not actually deleting)
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Shadow copy service is accessible
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Real Gunra malware would execute: vssadmin delete shadows /all /quiet
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] TEST MODE: Shadow copies preserved for safety - simulating successful deletion
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Enumerating files in test directory
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Found 5 files to process
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Simulating file encryption with .ENCRT extension
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Encrypted file: document1.docx -> document1.docx.ENCRT
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Encrypted file: spreadsheet1.xlsx -> spreadsheet1.xlsx.ENCRT
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Encrypted file: presentation1.pptx -> presentation1.pptx.ENCRT
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Encrypted file: image1.jpg -> image1.jpg.ENCRT
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Encrypted file: data.pdf -> data.pdf.ENCRT
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Dropping ransom note: R3ADM3.txt
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Ransom note dropped successfully
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Verifying encryption simulation
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Found 5 encrypted files and ransom note exists: true
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Gunra ransomware simulation completed successfully
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] System is UNPROTECTED - ransomware behavior was not blocked
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Completed with code: 101
[2024-10-13T10:35:01][94b248c0-a104-48c3-b4a5-3d45028c407d] Ending test at: 2024-10-13T10:35:01
```

## Cleanup

**Important**: This test does NOT automatically clean up test artifacts. After running the test, use the provided PowerShell script to remove all test files:

```powershell
# Run cleanup with confirmation prompts
.\Cleanup-GunraTest.ps1

# Run cleanup without prompts (force mode)
.\Cleanup-GunraTest.ps1 -Force
```

The cleanup script will:
- Remove the test directory `c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d`
- Delete all encrypted files (.ENCRT)
- Remove the ransom note (R3ADM3.txt)
- Provide detailed logging of cleanup operations

**Note**: The cleanup script requires Administrator privileges for best results.

```

## Real-World Gunra Ransomware Characteristics

Based on threat intelligence analysis, the actual Gunra ransomware exhibits the following behaviors:

### Capabilities:
- **Anti-debugging & Anti-reversing**: Uses `IsDebuggerPresent` Windows API to detect debuggers (x64dbg, WinDbg, OllyDbg)
- **Process Manipulation**: Uses `GetCurrentProcess` and `TerminateProcess` for privilege escalation and anti-analysis
- **Data Discovery**: Uses `FindNextFileExW` to enumerate files with specific extensions (.docx, .pdf, .xls, .jpg, etc.)
- **File Encryption**: Encrypts files and appends .ENCRT extension
- **Shadow Copy Deletion**: Removes Volume Shadow Copies via WMI to prevent recovery

### Attack Chain:
1. Creates process named 'gunraransome.exe' in Task Manager
2. Deletes available shadow copies using WMI
3. Encrypts victim files with .ENCRT extension
4. Drops ransom note "R3ADM3.txt" in every encrypted directory
5. Provides 5-day deadline to contact attackers via Tor .onion site
6. Threatens to publish stolen data on underground forums if ransom not paid

### Targeted Industries:
- Real Estate
- Pharmaceuticals
- Manufacturing
- Various sectors globally (Japan, Egypt, Panama, Italy, Argentina)

## Resolution

If this test returns **UNPROTECTED (101)**:

### Immediate Actions:
1. **Enable Ransomware Protection**: Ensure Windows Defender Ransomware Protection (Controlled Folder Access) is enabled
2. **Update EDR Policies**: Configure your EDR solution to detect and block:
   - Shadow copy deletion attempts
   - Mass file encryption behaviors
   - Suspicious file extension changes
   - Ransom note creation patterns

### Detection Opportunities:
- **Shadow Copy Deletion**: Monitor for `vssadmin delete shadows` commands
- **File System Changes**: Alert on rapid file modifications with extension changes
- **Process Behavior**: Detect processes enumerating large numbers of files
- **Ransom Note Creation**: Flag creation of known ransom note filenames (R3ADM3.txt)

### Prevention Strategies:
1. **Backup Strategy**: Implement robust, offline backup solutions
2. **Network Segmentation**: Limit lateral movement capabilities
3. **Privilege Management**: Restrict administrative access
4. **Email Security**: Strengthen phishing defenses (common initial access vector)
5. **Patch Management**: Keep systems updated to prevent exploitation
6. **Application Whitelisting**: Prevent unauthorized executable execution

### Microsoft Defender Configuration:
```powershell
# Enable Controlled Folder Access (Ransomware Protection)
Set-MpPreference -EnableControlledFolderAccess Enabled

# Enable Cloud-delivered Protection
Set-MpPreference -MAPSReporting Advanced

# Enable Automatic Sample Submission
Set-MpPreference -SubmitSamplesConsent SendAllSamples

# Enable Behavior Monitoring
Set-MpPreference -DisableBehaviorMonitoring $false

# Enable Real-time Protection
Set-MpPreference -DisableRealtimeMonitoring $false
```

## Test Result Codes

- **101 (UNPROTECTED)**: Ransomware simulation completed successfully - system is vulnerable
- **126 (PROTECTED)**: Security solution blocked one or more ransomware behaviors
- **105 (FILE_QUARANTINED)**: Test binary was quarantined before execution

## Additional Information

### Intelligence Source:
This test is based on analysis from CYFIRMA's threat intelligence report on Gunra Ransomware, which identified the threat's emergence and documented its tactics, techniques, and procedures (TTPs).

### Test Safety:
- No actual encryption algorithms are used
- All operations are confined to `c:\F0\94b248c0-a104-48c3-b4a5-3d45028c407d` directory
- Test files are created specifically for the test
- Complete cleanup is performed after test execution
- Ransom note clearly indicates this is a security test

### Limitations:
- Does not simulate network communication to C2 servers
- Does not perform actual data exfiltration
- Does not implement real encryption algorithms
- Does not attempt lateral movement

## References

- CYFIRMA Research: Gunra Ransomware – A Brief Analysis
- MITRE ATT&CK T1486: Data Encrypted for Impact
- MITRE ATT&CK T1490: Inhibit System Recovery
- MITRE ATT&CK T1082: System Information Discovery
- MITRE ATT&CK T1083: File and Directory Discovery
- MITRE ATT&CK T1622: Debugger Evasion

---

**⚠️ WARNING**: This test simulates real ransomware behavior. Only run in authorized, isolated test environments with proper security monitoring in place.
