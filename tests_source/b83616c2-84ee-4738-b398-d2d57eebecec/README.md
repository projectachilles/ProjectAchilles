# NativeDump (NimDump) Detection Test

**Test Score**: **7.7/10**

## Overview
This test evaluates the endpoint's ability to detect and prevent NativeDump (Nim flavor), a tool that dumps the LSASS process using only NTAPI functions without calling the well-known MiniDumpWriteDump function.

## Test Steps
1. Drop the NimDump binary (`library_update.exe`) to disk
2. Execute NimDump to attempt dumping LSASS process memory
3. Check if the dump file was created
4. Clean up any created artifacts

## Expected Results
- **Protected**: The security solution should detect and/or prevent the NimDump binary from executing or dumping LSASS
- **Unprotected**: The tool executes successfully and creates a memory dump file

## MITRE ATT&CK Mapping
- **Technique**: T1003.001 - OS Credential Dumping: LSASS Memory
- **Tactic**: Credential Access 