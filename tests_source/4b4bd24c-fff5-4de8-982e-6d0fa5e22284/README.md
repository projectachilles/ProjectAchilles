# Data Exfiltration and Encryption Simulation

**Test Score**: **9.1/10**

## Overview
This test simulates advanced data exfiltration and encryption techniques commonly observed in sophisticated cyber attacks. It evaluates EDR/AV capabilities to detect cloud storage reconnaissance, data staging and exfiltration patterns, process masquerading, and encryption behavioral indicators without actual data destruction or transmission.

## MITRE ATT&CK Mapping
- **Tactic**: Exfiltration, Impact, Discovery, Defense Evasion
- **Technique**: T1020 - Automated Exfiltration
- **Technique**: T1041 - Exfiltration Over C2 Channel
- **Technique**: T1486 - Data Encrypted for Impact
- **Technique**: T1055 - Process Injection (Masquerading)
- **Technique**: T1083 - File and Directory Discovery

## Test Execution
The test simulates a multi-phase data exfiltration and encryption attack focusing on:
1. **Azure Storage Reconnaissance**: Discovery of cloud storage configurations, credentials, and access patterns
2. **Data Staging and Exfiltration**: High-value data identification, staging, and simulated cloud upload
3. **Process Masquerading**: Deployment of encryption binary masquerading as conhost.exe
4. **Encryption Simulation**: File system encryption behavior patterns with CPU-intensive operations

## Expected Outcomes
- **Protected**: EDR/AV detects data exfiltration patterns, process masquerading, or encryption behavioral indicators and blocks execution
- **Unprotected**: Data exfiltration and encryption simulation completes successfully indicating insufficient detection of cloud-based exfiltration and advanced encryption techniques

## Build Instructions
```bash
./utils/gobuild build tests_source/4b4bd24c-fff5-4de8-982e-6d0fa5e22284/
./utils/codesign sign build/4b4bd24c-fff5-4de8-982e-6d0fa5e22284/4b4bd24c-fff5-4de8-982e-6d0fa5e22284.exe
```