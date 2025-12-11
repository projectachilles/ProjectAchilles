# SafePay Ransomware Simulation & Data Staging Test

**Test Score**: **8.6/10**

This F0RT1KA test simulates the SafePay ransomware's behavior, including file encryption and data staging techniques using WinRAR.

## Overview
The test drops and executes a PowerShell script that:
- Creates decoy files with sensitive-looking names
- Uses WinRAR for data staging/exfiltration
- Simulates file encryption with .safepay extension
- Creates a ransom note
- Simulates C2 communication patterns

## MITRE ATT&CK Mapping
- T1486 - Data Encrypted for Impact
- T1560.001 - Archive Collected Data: Archive via Utility
- T1071.001 - Application Layer Protocol: Web Protocols
- T1490 - Inhibit System Recovery

## Expected Behavior
A properly protected endpoint should:
- Block the WinRAR binary execution
- Prevent the PowerShell script from encrypting files
- Detect and stop the ransomware-like behavior
- Alert on the suspicious file operations