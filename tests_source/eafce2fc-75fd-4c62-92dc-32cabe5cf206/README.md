# Tailscale Remote Access and Data Exfiltration

## Overview
This test simulates a sophisticated attack chain using Tailscale for remote access establishment and data exfiltration. It evaluates endpoint protection capabilities against the use of legitimate remote access tools for malicious purposes, combined with SSH-based command execution and C2 data exfiltration.

**Test Score**: **8.5/10** - Advanced multi-stage killchain with real-world remote access techniques and comprehensive safety mechanisms

**Score Breakdown**:
- **Real-World Accuracy: 2.5/3.0** - Uses actual Tailscale software, real OpenSSH installation, authentic network protocols
- **Technical Sophistication: 2.5/3.0** - Multi-stage architecture, service installation, network tunneling, data compression/exfiltration
- **Safety Mechanisms: 2.0/2.0** - Fully unattended cleanup utility, automatic state restoration, remote execution compatible
- **Detection Opportunities: 1.0/1.0** - 5 distinct stages with clear EDR validation points
- **Logging & Observability: 0.5/1.0** - Multi-stage logger with technique-level tracking

**Key Strengths**:
- Uses actual Tailscale software (not simulation)
- Real Windows service installation (OpenSSH)
- Multi-stage architecture for precision detection
- Configurable binary acquisition (download vs embedded)
- Fully automated cleanup utility (unattended execution, remote-compatible)
- Automatic system state restoration (OpenSSH, Windows services, firewall)
- 5 distinct ATT&CK techniques tested individually

## MITRE ATT&CK Mapping

**Multi-Stage Killchain:**
- **Stage 1 - T1105**: Ingress Tool Transfer (Tailscale download)
- **Stage 2 - T1543.003**: Create or Modify System Process: Windows Service (OpenSSH manual installation)
- **Stage 3 - T1219**: Remote Access Software (Tailscale connection)
- **Stage 4 - T1021.004**: Remote Services: SSH
- **Stage 5 - T1041**: Exfiltration Over C2 Channel

**Additional Techniques:**
- **T1071.001**: Application Layer Protocol: Web Protocols (Tailscale communication)
- **T1560.001**: Archive Collected Data: Archive via Utility (data compression)
- **T1048**: Exfiltration Over Alternative Protocol

## Test Execution

This test uses **multi-stage architecture** where each ATT&CK technique is implemented as a separate signed binary. This provides technique-level detection precision - if EDR blocks Stage 3 (T1219), you know exactly which technique triggered protection.

### Configuration (Before Building)

**REQUIRED:** Edit `eafce2fc-75fd-4c62-92dc-32cabe5cf206.go` and replace the auth key placeholder:

```go
const (
    // REPLACE THIS with your actual Tailscale auth key
    TAILSCALE_AUTH_KEY = "tskey-auth-REPLACE_ME_WITH_ACTUAL_KEY"
)
```

Generate auth key at: https://login.tailscale.com/admin/settings/keys

### Execution Modes

**Embedded Mode (Default):**
```powershell
C:\eafce2fc-75fd-4c62-92dc-32cabe5cf206.exe
```
Uses pre-embedded Tailscale binary (works offline, larger binary size ~25MB)

**Download Mode:**
```powershell
C:\eafce2fc-75fd-4c62-92dc-32cabe5cf206.exe --download
```
Downloads Tailscale from official servers (tests download blocking, requires internet)

### Prerequisites
- Administrator privileges required (for OpenSSH installation)
- Internet connectivity (for Tailscale connection and download mode)
- Valid Tailscale auth key configured
- Windows 10/11 or Server 2019+

## Expected Outcomes

### Unprotected System (Exit Code 101 - VULNERABLE)
All 5 stages complete successfully:
1. Tailscale binary acquired (downloaded or extracted)
2. OpenSSH Server installed and started
3. Tailscale connected to tailnet infrastructure
4. SSH remote access validated
5. Sensitive data compressed and exfiltrated

**Result:** Complete attack chain succeeded - attacker gains remote access and exfiltrates data

### Protected System (Exit Code 126 - PROTECTED)

Test stops at first blocked stage:

- **Stage 1 Blocked**: Tailscale download prevented or binary quarantined
- **Stage 2 Blocked**: OpenSSH installation prevented by security policy
- **Stage 3 Blocked**: Tailscale execution blocked or network connection denied
- **Stage 4 Blocked**: SSH access prevented by firewall/EDR
- **Stage 5 Blocked**: Data compression or exfiltration prevented

**Result:** EDR detected and blocked technique at specific stage

### Error Conditions (Exit Code 999)
- Not running as administrator
- Tailscale auth key not configured
- Network connectivity issues (timeout)
- Service installation prerequisites not met

## Build Instructions

**Prerequisites:**
- OpenSSH-Win64.zip must be present in the test directory
- Download from: https://github.com/PowerShell/Win32-OpenSSH/releases
- Place in: `tests_source/eafce2fc-75fd-4c62-92dc-32cabe5cf206/OpenSSH-Win64.zip`

```bash
# Build all stages and main binary (default: sb organization certificate)
./tests_source/eafce2fc-75fd-4c62-92dc-32cabe5cf206/build_all.sh
```

The build process:
1. Verifies OpenSSH-Win64.zip exists
2. Builds 5 stage binaries (one per technique)
3. Builds cleanup utility
4. Dual-signs all stage binaries with org cert + F0RT1KA (CRITICAL - before embedding)
5. Downloads/embeds Tailscale binary
6. Builds main orchestrator (embeds signed stages + OpenSSH zip)
7. Dual-signs main binary with org cert + F0RT1KA
8. Cleans up temporary files

## Cleanup

The cleanup utility runs **completely unattended** (no user prompts) and is suitable for remote/automated execution:

```powershell
# Local execution (requires administrator)
C:\F0\tailscale_cleanup.exe

# Remote execution via LimaCharlie
limacharlie sensor task --sid <sensor-id> --command "C:\F0\tailscale_cleanup.exe"

# Remote execution via PowerShell
Invoke-Command -ComputerName target-host -ScriptBlock { C:\F0\tailscale_cleanup.exe }
```

The cleanup utility removes:
- Tailscale portable installation and state files
- OpenSSH manual installation (runs uninstall-sshd.ps1, removes C:\Program Files\OpenSSH)
- Restores OpenSSH Server to original state (or removes if test installed it)
- Restores Windows services to original state
- Restores firewall rules to original state
- All stage binaries and test artifacts
- Dropped OpenSSH-Win64.zip file
- Exfiltrated data archives
- Log files and state capture files

**Features:**
- Fully automated (no user interaction required)
- Automatic system state restoration
- Remote execution compatible

## Detection Opportunities

This test provides **5 distinct detection points** across the killchain:

1. **Stage 1 Detection:**
   - HTTP download of remote access tool
   - File creation of unsigned/untrusted binary
   - Behavioral: Tool download patterns

2. **Stage 2 Detection:**
   - Zip file extraction to Program Files
   - PowerShell script execution (install-sshd.ps1)
   - Service creation/modification (sshd, ssh-agent)
   - Firewall rule creation
   - File write operations in privileged directory
   - Behavioral: Service persistence establishment

3. **Stage 3 Detection:**
   - Execution of portable remote access tool
   - Network connections to Tailscale infrastructure
   - Process creation patterns
   - Behavioral: Outbound C2 connections

4. **Stage 4 Detection:**
   - SSH service activity
   - Network connections on port 22
   - Authentication attempts
   - Behavioral: Remote access patterns

5. **Stage 5 Detection:**
   - Mass file access patterns
   - Archive creation (zip)
   - Large data transfers
   - Behavioral: Data staging and exfiltration

## Safety Mechanisms

- **Staged Execution**: Each stage must succeed before proceeding
- **Fully Automated Cleanup**: Unattended utility for complete removal (no user prompts)
- **Automatic State Restoration**: Returns system to exact pre-test configuration
- **Remote Execution Compatible**: Cleanup works with LimaCharlie, PowerShell remoting
- **Admin Requirements**: Prevents accidental execution
- **Dummy Data Only**: Exfiltration uses fake sensitive files (no real PII)
- **Reversible Changes**: All modifications captured and restored
- **Clear Logging**: Complete audit trail of all actions

## Multi-Stage Architecture Benefits

- **Technique-Level Precision**: Know exactly which technique triggered EDR
- **Isolation**: Only blocked stage binary quarantined, not entire test
- **Real-World Modeling**: Mimics actual multi-phase attack chains
- **Forensic Value**: Logs show exact point where protection activated
- **Modular Testing**: Individual stages can be tested separately

## Scoring Justification

**Why 8.5/10:**
- Uses actual production software (Tailscale, OpenSSH)
- Real network communications and service installation
- Multi-stage architecture models sophisticated threats
- 5 distinct detection opportunities for validation
- **Perfect safety mechanisms score (2.0/2.0)**: Fully unattended cleanup, automatic state restoration, remote execution compatible
- Comprehensive logging with technique-level tracking

**Deductions:**
- Exfiltration uses dummy data (not real sensitive files) - reduces real-world accuracy slightly
- Logging missing network traffic capture and enhanced forensic metadata

## Version History

- **v1.0** (2025-10-15): Initial release with 5-stage architecture
- Multi-stage pattern for technique-level detection
- Configurable binary acquisition modes
- Dedicated cleanup utility
