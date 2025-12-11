# SafePay UAC Bypass & Defense Evasion Test

**Test Score**: **8.3/10**

This F0RT1KA test simulates the UAC bypass and defense evasion techniques employed by SafePay malware, including CMSTPLUA COM object abuse and registry persistence.

## Overview

The test attempts to:
- Bypass UAC using the CMSTPLUA COM interface
- Create registry persistence with a specific autorun value
- Simulate Windows Defender disablement via GUI automation

## MITRE ATT&CK Mapping

- **T1548.002**: Abuse Elevation Control Mechanism: Bypass User Account Control
- **T1562.001**: Impair Defenses: Disable or Modify Tools  
- **T1547.001**: Boot or Logon Autostart Execution: Registry Run Keys

## Test Behavior

1. Drops PowerShell script to `c:\F0\safepay_uac_bypass.ps1`
2. Executes script with execution policy bypass
3. Attempts UAC bypass via CMSTPLUA COM object
4. Creates registry persistence at `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
5. Simulates Windows Defender disablement attempt

## Expected Results

- **Protected**: EDR blocks UAC bypass attempt or registry persistence creation
- **Unprotected**: Registry persistence successfully created with value `6F22-C16F-0C71-688A`