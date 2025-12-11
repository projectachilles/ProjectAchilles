# TrollDisappearKey AMSI Bypass Detection Test

**Test Score**: **7.9/10**

## Overview
This test evaluates the endpoint's ability to detect and prevent TrollDisappearKey, an AMSI (Anti-Malware Scan Interface) bypass tool that manipulates registry queries to break AMSI provider loading. The tool hooks registry functions and redirects AMSI provider queries to prevent security vendor DLLs from being loaded, enabling the execution of malicious .NET assemblies without AMSI scanning.

## Test Steps
1. Drop the TrollDisappearKey binary (`troll_disappear_key.exe`) to disk
2. Attempt to bypass AMSI and download/execute Seatbelt.exe remotely
3. Monitor for defensive reactions and execution prevention
4. Analyze assembly output to confirm AMSI bypass success
5. Clean up any created artifacts

## How It Works
TrollDisappearKey operates by:
- Hooking the `RegOpenKeyExW` function to intercept registry queries
- When AMSI/CLR tries to read "Software\\Microsoft\\AMSI\\Providers", the tool redirects it to "Software\\Microsoft\\AMSI\\Providers " (with trailing space)
- This breaks the AMSI provider DLL loading process, allowing assembly loading without scanning
- Downloads and executes Seatbelt.exe (security enumeration tool) to demonstrate successful AMSI bypass

## Test Payload
- **Seatbelt**: A C# project that performs a number of security oriented host-survey "safety checks" relevant from both offensive and defensive security perspectives
- **Source**: SharpCollection repository on GitHub
- **Purpose**: Demonstrates successful AMSI bypass through execution of a tool that would normally trigger AMSI detection

## Expected Results
- **Protected**: The security solution should detect and/or prevent the AMSI bypass tool from executing or successfully bypassing AMSI
- **Unprotected**: The tool executes successfully, bypasses AMSI protection, downloads and runs Seatbelt showing its help output

## MITRE ATT&CK Mapping
- **Technique**: T1562.001 - Impair Defenses: Disable or Modify Tools
- **Tactic**: Defense Evasion
- **Sub-technique**: Disable or Modify System Firewall

## Technical Notes
- Modified TrollDisappearKey to execute once and exit (no interactive loop)
- Fixed argument passing to prevent quote-related URL errors
- Automated test execution without user interaction requirements

## References
- [TrollDisappearKey GitHub Repository](https://github.com/cybersectroll/TrollDisappearKey)
- [Seatbelt Tool](https://github.com/GhostPack/Seatbelt)
- [MITRE ATT&CK T1562.001](https://attack.mitre.org/techniques/T1562/001/) 