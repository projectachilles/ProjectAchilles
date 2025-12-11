# SAFETY GUIDE - MDE Process Injection and API Authentication Bypass Test

## ⚠️ CRITICAL WARNING ⚠️

This test performs **ACTUAL PROCESS INJECTION and MEMORY MANIPULATION** of Microsoft Defender for Endpoint's security agent. While comprehensive safety mechanisms are in place, this test is inherently risky and must be treated with extreme caution.

**This is NOT a simulation** - this test performs real exploitation techniques against a live security product.

## Mandatory Prerequisites

### 1. Environment Requirements
- ✅ **Isolated Lab Environment**
  - Dedicated test VM or physical machine
  - NO production systems
  - NO systems with sensitive data
  - Air-gapped or isolated network segment preferred

- ✅ **VM Snapshot**
  - Take full VM snapshot BEFORE running test
  - Verify snapshot can be restored
  - Document snapshot name and timestamp

- ✅ **System Requirements**
  - Windows 10/11 or Windows Server 2016+
  - Microsoft Defender for Endpoint installed and running
  - MsSense.exe process active
  - Administrator account access

### 2. Privilege Requirements
- ✅ **Administrator Privileges REQUIRED**
  - Process injection requires elevated rights
  - Test will fail if not running as Administrator
  - UAC must allow elevation

### 3. Knowledge Requirements
- ✅ **Understanding of Risks**
  - Memory patching can cause system instability
  - Test modifies security-critical cryptographic functions
  - Failed restoration could compromise EDR functionality
  - Understand recovery procedures before starting

## Safety Architecture

This test implements a **three-layer safety architecture**:

### Layer 1: Watchdog Process
- **Purpose**: Automatic monitoring and restoration
- **Function**: Watches test process and restores memory if test crashes
- **Activation**: Automatically started during Phase 5
- **Timeout**: 300 seconds (5 minutes) default
- **Location**: C:\F0\mde_process_watchdog.exe

**How it Works**:
1. Watchdog monitors test process PID
2. Reads patch backup from C:\F0\patch_backup.json
3. If test crashes or times out, restores original bytes
4. Saves status to C:\F0\watchdog_state.json

### Layer 2: Deferred Recovery
- **Purpose**: Cleanup on normal exit or panic
- **Function**: Golang `defer` statements ensure restoration
- **Activation**: Automatic on any exit path
- **Scope**: Restores patches, closes handles, cleans up

**What Gets Cleaned Up**:
- All memory patches restored to original bytes
- Process handles closed
- Temporary files preserved for analysis

### Layer 3: Emergency Manual Recovery
- **Purpose**: Manual intervention if automatic systems fail
- **Function**: PowerShell script for forced restoration
- **Location**: C:\F0\emergency_restore.ps1
- **Usage**: `.\emergency_restore.ps1 -Force`

## Pre-Execution Checklist

Before running this test, verify ALL items:

- [ ] VM snapshot created and verified
- [ ] Running in isolated lab environment
- [ ] No production data on system
- [ ] MDE is installed (MsSense.exe running)
- [ ] Logged in as Administrator
- [ ] Read and understood this entire safety guide
- [ ] Emergency recovery script accessible
- [ ] Know how to restore from VM snapshot
- [ ] Network isolated or monitored
- [ ] Have documented recovery plan

## Normal Execution Procedure

### Step 1: Pre-Test Verification
```powershell
# Run as Administrator

# 1. Verify MDE is running
Get-Process MsSense -ErrorAction SilentlyContinue
# Should return process information

# 2. Verify Administrator privileges
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
# Should return True

# 3. Create test directory
New-Item -ItemType Directory -Path C:\F0 -Force

# 4. Verify watchdog will be available
Test-Path C:\F0\mde_process_watchdog.exe
# Will be extracted on first run
```

### Step 2: Execute Test
```cmd
# Run as Administrator
C:\fec68e9b-af59-40c1-abbd-98ec98428444.exe
```

### Step 3: Monitor Execution
Watch for these indicators:
- Phase completion messages
- Watchdog startup confirmation
- Memory patching status
- Normal test completion

### Step 4: Post-Test Verification
```powershell
# 1. Check if test completed normally
Get-Content C:\F0\test_execution_log.txt | Select-Object -Last 20

# 2. Verify watchdog state
Get-Content C:\F0\watchdog_state.json | ConvertFrom-Json

# 3. Check for active patches (should be none)
Test-Path C:\F0\patch_backup.json
# Should return False if properly restored

# 4. Verify MDE is still functioning
Get-Service Sense
# Should show Running status
```

## Emergency Recovery Procedures

### Scenario 1: Test Hangs or Freezes

**Symptoms**:
- Test stops progressing
- No console output for > 2 minutes
- Watchdog timeout approaching

**Actions**:
1. **Wait for watchdog** (up to 5 minutes)
   - Watchdog will automatically restore patches
   - Check C:\F0\watchdog_state.json for status

2. **If watchdog doesn't restore**:
   ```powershell
   # Force restoration
   cd C:\F0
   .\emergency_restore.ps1 -Force
   ```

3. **If emergency script fails**:
   ```powershell
   # Restart MDE service
   Restart-Service -Name Sense -Force
   ```

4. **Last resort**:
   - Restore from VM snapshot

### Scenario 2: Test Crashes

**Symptoms**:
- Test process terminates unexpectedly
- Error message displayed
- No cleanup performed

**Actions**:
1. **Check watchdog immediately**:
   ```powershell
   Get-Content C:\F0\watchdog_state.json
   ```

2. **If patches still active**:
   ```powershell
   .\emergency_restore.ps1 -Force
   ```

3. **Verify restoration**:
   ```powershell
   # Should return nothing (backup deleted after restore)
   Test-Path C:\F0\patch_backup.json
   ```

### Scenario 3: Memory Patch Persists

**Symptoms**:
- Patch backup file still exists: C:\F0\patch_backup.json
- MDE behaving abnormally
- Certificate validation errors in logs

**Actions**:
1. **Immediate restoration**:
   ```powershell
   cd C:\F0
   .\emergency_restore.ps1 -Force
   ```

2. **Verify MsSense.exe is running**:
   ```powershell
   Get-Process MsSense
   ```

3. **If process not running**:
   ```powershell
   # Restart service
   Restart-Service -Name Sense
   ```

4. **Verify restoration success**:
   ```powershell
   # Check MDE connectivity
   & "C:\Program Files\Windows Defender Advanced Threat Protection\MsSense.exe" -status
   ```

### Scenario 4: Cannot Access Emergency Script

**Symptoms**:
- emergency_restore.ps1 missing or inaccessible
- PowerShell execution policy blocking
- File corruption

**Actions**:
1. **Bypass execution policy**:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File C:\F0\emergency_restore.ps1 -Force
   ```

2. **If still failing**:
   ```powershell
   # Manual service restart
   Restart-Service -Name Sense -Force

   # Or full stop/start
   Stop-Service -Name Sense -Force
   Start-Sleep -Seconds 5
   Start-Service -Name Sense
   ```

3. **Nuclear option**:
   - Restore VM from snapshot
   - All changes will be lost

## Recovery Verification

After any recovery procedure, verify system health:

### 1. MDE Service Status
```powershell
Get-Service Sense | Format-List *
```
Expected: Status = Running

### 2. Process Health
```powershell
Get-Process MsSense, SenseIR -ErrorAction SilentlyContinue | Format-Table Id, ProcessName, StartTime
```
Expected: Processes running with recent start times

### 3. Connectivity Test
```powershell
# Check MDE cloud connectivity
Test-NetConnection winatp-gw-eus.microsoft.com -Port 443
```
Expected: TcpTestSucceeded = True

### 4. Event Log Check
```powershell
Get-WinEvent -LogName "Microsoft-Windows-SENSE/Operational" -MaxEvents 10 |
    Format-Table TimeCreated, Id, Message -Wrap
```
Expected: No critical errors after restoration

### 5. Clean State Verification
```powershell
# Verify no patch backups remain
Test-Path C:\F0\patch_backup.json
# Expected: False

# Check watchdog completed
Get-Content C:\F0\watchdog_state.json | ConvertFrom-Json | Select-Object status, patchesRestored
# Expected: status = completed, patchesRestored = true (if patches were applied)
```

## What Can Go Wrong

### Risk 1: System Instability
**Cause**: Memory patch not properly restored
**Impact**: MDE may malfunction or crash
**Mitigation**: Three-layer safety architecture
**Recovery**: Emergency restore or service restart

### Risk 2: EDR Functionality Loss
**Cause**: CRYPT32 patch persists, breaking TLS validation
**Impact**: MDE cannot communicate with cloud
**Mitigation**: Watchdog auto-restore, timeout limits
**Recovery**: Emergency script or VM snapshot

### Risk 3: Process Crash
**Cause**: Invalid memory access, race condition
**Impact**: Test terminates, patches may persist
**Mitigation**: Watchdog monitors for process termination
**Recovery**: Watchdog auto-restores

### Risk 4: False Positives
**Cause**: EDR detects test as malicious
**Impact**: Test quarantined, cannot complete
**Mitigation**: This is actually desired (shows EDR working)
**Recovery**: Not needed - system protected itself

## Best Practices

### DO:
✅ Take VM snapshot before every test run
✅ Run in completely isolated environment
✅ Read all logs after test completion
✅ Verify restoration after every run
✅ Document all issues encountered
✅ Have recovery plan ready
✅ Monitor test execution actively
✅ Check watchdog status

### DON'T:
❌ Run on production systems
❌ Run without VM snapshot
❌ Run without Administrator privileges
❌ Interrupt watchdog during restoration
❌ Delete watchdog_state.json while running
❌ Modify test code without understanding
❌ Run multiple instances simultaneously
❌ Ignore error messages

## Troubleshooting

### Issue: "Administrator privileges required"
**Solution**: Run cmd.exe as Administrator, then execute test

### Issue: "MsSense.exe not found"
**Solution**: Verify MDE is installed and running
```powershell
Get-Service Sense
Get-Process MsSense
```

### Issue: "Failed to extract components"
**Solution**: Verify C:\F0 is writable
```powershell
New-Item -ItemType Directory -Path C:\F0 -Force
```

### Issue: "Watchdog failed to start"
**Solution**: Verify watchdog was extracted
```powershell
Test-Path C:\F0\mde_process_watchdog.exe
```

### Issue: Test times out
**Solution**: Normal for complex tests, watchdog will handle cleanup

### Issue: "Access Denied" errors
**Solution**: This is GOOD - means EDR is protecting itself

## Post-Test Cleanup

After test completion (whether successful or not):

1. **Review logs**:
   ```powershell
   Get-Content C:\F0\test_execution_log.txt
   Get-Content C:\F0\process_injection_report.json
   Get-Content C:\F0\memory_patch_report.json
   ```

2. **Verify clean state**:
   ```powershell
   # No active patches
   Test-Path C:\F0\patch_backup.json  # Should be False

   # MDE running normally
   Get-Service Sense  # Should be Running
   ```

3. **Archive results**:
   ```powershell
   # Copy all logs to archive location
   Copy-Item C:\F0\*.json, C:\F0\*.txt $env:USERPROFILE\Desktop\test_results\
   ```

4. **Optional: Clean test directory**:
   ```powershell
   # Only after archiving results!
   Remove-Item C:\F0\* -Force -Recurse
   ```

## Support and Questions

If you encounter issues not covered in this guide:

1. Check test_execution_log.json for detailed error information
2. Review watchdog_state.json for safety system status
3. Consult F0RT1KA framework documentation
4. Report issues at https://github.com/anthropics/claude-code/issues

## Legal and Ethical Notice

This test is for **authorized security testing only**:
- Use only in controlled lab environments
- Only on systems you own or have explicit permission to test
- Understand legal implications in your jurisdiction
- Follow responsible disclosure practices
- Do not use for malicious purposes

## Acknowledgments

This test is based on vulnerability research by InfoGuard Labs (October 2024).
See: https://labs.infoguard.ch/posts/attacking_edr_part5_vulnerabilities_in_defender_for_endpoint_communication/
