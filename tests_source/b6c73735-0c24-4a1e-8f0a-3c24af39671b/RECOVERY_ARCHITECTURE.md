# Recovery Architecture - Technical Documentation

## Overview

The MDE Authentication Bypass test includes a sophisticated three-layer recovery architecture designed to ensure system safety when performing advanced certificate pinning bypass operations.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     TEST EXECUTION LAYER                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Main Test Binary                                      │ │
│  │  - Performs bypass attempt                             │ │
│  │  - Saves state before modifications                    │ │
│  │  - Self-restores in Quick Patch mode                   │ │
│  │  - Monitors for EDR termination                        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓ ↑
                    Communicates via
                    state file (JSON)
                            ↓ ↑
┌─────────────────────────────────────────────────────────────┐
│                    WATCHDOG PROCESS LAYER                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Watchdog Binary (cert_bypass_watchdog.exe)           │ │
│  │  - Monitors test process every 2 seconds              │ │
│  │  - Reads patch state from JSON file                   │ │
│  │  - Detects test termination                           │ │
│  │  - Performs emergency restoration                     │ │
│  │  - Auto-restores after timeout (5 min default)        │ │
│  │  - Creates restoration reports                        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    If watchdog fails OR
                    Manual intervention needed
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  MANUAL RECOVERY LAYER                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  PowerShell Recovery Script (emergency_restore.ps1)   │ │
│  │  - Stops running test processes                       │ │
│  │  - Restores MDE services                              │ │
│  │  - Cleans up test artifacts                           │ │
│  │  - Provides recovery recommendations                  │ │
│  │  - Triggers watchdog restore if running               │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## State Management System

### State File Format

Location: `C:\F0\watchdog_state.json`

```json
{
  "watchdogPid": 1234,
  "monitoredPid": 5678,
  "startTime": "2025-01-22T10:00:00Z",
  "lastCheck": "2025-01-22T10:05:30Z",
  "checkInterval": 2,
  "patches": [
    {
      "processId": 5678,
      "processName": "self",
      "targetDll": "crypt32.dll",
      "targetFunction": "CertVerifyCertificateChainPolicy",
      "targetAddress": 140735272345600,
      "originalBytes": [72, 137, 92, 36, 8, 72, 137],
      "patchApplied": true,
      "timestamp": "2025-01-22T10:00:05Z",
      "requiresRestore": true
    }
  ],
  "autoRestoreTime": 300,
  "status": "MONITORING"
}
```

### State Transitions

```
MONITORING → Test running normally
    ↓
RESTORING → Test terminated, performing restoration
    ↓
FULLY_RESTORED → All patches restored successfully
    OR
PARTIAL_RESTORE → Some patches failed to restore
    ↓
COMPLETED → Watchdog shutting down
```

## Recovery Scenarios

### Scenario 1: Normal Test Completion

**Flow**:
1. Test runs and completes successfully
2. Test restores its own patches (Quick Patch mode)
3. Test exits with appropriate code
4. Watchdog detects normal completion
5. Watchdog verifies no patches need restoration
6. Watchdog exits cleanly

**User Action**: None required

**Files Created**:
- Test summary: `C:\F0\attack_summary.txt`
- Watchdog state: `C:\F0\watchdog_state.json` (status: COMPLETED)

### Scenario 2: EDR Terminates Test (Watchdog Active)

**Flow**:
1. Test applies memory patch
2. EDR detects malicious activity
3. EDR terminates test process
4. Watchdog detects process termination on next check (within 2 seconds)
5. Watchdog reads patch state from JSON file
6. Watchdog restores original memory bytes
7. Watchdog creates restoration report
8. Watchdog exits

**User Action**: Review restoration report

**Files Created**:
- Restoration report: `C:\F0\restoration_report.txt`
- Watchdog state: `C:\F0\watchdog_state.json` (status: FULLY_RESTORED or PARTIAL_RESTORE)

### Scenario 3: Auto-Restore Timeout

**Flow**:
1. Test runs for extended period
2. Watchdog timer reaches auto-restore threshold (5 minutes)
3. Watchdog initiates scheduled restoration
4. Watchdog restores all patches
5. Watchdog creates restoration report
6. Watchdog exits

**User Action**: Review results, restart test if needed

**Trigger**: Configurable timeout (default: 300 seconds)

### Scenario 4: Manual Restore Request

**Flow**:
1. User creates restore request flag: `echo RESTORE > C:\F0\RESTORE_NOW.flag`
2. Watchdog detects flag file on next check
3. Watchdog initiates manual restoration
4. Watchdog restores all patches
5. Watchdog removes flag file
6. Watchdog creates restoration report

**User Action**: Create RESTORE_NOW.flag file

**Command**:
```cmd
echo RESTORE > C:\F0\RESTORE_NOW.flag
```

### Scenario 5: Watchdog Fails or Not Running

**Flow**:
1. Test runs but watchdog is not active
2. Test is terminated or hangs
3. User notices system issues
4. User runs PowerShell recovery script
5. Script stops test processes
6. Script attempts restoration via service restart
7. Script recommends reboot if needed

**User Action**: Run emergency recovery script

**Command**:
```powershell
.\emergency_restore.ps1 -Force -RestartServices
```

### Scenario 6: System Crash or Power Loss

**Flow**:
1. Test is running with persistent patch
2. System crashes or loses power
3. System reboots
4. Memory patches are lost (RAM cleared)
5. System returns to original state automatically

**User Action**: None required (memory patches are non-persistent across reboots)

**Note**: This is why memory patching is reversible - system reboot clears all RAM

## Technical Implementation Details

### Memory Patching Process

```
1. Enable Debug Privileges
   ↓
2. Locate Target Function
   - Get handle to crypt32.dll
   - Find CertVerifyCertificateChainPolicy address
   ↓
3. Read Original Bytes
   - Read first 16 bytes of function
   - Store in patch state
   ↓
4. Change Memory Protection
   - Call VirtualProtectEx
   - Set PAGE_EXECUTE_READWRITE
   ↓
5. Write Patch Bytes
   - Assembly: mov eax, 1; ret
   - Function returns TRUE immediately
   ↓
6. Restore Protection
   - Restore original page protection
   ↓
7. Save State
   - Write patch info to JSON file
   - Watchdog can now restore if needed
```

### Restoration Process

```
1. Detect Restore Trigger
   - Process termination
   - Timeout reached
   - Manual request
   ↓
2. Load Patch State
   - Read C:\F0\watchdog_state.json
   - Parse patch information
   ↓
3. For Each Patch:
   a. Open Target Process
      - Use OpenProcess with PROCESS_VM_WRITE
   ↓
   b. Change Memory Protection
      - VirtualProtectEx → PAGE_EXECUTE_READWRITE
   ↓
   c. Write Original Bytes
      - WriteProcessMemory with saved bytes
   ↓
   d. Restore Protection
      - VirtualProtectEx → original protection
   ↓
   e. Verify Restoration
      - Read back memory
      - Confirm original bytes present
   ↓
4. Update State
   - Mark patch as restored
   - Set requiresRestore = false
   ↓
5. Create Report
   - Document restoration results
   - Save to restoration_report.txt
```

### Safety Mechanisms

#### 1. Privilege Checks
```go
if !enableDebugPrivilege() {
    // Cannot proceed - EDR may be blocking
    return BLOCKED_BY_EDR
}
```

#### 2. Memory Protection Tests
```go
if !testMemoryWritable(targetAddr) {
    // Memory is protected
    return PROTECTED
}
```

#### 3. Watchdog Requirement (Persistent Mode)
```go
if mode == BypassModePersistent && !isWatchdogRunning() {
    // Safety abort - no watchdog
    return SAFETY_ABORT
}
```

#### 4. State Persistence
- Every patch operation saves state to disk
- Watchdog can recover even if test crashes
- State survives process termination

#### 5. Automatic Cleanup
- Quick Patch mode self-restores
- Watchdog has auto-restore timeout
- PowerShell script provides manual fallback

## Monitoring and Logging

### Watchdog Console Output

```
========================================
F0RT1KA Certificate Bypass Watchdog
========================================
Purpose: Monitor and restore memory patches if test is terminated

[*] Monitoring PID: 5678
[*] State file: C:\F0\watchdog_state.json
[*] Check interval: 2 seconds
[*] Auto-restore after: 300 seconds

[+] Watchdog active - monitoring for issues...
[*] Press Ctrl+C to stop watchdog and restore patches

[10:00:05] Process OK | Patches: 1 | Auto-restore in: 295s
[10:00:07] Process OK | Patches: 1 | Auto-restore in: 293s
...
[!] WARNING: Monitored process (PID 5678) is no longer accessible
[!] Process may have been terminated by EDR/AV
[*] Initiating emergency restoration...
```

### Test Console Output (Bypass Attempt)

```
[*] Certificate Pinning Bypass Attempt
[*] Mode: QUICK_PATCH (patch + immediate restore)
[*] Target Process: self

[*] Step 1: Requesting debug privileges...
[+] Debug privileges obtained

[*] Step 2: Locating CRYPT32!CertVerifyCertificateChainPolicy...
[+] Function located at: 0x7FF8A1B2C3D0
[+] Read 16 original bytes

[*] Step 3: Testing memory write capability...
[+] Memory is writable

[*] Step 4: Executing bypass (mode: QUICK_PATCH)...
[*] QUICK_PATCH mode: Apply patch with immediate restoration
[*] Applying patch...
[!] Patch applied successfully!
[*] Detection window: 100ms
[*] Restoring original bytes...
[+] Original bytes restored
[+] System returned to original state

[!] Bypass was SUCCESSFUL during test window
[!] System is vulnerable to certificate pinning bypass
```

## Performance Considerations

### Watchdog Overhead
- Check interval: 2 seconds (configurable)
- Memory usage: ~5-10 MB
- CPU usage: Negligible (<1%)
- Disk I/O: Minimal (state file updates)

### Test Performance
- Bypass attempt: <100ms for Quick Patch mode
- State save: <10ms
- Memory read/write: <1ms per operation

## Error Handling

### Watchdog Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| Cannot open process | Insufficient privileges | Run as Administrator |
| Cannot write memory | Memory protection active | EDR is blocking - good! |
| State file not found | Test not started | Wait for test to initialize |
| Partial restoration | Process no longer exists | Restart services or reboot |

### Test Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| Debug privilege denied | UAC or policy restriction | Run as Administrator |
| Function not found | Wrong Windows version | Check compatibility |
| Memory write blocked | EDR protection | Expected - test passed |
| Watchdog not running | Safety check failed | Start watchdog first |

## Integration with F0RT1KA Framework

### Exit Codes

```go
// Protected outcomes (GOOD)
Endpoint.ExecutionPrevented           // 126 - EDR blocked bypass
Endpoint.FileQuarantinedOnExtraction  // 105 - Binaries quarantined
Endpoint.FileQuarantinedOnExecution   // 127 - Detected during runtime

// Vulnerable outcome (BAD)
Endpoint.Unprotected                  // 101 - Bypass successful

// Errors
Endpoint.UnexpectedTestError          // 1   - Test error
Endpoint.TimeoutExceeded              // 102 - Watchdog timeout
```

### Integration Points

1. **Dropper**: Initializes test environment
2. **Endpoint.Say**: Logging and output
3. **Endpoint.Quarantined**: Check if files blocked
4. **Endpoint.Wait**: Timing between phases
5. **Endpoint.Stop**: Final result reporting

## Security Considerations

### What This Does NOT Do

❌ Compromise running MDE installation
❌ Disable antivirus permanently
❌ Create persistent backdoors
❌ Modify system files on disk
❌ Affect other processes
❌ Survive system reboot

### What This DOES Do

✅ Temporarily patch in-memory function
✅ Test EDR detection capabilities
✅ Demonstrate vulnerability impact
✅ Automatically restore original state
✅ Provide comprehensive logging
✅ Enable controlled security testing

## Conclusion

This recovery architecture provides multiple safety layers to ensure that advanced security testing can be performed with minimal risk. The combination of self-restoration, watchdog monitoring, and manual recovery tools creates a robust safety net for testing sophisticated attack techniques.

The architecture is designed with the principle of "defense in depth" - if one layer fails, others provide backup. This allows for realistic security testing while maintaining system integrity and providing clear rollback paths.
