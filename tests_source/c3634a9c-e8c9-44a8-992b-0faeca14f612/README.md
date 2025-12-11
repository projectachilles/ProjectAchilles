# Akira Ransomware BYOVD Attack Chain (Hybrid Testing)

**Test Score**: **8.9/10**

## Overview
This VST simulates the Bring Your Own Vulnerable Driver (BYOVD) attack chain used by Akira ransomware to achieve privilege escalation and disable Windows Defender. The test uses a **hybrid approach**: real vulnerable driver for signature detection testing followed by safe simulated drivers for behavioral detection.

## How

> **Hybrid Safety Model**: Uses real vulnerable driver only for signature detection (3 seconds), then switches to simulated drivers for all behavioral testing to maintain safety while maximizing detection coverage.

Steps:

1. Check for administrator privileges. If not running as admin, exit `NOTRELEVANT`
2. **Phase 1**: Drop real `rwdrv.sys` vulnerable driver for signature detection test
3. **Phase 2**: Remove real driver and use simulated drivers for behavioral testing
4. **Phase 3**: Create Windows services (`mgdsrv` and `KMHLPSVC`) pointing to simulated drivers
5. **Phase 4**: Execute PowerShell script to attempt Windows Defender registry manipulation
6. Monitor defensive responses at each phase and determine protection status
7. Clean up created services, files, and registry modifications (including safety check for real driver)

## Attack Phases

**Phase 1: Signature Detection Test**
- Drops real `rwdrv.sys` vulnerable driver (actual malicious binary)
- Monitors for signature-based quarantine by AV/EDR solutions
- **Early exit on detection**: If quarantined → System is PROTECTED
- **Safety pivot**: If not detected → Remove real driver immediately

**Phase 2: Behavioral Detection Test**
- Drops `rwdrv.sys` (15,360 bytes) - simulated ThrottleStop driver 
- Drops `hlpdrv.sys` (24,576 bytes) - simulated malicious helper driver
- Monitors for behavioral-based quarantine by AV/EDR solutions

**Phase 3: Service Creation** 
- Creates `mgdsrv` service pointing to simulated rwdrv.sys
- Creates `KMHLPSVC` service pointing to simulated hlpdrv.sys
- Tests ability to register kernel-mode services

**Phase 4: Defense Evasion**
- Executes PowerShell script with execution policy bypass
- Attempts to modify Windows Defender registry keys
- Targets `HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\DisableAntiSpyware`
- Attempts tamper protection bypass

Example Output:
```bash
[2024-12-30T10:15:30][c3634a9c-e8c9-44a8-992b-0faeca14f612] Starting Akira Ransomware BYOVD Attack Chain simulation
[2024-12-30T10:15:30][c3634a9c-e8c9-44a8-992b-0faeca14f612] Phase 1: Dropping vulnerable and malicious drivers
[2024-12-30T10:15:30][c3634a9c-e8c9-44a8-992b-0faeca14f612] Created simulated driver: rwdrv.sys (15360 bytes)
[2024-12-30T10:15:30][c3634a9c-e8c9-44a8-992b-0faeca14f612] Created simulated driver: hlpdrv.sys (24576 bytes)
[2024-12-30T10:15:33][c3634a9c-e8c9-44a8-992b-0faeca14f612] Phase 2: Creating malicious services
[2024-12-30T10:15:33][c3634a9c-e8c9-44a8-992b-0faeca14f612] Successfully created service: mgdsrv
[2024-12-30T10:15:33][c3634a9c-e8c9-44a8-992b-0faeca14f612] Successfully created service: KMHLPSVC
[2024-12-30T10:15:33][c3634a9c-e8c9-44a8-992b-0faeca14f612] Phase 3: Attempting Windows Defender registry manipulation
[2024-12-30T10:15:38][c3634a9c-e8c9-44a8-992b-0faeca14f612] PowerShell status: DEFENDER_DISABLED
[2024-12-30T10:15:38][c3634a9c-e8c9-44a8-992b-0faeca14f612] Windows Defender registry manipulation succeeded
[2024-12-30T10:15:38][c3634a9c-e8c9-44a8-992b-0faeca14f612] Completed with code: 101
```

## MITRE ATT&CK Mapping

- **T1068 - Exploitation for Privilege Escalation**: Simulates abuse of vulnerable drivers for privilege escalation
- **T1562.001 - Impair Defenses: Disable or Modify Tools**: Registry manipulation to disable Windows Defender

## Detection Opportunities

**File System**
- Driver files dropped to C:\F0 directory
- PowerShell script creation and execution
- Suspicious file sizes matching known malicious drivers

**Service Operations**
- Creation of services with suspicious names (`mgdsrv`, `KMHLPSVC`)
- Kernel-mode service registration attempts
- Service pointing to non-standard driver locations

**Registry Activity** 
- Modifications to Windows Defender policy keys
- Tamper protection bypass attempts
- DisableAntiSpyware registry value changes

**Process Activity**
- PowerShell execution with ExecutionPolicy bypass
- sc.exe commands for service creation
- Administrator privilege escalation attempts

## Resolution

If this test fails (returns code 101 - Unprotected):

**Immediate Actions:**
- Verify Windows Defender is enabled and properly configured
- Check that Tamper Protection is enabled in Windows Security
- Ensure real-time protection is active

**Advanced Protections:**
- Deploy EDR solution with behavioral detection capabilities
- Implement application control policies to block unsigned drivers
- Enable Windows Defender Application Control (WDAC)
- Configure registry monitoring and alerting

**Network Controls:**
- Monitor for suspicious service creation events (Event ID 7045)
- Alert on registry modifications to security software keys
- Detect PowerShell execution with execution policy bypass

**Verification Steps:**
1. Run Windows Security scan to ensure it's functioning
2. Check Event Viewer for service creation and registry modification events
3. Verify that Windows Defender policies cannot be modified by non-admin users
4. Test that driver loading requires proper signing and authorization