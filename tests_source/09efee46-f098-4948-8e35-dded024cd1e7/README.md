# Sliver C2 Client Detection

**Test Score**: **7.5/10**

## Overview
This test evaluates the capability of security solutions to detect and prevent the execution of a Sliver C2 client. Sliver is a legitimate red team Command and Control (C2) framework used by security professionals, but can also be abused by threat actors to maintain persistence and control over compromised systems.

## How

> Safety: This test does not attempt to connect to an actual C2 server or perform any malicious actions on the endpoint.

Steps:

1. Extract the Sliver client binary to disk.
2. Wait for 3 seconds to gauge defensive reactions.
3. Exit PROTECTED if the file was quarantined, continue if not.
4. Attempt to execute the Sliver client binary with a basic help command.
5. Exit PROTECTED if execution was prevented, exit UNPROTECTED if execution was successful.

Example Output:
```bash
[09efee46-f098-4948-8e35-dded024cd1e7] Starting test at: 2024-10-06T14:35:00
[09efee46-f098-4948-8e35-dded024cd1e7] Extracting Sliver C2 client for quarantine test
[09efee46-f098-4948-8e35-dded024cd1e7] Pausing for 3 seconds to gauge defensive reaction
[09efee46-f098-4948-8e35-dded024cd1e7] Sliver client binary was caught!
[09efee46-f098-4948-8e35-dded024cd1e7] Completed with code: 105
[09efee46-f098-4948-8e35-dded024cd1e7] Ending test at: 2024-10-06T14:35:05
```

## Technical Details

Sliver is an open-source, cross-platform adversary emulation/red team framework implemented in Golang. It supports multiple communication protocols (HTTP, HTTPS, DNS, TCP, mTLS), and provides operators with advanced capabilities for lateral movement, command execution, and data exfiltration.

This test specifically checks if endpoint security solutions can:
1. Detect the Sliver client binary based on file signatures/heuristics
2. Prevent the execution of the binary through runtime monitoring

## MITRE ATT&CK Mapping

- **Technique**: T1219 (Remote Access Software)
- **Tactic**: Command and Control
- **Platforms**: Windows
- **Permissions Required**: User

## Resolution

If this test fails:

* Ensure your security solution has up-to-date signatures that include detections for red team tools like Sliver.
* Configure your EDR to monitor and alert on suspicious processes attempting to establish unusual network connections.
* Implement application allowlisting to prevent unauthorized executables from running.
* Consider deploying network monitoring tools that can detect C2 traffic patterns. 