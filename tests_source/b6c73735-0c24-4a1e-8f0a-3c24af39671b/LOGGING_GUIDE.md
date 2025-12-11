# Test Execution Logging Guide

## Overview

All F0RT1KA tests now include comprehensive structured logging that provides complete audit trails, forensic analysis capabilities, and professional reporting. The MDE Authentication Bypass test demonstrates this logging system.

## Log Files Generated

After each test execution, two log files are created in `C:\F0\`:

### 1. `test_execution_log.json` (Machine-Parseable)
- Structured JSON format
- Easy to parse with scripts/tools
- Contains all test data with precise typing
- Ideal for automated analysis and reporting

### 2. `test_execution_log.txt` (Human-Readable)
- Formatted text output
- Easy to read and analyze manually
- Complete timeline with timestamps
- Ideal for manual review and debugging

## What Gets Logged

### Test Metadata
- Test ID and name
- Start/end times with millisecond precision
- Total duration
- Exit code and reason
- System information (OS, architecture, MDE status, etc.)

### System Information
```
Hostname:          TESTVM-01
OS Version:        Microsoft Windows [Version 10.0.19045.2006]
Architecture:      AMD64
Username:          Administrator
Administrator:     true
Process ID:        4532
Defender Running:  true
MDE Installed:     true
MDE Version:       10.8210.19041.1000
```

### Phase Execution
Each test phase is tracked with:
- Phase number and name
- Start/end timestamps
- Duration in milliseconds
- Status (success, failed, blocked, skipped)
- Detailed description
- Any errors encountered

Example phases for MDE test:
1. Initialization
2. File Drop Operations
3. Command Interception
4. Isolation Status Spoofing
5. Configuration Exfiltration
6. Post-Execution Detection
7. Final Assessment

### File Operations
Every file drop is logged:
```json
{
  "filename": "fake_mssense.exe",
  "path": "C:\\F0\\fake_mssense.exe",
  "size": 2834432,
  "quarantined": false,
  "timestamp": "2025-01-23T14:32:15.123Z"
}
```

### Process Executions
All process launches are tracked:
```json
{
  "processName": "powershell.exe",
  "commandLine": "powershell.exe -ExecutionPolicy Bypass -File script.ps1",
  "pid": 5432,
  "success": true,
  "exitCode": 0,
  "timestamp": "2025-01-23T14:32:16.456Z"
}
```

### Detailed Message Timeline
All `Endpoint.Say()` and `LogMessage()` calls are captured:
```
[14:32:15.123] [INFO    ] [Initialization          ] Test logger initialized
[14:32:15.234] [INFO    ] [Initialization          ] Running as: Administrator (Admin: true)
[14:32:15.345] [INFO    ] [File Drop Operations    ] Dropping attack components
[14:32:16.456] [WARN    ] [Command Interception    ] Waiting for interceptor (5 seconds)
[14:32:21.567] [ERROR   ] [Post-Execution Detection] PowerShell interceptor terminated
[14:32:21.678] [CRITICAL] [Final Assessment        ] System is UNPROTECTED
```

## Example Log Outputs

### Protected System (Successful Defense)

**Exit Code**: 126 (Execution Prevented)

**Phase Summary**:
```
Phase 1: Initialization         [success]  245ms
Phase 2: File Drop Operations   [success]  3,124ms
Phase 3: Command Interception   [blocked]  5,432ms - Interceptor blocked by EDR
```

**Key Messages**:
```
[14:32:18.123] [INFO ] [File Drop Operations] File dropped: fake_mssense.exe (2834KB)
[14:32:21.234] [ERROR] [Command Interception] Interceptor status file not found
[14:32:21.345] [INFO ] [Command Interception] EDR may have blocked execution
```

**Exit Reason**: "Interceptor blocked by EDR"

### Vulnerable System (Attack Successful)

**Exit Code**: 101 (Unprotected)

**Phase Summary**:
```
Phase 1: Initialization              [success]  234ms
Phase 2: File Drop Operations        [success]  2,987ms
Phase 3: Command Interception        [success]  5,123ms
Phase 4: Isolation Status Spoofing   [success]  1,456ms
Phase 5: Configuration Exfiltration  [success]  234ms
Phase 6: Post-Execution Detection    [success]  5,012ms
Phase 7: Final Assessment            [success]  45ms
```

**Key Messages**:
```
[14:32:18.123] [INFO    ] [File Drop Operations] All files dropped successfully
[14:32:23.234] [INFO    ] [Command Interception] PowerShell interceptor running
[14:32:24.345] [INFO    ] [Isolation Status Spoofing] Successfully spoofed isolation
[14:32:28.456] [INFO    ] [Post-Execution Detection] No detection observed
[14:32:28.501] [CRITICAL] [Final Assessment] System is UNPROTECTED
```

**Exit Reason**: "MDE authentication bypass successful - system unprotected"

### Partial Execution (File Quarantined)

**Exit Code**: 105 (File Quarantined On Extraction)

**Phase Summary**:
```
Phase 1: Initialization         [success]  198ms
Phase 2: File Drop Operations   [blocked]  3,456ms - Fake MsSense quarantined
```

**Key Messages**:
```
[14:32:18.123] [INFO ] [File Drop Operations] File dropped: fake_mssense.exe
[14:32:21.234] [WARN ] [File Drop Operations] Checking for quarantine (3 second wait)
[14:32:24.345] [ERROR] [File Drop Operations] Fake MsSense was quarantined
[14:32:24.456] [INFO ] [File Drop Operations] File quarantined: fake_mssense.exe
```

**Exit Reason**: "Fake MsSense quarantined before execution"

## Using Logs for Analysis

### 1. Quick Status Check
```powershell
# Check exit code
$log = Get-Content C:\F0\test_execution_log.json | ConvertFrom-Json
Write-Host "Exit Code: $($log.exitCode)"
Write-Host "Exit Reason: $($log.exitReason)"
Write-Host "Duration: $($log.durationMs)ms"
```

### 2. Phase Analysis
```powershell
# List all phases and their status
$log.phases | ForEach-Object {
    Write-Host "Phase $($_.phaseNumber): $($_.phaseName) - $($_.status) ($($_.durationMs)ms)"
}
```

### 3. Find Errors
```powershell
# Extract all error messages
$log.messages | Where-Object { $_.level -eq "ERROR" -or $_.level -eq "CRITICAL" } |
    ForEach-Object {
        Write-Host "[$($_.timestamp)] [$($_.level)] $($_.message)"
    }
```

### 4. File Operation Summary
```powershell
# Check which files were quarantined
$log.filesDropped | Where-Object { $_.quarantined } | ForEach-Object {
    Write-Host "Quarantined: $($_.filename) at $($_.timestamp)"
}
```

### 5. Process Execution Analysis
```powershell
# Check failed processes
$log.processesExecuted | Where-Object { -not $_.success } | ForEach-Object {
    Write-Host "Failed: $($_.processName) - $($_.errorMsg)"
}
```

## Log Retention and Management

### Recommended Practices

1. **Archive Logs**: Save logs for each test run with timestamps
   ```powershell
   $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
   Copy-Item C:\F0\test_execution_log.json "C:\TestLogs\mde_test_$timestamp.json"
   ```

2. **Aggregate Results**: Combine logs from multiple test runs for trend analysis

3. **Automate Analysis**: Use the JSON logs with PowerShell or Python scripts

4. **Store Safely**: Keep logs in secure locations as they contain test details

## Benefits

### For Security Testing
- **Complete Audit Trail**: Know exactly what happened during each test
- **Reproducibility**: Detailed logs help reproduce issues
- **Compliance**: Meet documentation requirements for security assessments

### For Debugging
- **Precise Timing**: Millisecond-level timestamps help identify bottlenecks
- **Phase Isolation**: Quickly identify which phase failed
- **Error Context**: Full context around each error

### For Reporting
- **Professional Output**: Generate reports directly from JSON logs
- **Stakeholder Communication**: Human-readable text logs for management
- **Trend Analysis**: Track detection improvements over time

## Advanced Features

### Custom Log Analysis

The JSON structure allows for sophisticated analysis:

```python
import json

# Load log
with open('C:\\F0\\test_execution_log.json', 'r') as f:
    log = json.load(f)

# Calculate phase durations
phase_times = {
    phase['phaseName']: phase['durationMs']
    for phase in log['phases']
}

# Find slowest phase
slowest = max(phase_times.items(), key=lambda x: x[1])
print(f"Slowest phase: {slowest[0]} ({slowest[1]}ms)")

# Count events by level
from collections import Counter
event_counts = Counter(msg['level'] for msg in log['messages'])
print(f"Event distribution: {dict(event_counts)}")
```

### Integration with SIEM

The structured JSON format can be ingested into SIEM platforms:

- **Splunk**: Use HTTP Event Collector to send logs
- **Elk Stack**: Index logs with Logstash
- **Azure Sentinel**: Upload to Log Analytics workspace
- **Custom Systems**: Parse JSON with any language

## Troubleshooting

### Log Not Created

**Cause**: Test crashed before `SaveLog()` was called

**Solution**: Check for panic in console output, use the defer/recover pattern

### Incomplete Logs

**Cause**: Test was forcibly terminated

**Solution**: Logs are written at the end; partial execution won't have complete logs

### Missing Phase Data

**Cause**: Logger not properly initialized

**Solution**: Ensure `InitLogger()` is called at start of test

## Summary

The F0RT1KA logging system provides:
- ✅ Complete audit trails with millisecond precision
- ✅ Human-readable and machine-parseable formats
- ✅ Detailed phase tracking and error reporting
- ✅ File and process operation logging
- ✅ Professional reporting capabilities
- ✅ Easy integration with analysis tools

All future F0RT1KA tests should implement this logging pattern for consistency and professional security testing documentation.
