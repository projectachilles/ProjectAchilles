# EDRSilencer Detection Test

**Test ID**: bcba14e7-6f87-4cbd-9c32-718fdeb39b65
**Test binary SHA1**: [placeholder - would be actual SHA1 in production]
**Created**: 2024-10-07 10:00:00.000000
**Test schedule**: Not scheduled

## Test Score: 7.8/10

### Score Breakdown

| Criterion | Score |
|-----------|-------|
| **Real-World Accuracy** | **2.3/3.0** |
| **Technical Sophistication** | **2.2/3.0** |
| **Safety Mechanisms** | **1.6/2.0** |
| **Detection Opportunities** | **0.7/1.0** |
| **Logging & Observability** | **1.0/1.0** |

**Justification**: Uses actual EDRSilencer tool to block EDR communications via WFP APIs. Good safety with automatic cleanup using "unblockall" parameter - all WFP filters are removed before completion. Simpler technique than SilentButDeadly but tests the same defense evasion category.

## Overview
This test evaluates endpoint protection against EDRSilencer, a tool designed to disable security controls by blocking outbound traffic from EDR processes using Windows Filtering Platform (WFP) APIs.

## Technique Details
- **MITRE ATT&CK**: T1562.001 (Impair Defenses: Disable or Modify Tools)
- **Tactic**: Defense Evasion
- **Platform**: Windows
- **Permissions Required**: Administrator
- **Category**: Security Test, Defense Evasion

## Test Description
The test performs the following actions:
1. Dropping the EDRSilencer binary to disk
2. Attempting to execute the tool to block EDR outbound communications
3. Cleaning up by removing any filters created during the test

## Expected Behaviors
- **Detection**: The endpoint security solution should detect:
  - The EDRSilencer binary through signatures or heuristics
  - Tampering attempts with security tools' communications
- **Prevention**: Activities should be blocked at one or more stages:
  - File quarantine on extraction
  - Process execution prevention
- **Alerting**: Security alerts should be generated for:
  - Malicious file detection
  - Defense evasion attempts

## Success Metrics
- **101** (Unprotected): System failed to detect or prevent the attack
- **105** (FileQuarantinedOnExtraction): File was quarantined during extraction
- **126** (ExecutionPrevented): Execution was prevented

## References
- [MITRE ATT&CK - Impair Defenses: Disable or Modify Tools](https://attack.mitre.org/techniques/T1562/001/)
- [EDRSilencer](https://github.com/netero1010/EDRSilencer) 