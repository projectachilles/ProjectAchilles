# EDRSilencer Detection

**Test Score**: **7.8/10**

## Overview
This test evaluates the capability of security solutions to detect and prevent the execution of EDRSilencer, a defensive evasion tool designed to block outbound traffic from EDR processes using Windows Filtering Platform (WFP) APIs.

## How

> Safety: This test does not attempt to permanently disable EDR processes. Any WFP filters applied during the test are removed before completion.

Steps:

1. Extract the EDRSilencer binary to disk.
2. Wait for 3 seconds to gauge defensive reactions.
3. Exit PROTECTED if the file was quarantined, continue if not.
4. Attempt to execute EDRSilencer with the "blockedr" parameter to identify and block EDR processes.
5. Clean up by executing the "unblockall" parameter to remove any WFP filters created during the test.
6. Exit PROTECTED if execution was prevented, exit UNPROTECTED if execution was successful.

Example Output:
```bash
[bcba14e7-6f87-4cbd-9c32-718fdeb39b65] Starting test at: 2024-10-07T10:05:00
[bcba14e7-6f87-4cbd-9c32-718fdeb39b65] Extracting EDRSilencer tool for quarantine test
[bcba14e7-6f87-4cbd-9c32-718fdeb39b65] Pausing for 3 seconds to gauge defensive reaction
[bcba14e7-6f87-4cbd-9c32-718fdeb39b65] EDRSilencer binary was caught!
[bcba14e7-6f87-4cbd-9c32-718fdeb39b65] Completed with code: 105
[bcba14e7-6f87-4cbd-9c32-718fdeb39b65] Ending test at: 2024-10-07T10:05:05
```

## Resolution

If this test fails:

* Ensure your security solution has up-to-date signatures that include detections for defense evasion tools.
* Implement tamper protection mechanisms that prevent modification or disabling of security tools.
* Configure alerts for attempts to disable or tamper with security controls.
* Consider implementing network-level protections that can detect and block unusual outbound filtering configurations.
* Use a security monitoring solution that can detect the use of Windows Filtering Platform to block security tools. 