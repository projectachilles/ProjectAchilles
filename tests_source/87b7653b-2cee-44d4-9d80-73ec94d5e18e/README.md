# EDR-Freeze Defense Evasion Test

**Test Score**: **8.6/10**

## Overview
This security test evaluates endpoint protection capabilities against the EDR-Freeze technique, which exploits Windows Error Reporting (WerFaultSecure.exe) to suspend security processes including Windows Defender and EDR agents.

## Test Behavior
1. Drops EDR-Freeze.exe to C:\F0
2. Identifies active Windows Defender process (MpDefenderCoreService.exe, MsMpEng.exe, or NisSrv.exe)
3. Executes EDR-Freeze to suspend the Defender process for 60 seconds
4. Validates suspension by attempting to download malicious tool (Seatbelt.exe) via certutil.exe
5. Determines protection status based on whether download succeeds

## MITRE ATT&CK Mapping
- **T1562.001** - Impair Defenses: Disable or Modify Tools
- **T1055** - Process Injection (indirect via WerFaultSecure)
- **T1574** - Hijack Execution Flow

## Expected Outcomes
- **Protected (105)**: EDR-Freeze.exe quarantined on extraction
- **Protected (126)**: EDR-Freeze execution prevented or certutil download blocked
- **Unprotected (101)**: Defender successfully suspended and malicious download succeeds

## Technical Details
EDR-Freeze leverages a race condition in WerFaultSecure.exe's MiniDumpWriteDump functionality, which suspends all threads in a target process during memory dumping. By suspending WerFaultSecure immediately after it suspends the target, the security process remains in a "coma state" for the specified duration.

## References
- [EDR-Freeze Blog Post](https://www.zerosalarium.com/2025/09/EDR-Freeze-Puts-EDRs-Antivirus-Into-Coma.html)
- [EDR-Freeze GitHub](https://github.com/TwoSevenOneT/EDR-Freeze)