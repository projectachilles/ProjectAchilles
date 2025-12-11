# Process Injection via CreateRemoteThread

## Overview
This test simulates process injection using the CreateRemoteThread technique to evaluate EDR/AV detection capabilities against one of the most common code injection methods used by malware.

**Test Score**: **6.5/10** - Good intermediate test with clear detection opportunities

**Score Breakdown**:
- **Real-World Accuracy: 2.0/3.0** - Simulates realistic injection pattern using actual Windows APIs
- **Technical Sophistication: 2.0/3.0** - Process injection with multi-phase approach
- **Safety Mechanisms: 1.0/2.0** - Cleanup functions and benign payload
- **Detection Opportunities: 0.5/1.0** - 4 distinct detection points
- **Logging & Observability: 1.0/1.0** - Comprehensive test_logger implementation

**Key Strengths**:
- Uses authentic Windows API sequence (OpenProcess, VirtualAllocEx, WriteProcessMemory, CreateRemoteThread)
- Multi-phase detection evaluation at each injection step
- Comprehensive logging with JSON/text output
- Clean single-binary deployment
- Proper exit code evaluation based on actual results

## MITRE ATT&CK Mapping
- **Tactic**: Defense Evasion, Privilege Escalation
- **Technique**: T1055 - Process Injection
- **Sub-technique**: T1055.002 - Portable Executable Injection

## Test Execution
Simulates classic process injection by:
1. Starting a benign target process (notepad.exe)
2. Opening process handle with required permissions
3. Allocating memory in remote process
4. Writing benign shellcode to allocated memory
5. Creating remote thread to execute code

## Expected Outcomes
- **Protected (Exit 126)**: EDR/AV blocks injection at any stage (OpenProcess, VirtualAllocEx, WriteProcessMemory, or CreateRemoteThread)
- **Unprotected (Exit 101)**: All injection stages succeed without intervention

## Detection Points
1. **Process Handle Access**: Opening process with PROCESS_VM_WRITE permissions
2. **Memory Allocation**: VirtualAllocEx with PAGE_EXECUTE_READWRITE
3. **Memory Write**: WriteProcessMemory to remote process
4. **Thread Creation**: CreateRemoteThread in target process

## Build Instructions
```bash
# Build single self-contained binary
cd /Users/jimx/Documents/F0RT1KA/f0_library
./utils/gobuild build tests_source/7e93865c-0033-4db3-af3c-a9f4215c1c49/

# Sign the binary
./utils/codesign sign build/7e93865c-0033-4db3-af3c-a9f4215c1c49/7e93865c-0033-4db3-af3c-a9f4215c1c49.exe
```

## Deployment
Single binary deployment - just copy and run:
```powershell
# Copy to target
copy 7e93865c-0033-4db3-af3c-a9f4215c1c49.exe C:\

# Execute (requires admin privileges)
C:\7e93865c-0033-4db3-af3c-a9f4215c1c49.exe
```

## Safety Notes
- Uses benign payload (simple message box shellcode)
- Automatically cleans up spawned notepad process
- No persistent changes to system
- Safe for production testing