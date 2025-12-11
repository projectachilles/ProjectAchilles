# Long-Running Test Solution for F0RT1KA Framework

## Problem
The Endpoint framework has a **hardcoded 30-second timeout** (line 307 in `endpoint.go`) that cannot be overridden. This prevents tests requiring more than 30 seconds from completing properly, always resulting in exit code 102 (TimeoutExceeded).

The SafePay ransomware simulation requires 4+ minutes to complete all phases:
1. Mass file creation (500-1500 files)
2. Multi-phase compression operations
3. Mass file deletion
4. File encryption
5. Ransom note creation

## Solution: Custom Test Runner

Instead of using `Endpoint.Start(test)` which enforces the 30-second limit, we implemented a custom runner in `main()` that:

1. **Bypasses Endpoint.Start()** entirely
2. **Implements custom timeout logic** (5 minutes)
3. **Maintains compatibility** with Endpoint logging and exit codes
4. **Monitors all simulation phases** to completion

### Implementation

```go
func main() {
    // CUSTOM RUNNER: Bypass Endpoint.Start() to avoid 30-second timeout limitation
    Endpoint.Say("Starting test at: %s", time.Now().Format("2006-01-02T15:04:05"))
    Endpoint.Say("Using custom runner with extended timeout for long-running simulation")
    
    done := make(chan bool, 1)
    go func() {
        test()
        done <- true
    }()
    
    select {
    case <-done:
        Endpoint.Say("Test completed within timeout window")
    case <-time.After(5 * time.Minute):
        Endpoint.Say("Test timed out after 5 minutes")
        Endpoint.Stop(Endpoint.TimeoutExceeded)
    }
}
```

## Result Codes

With the extended monitoring, the test can now properly return:

- **101** (Unprotected) - Full simulation completed, all phases executed
- **106** (ExecutionPrevented) - EDR detected and blocked the simulation
- **126** (ExecutionPrevented) - PowerShell process terminated during execution
- **105** (FileQuarantinedOnExtraction) - Components quarantined before execution

## Phase Tracking

The test tracks 5 distinct phases via status file (`C:\F0\status.txt`):

1. **STARTED** - Script initialization
2. **FILES_CREATED:N** - Mass file creation completed (N files)
3. **COMPRESSION_DONE** - Multi-phase archiving completed
4. **RANSOM_NOTE_CREATED** - Ransom note deployed
5. **COMPLETED:N** - Full simulation finished (N files encrypted)

## Key Changes

1. **Extended monitoring**: 240 seconds instead of 22 seconds
2. **Progress reporting**: Every 30 seconds instead of 5
3. **Early exit**: Breaks loop when COMPLETED phase detected
4. **Clear success criteria**: Only declares success on full completion
5. **Better EDR detection**: Tracks which phases completed before termination

## Usage

This approach can be applied to any long-running test in the F0RT1KA framework:

1. Replace `Endpoint.Start(test)` with custom runner in `main()`
2. Adjust timeout as needed (e.g., `10 * time.Minute`)
3. Implement phase tracking for progress monitoring
4. Use status files for inter-process communication

## Future Considerations

- Consider forking the Endpoint library to add configurable timeouts
- Standardize this pattern for all long-running tests
- Add a `LongRunningTest` helper function to the framework