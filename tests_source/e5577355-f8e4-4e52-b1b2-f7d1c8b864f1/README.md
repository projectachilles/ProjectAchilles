# SilentButDeadly WFP EDR Network Isolation

**Test UUID:** `e5577355-f8e4-4e52-b1b2-f7d1c8b864f1`
**Version:** 1.0.0
**Category:** Defense Evasion
**Severity:** High
**Test Score**: **9.2/10**

## Overview

This test simulates the **SilentButDeadly** technique - a sophisticated EDR evasion method that uses the Windows Filtering Platform (WFP) to block EDR/AV network communications without terminating security processes. This approach is stealthier than traditional EDR killing techniques because security processes remain running, avoiding process termination alerts.

**Score Breakdown**:
- **Real-World Accuracy: 2.8/3.0** - Uses actual WFP technique employed by real threat actors
- **Technical Sophistication: 2.8/3.0** - WFP API usage, multi-EDR targeting, dynamic filter creation
- **Safety Mechanisms: 2.0/2.0** - Non-persistent filters, automatic cleanup on exit
- **Detection Opportunities: 0.6/1.0** - WFP events, service disruption signals
- **Logging & Observability: 1.0/1.0** - Full Schema v2.0 compliant logging

**Key Strengths**:
- Uses legitimate Windows Filtering Platform APIs
- Targets 14+ major EDR/AV products
- Non-destructive (processes continue running)
- Complete automatic cleanup on exit
- Single binary deployment

## MITRE ATT&CK Mapping

- **Technique**: T1562.001 - Impair Defenses: Disable or Modify Tools
- **Tactic**: Defense Evasion

## Technical Details

### How SilentButDeadly Works

1. **EDR Process Enumeration**: Scans for known security software processes including:
   - SentinelOne, CrowdStrike, Windows Defender
   - Carbon Black, Cylance, Symantec, McAfee
   - Trend Micro, Sophos, Kaspersky, ESET
   - Cortex XDR, FireEye, Elastic Security

2. **WFP Initialization**: Creates a dynamic (non-persistent) filtering session with:
   - High-priority provider
   - Custom sublayer for filter organization
   - Session-bound filters (removed on process exit)

3. **Network Blocking**: For each detected EDR process, creates 4 filters:
   - IPv4 outbound (FWPM_LAYER_ALE_AUTH_CONNECT_V4)
   - IPv6 outbound (FWPM_LAYER_ALE_AUTH_CONNECT_V6)
   - IPv4 inbound (FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4)
   - IPv6 inbound (FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6)

4. **Process-Specific Blocking**: Uses FWPM_CONDITION_ALE_APP_ID for precise targeting

5. **Monitoring**: Runs for ~30 seconds showing isolation status

6. **Cleanup**: Removes all filters and closes WFP engine on exit

### Attack Impact

When successful, this technique:
- Blocks EDR cloud connectivity (telemetry upload)
- Prevents real-time threat intelligence updates
- Disrupts cloud-based detection responses
- Maintains stealth by not killing processes

## Detection Opportunities

1. **WFP Filter Events**: Windows Event IDs 5441, 5157, 5152
2. **Process Enumeration**: Behavioral detection of EDR process targeting
3. **Network Isolation**: Sudden loss of EDR cloud connectivity
4. **Administrative API Usage**: Privileged WFP operations
5. **Suspicious Tool Execution**: Detection of known attack tools

## Expected Results

### Unprotected System (Exit Code 101)
- SilentButDeadly executes successfully
- WFP filters are applied to EDR processes
- EDR cloud connectivity is blocked
- Monitoring period completes (~30 seconds)
- Filters are automatically cleaned up

### Protected System
- **Exit Code 105**: Binary quarantined before execution
- **Exit Code 126**: Execution blocked by EDR/behavioral detection

## Prerequisites

- **Administrator privileges** - Required for WFP operations
- **Base Filtering Engine (BFE) service** - Must be running
- **Windows 7 or later** - WFP API availability

## Test Architecture

**Pattern:** Standard Single-Binary
**Deployment:** Self-contained executable with embedded SilentButDeadly.exe
**Cleanup:** Automatic - WFP filters are non-persistent and removed on exit

The test embeds the pre-compiled SilentButDeadly binary and:
1. Checks for administrator privileges
2. Extracts the embedded binary to `c:\F0\`
3. Monitors for file quarantine
4. Executes SilentButDeadly
5. Evaluates results based on execution outcome

## Safety Mechanisms

- **Non-persistent filters**: All WFP filters are session-bound and removed on exit
- **No kernel drivers**: Uses only user-mode WFP APIs
- **Reversible operations**: No permanent system modifications
- **Targeted approach**: Only affects identified EDR processes
- **Automatic cleanup**: Resources released on process termination

## Related Tests

- `640e6458-5b6b-4153-87b4-8327599829a8` - Multi-stage EDR Network Isolation (includes service disruption)

## References

- [SilentButDeadly GitHub Repository](https://github.com/loosehose/SilentButDeadly)
- [Windows Filtering Platform Documentation](https://docs.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-start-page)
- [MITRE ATT&CK T1562.001](https://attack.mitre.org/techniques/T1562/001/)
