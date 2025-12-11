# Ransomware Encryption via BitLocker

## Overview

This multi-stage security test simulates a ransomware attack that leverages Windows BitLocker for data encryption, based on NCC Group research on BitLocker ransomware. The test evaluates EDR/AV detection capabilities against a realistic 3-stage attack chain.

**Test Score**: **9.0/10**

**Score Breakdown**:
- **Real-World Accuracy: 2.8/3.0** - Based on actual NCC Group research; uses real Windows tools (manage-bde, wevtutil, netsh, vssadmin, diskpart)
- **Technical Sophistication: 3.0/3.0** - Multi-stage killchain, VHD isolation, BitLocker encryption, VSS manipulation
- **Safety Mechanisms: 2.0/2.0** - Complete VHD isolation, custom event log channels, test-only firewall rules, automatic cleanup
- **Detection Opportunities: 0.7/1.0** - 6+ detection points across defense evasion, discovery, and impact phases
- **Logging & Observability: 1.0/1.0** - Full Schema v2.0 compliance, per-stage output capture, comprehensive audit trail

**Key Strengths**:
- VHD-based isolation ensures no impact to real system drives
- Uses actual Windows BitLocker encryption APIs
- Triggers realistic detection signatures (wevtutil, manage-bde, vssadmin)
- Complete automated cleanup after test execution
- Multi-stage architecture provides technique-level detection precision

## MITRE ATT&CK Mapping

### Stage 1: Defense Evasion
- **T1070.001** - Clear Windows Event Logs
- **T1562.004** - Disable or Modify System Firewall

### Stage 2: Discovery
- **T1082** - System Information Discovery
- **T1083** - File and Directory Discovery

### Stage 3: Impact
- **T1486** - Data Encrypted for Impact
- **T1490** - Inhibit System Recovery

## Test Execution

The test simulates a ransomware attack chain:

1. **Stage 1**: Creates and clears a custom event log channel, creates/deletes test firewall rule
2. **Stage 2**: Enumerates system information, checks BitLocker availability, discovers drives
3. **Stage 3**: Creates isolated VHD, enables BitLocker encryption, attempts VSS shadow deletion

## Expected Outcomes

- **Protected (Exit Code 126)**: EDR/AV detects and blocks attack at any stage
- **Protected (Exit Code 105)**: Binary quarantined before execution
- **Unprotected (Exit Code 101)**: Complete attack chain executed without prevention
- **Error (Exit Code 999)**: Prerequisites not met (not admin, BitLocker unavailable)

## Build Instructions

```bash
# Build with default organization certificate
./tests_source/581e0f20-13f0-4374-9686-be3abd110ae0/build_all.sh

# Build with specific organization
./tests_source/581e0f20-13f0-4374-9686-be3abd110ae0/build_all.sh --org sb
```

## Deployment

1. Copy `581e0f20-13f0-4374-9686-be3abd110ae0.exe` to target Windows system
2. Run with Administrator privileges (required for BitLocker operations)
3. Review results in `C:\F0\test_execution_log.json`
4. Manual cleanup if needed: `C:\F0\cleanup_utility.exe`

## Requirements

- Windows Pro/Enterprise (BitLocker required)
- Administrator privileges
- Minimum 200MB free disk space for VHD

## Safety Features

- **VHD Isolation**: All BitLocker operations performed on 100MB isolated VHD
- **Custom Event Log**: Creates "F0RT1KA-Test" channel instead of clearing real logs
- **Test Firewall Rule**: Creates/deletes "F0RT1KA-Test-Rule" without affecting real rules
- **Automatic Cleanup**: Decrypts, dismounts, and deletes VHD after test
- **No Real Shadow Deletion**: VHD has no shadow copies to delete

## Reference

- [NCC Group - BitLocker Ransomware Research](https://research.nccgroup.com/)
