# LimaCharlie Timeout Validation Harness

**Test Score**: **5.0/10**

## Overview

This is a **utility test** designed to validate that LimaCharlie's `--timeout` parameter works correctly for long-running security tests. It is not a security simulation but rather a diagnostic tool.

## Purpose

When deploying F0RT1KA security tests via LimaCharlie, long-running tests may exceed the default task timeout (~3-5 minutes), causing:
- RECEIPT events with exit code **259** (`STILL_ACTIVE`) instead of actual test results
- Missing stdout/stderr in RECEIPT events

This validation harness allows you to:
1. Confirm whether `--timeout` parameter extends the execution window
2. Determine the maximum effective timeout value
3. Validate that full test results are delivered in RECEIPT events

## Test Behavior

The test consists of 3 sequential stages:
- **Stage 1**: Waits 2 minutes, logs progress every 30s, exits with code 101
- **Stage 2**: Waits 2 minutes, logs progress every 30s, exits with code 101
- **Stage 3**: Waits 2 minutes, logs progress every 30s, exits with code 101

**Total runtime**: ~6 minutes
**Final exit code**: 101 (Endpoint.Unprotected)

## MITRE ATT&CK Mapping

| Technique | Name | Description |
|-----------|------|-------------|
| T1497.001 | Virtualization/Sandbox Evasion: System Time | Timing-based behavior validation |

## Usage

### Build
```bash
./build_all.sh              # F0RT1KA-only signing
./build_all.sh --org sb     # Dual signing for SB organization
```

### Deploy and Test
```bash
# Deploy binary to endpoint via LimaCharlie payload or other method

# Run with 7-minute timeout (should succeed)
limacharlie sensors task <sensor-id> "run --payload-name timeout-harness --timeout 420"

# Run with 3-minute timeout (should fail with 259)
limacharlie sensors task <sensor-id> "run --payload-name timeout-harness --timeout 180"

# Run without timeout (should fail with default timeout)
limacharlie sensors task <sensor-id> "run --payload-name timeout-harness"
```

### Expected Results

| Scenario | --timeout | Expected RECEIPT Exit Code |
|----------|-----------|---------------------------|
| Timeout works | 420 (7 min) | **101** (test completed) |
| Timeout too short | 180 (3 min) | **259** (STILL_ACTIVE) |
| No timeout | (default) | **259** (STILL_ACTIVE) |

If you see exit code **101** with `--timeout 420`, the parameter is working correctly and you can use it for real long-running tests.

## Files

| File | Purpose |
|------|---------|
| `12afe0fc-597b-4e79-9cc4-40b4675ee83c.go` | Main orchestrator |
| `stage-T1497.001-1.go` | Stage 1 binary source |
| `stage-T1497.001-2.go` | Stage 2 binary source |
| `stage-T1497.001-3.go` | Stage 3 binary source |
| `test_logger.go` | Schema v2.0 logging |
| `org_resolver.go` | Organization registry |
| `build_all.sh` | Build script |

## Exit Codes

- **101** (Endpoint.Unprotected): Test completed successfully - all stages executed
- **999** (Endpoint.UnexpectedTestError): Test error (e.g., stage extraction failed)
- **259**: Windows STILL_ACTIVE - process was still running when LC checked exit code

## Notes

- This is a diagnostic/utility test, not a security simulation
- The 5.0/10 score reflects its utility nature
- All stages exit with code 101 to simulate "unprotected" outcome
- Full Schema v2.0 logging is implemented for consistency with real tests
