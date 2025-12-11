# Multi-Stage Ransomware Killchain Simulation

## Overview
This test simulates a complete 5-stage ransomware attack killchain to evaluate EDR/AV effectiveness against modern ransomware campaigns. The test executes sequentially through initial access, privilege escalation, file discovery, encryption, and ransom note deployment - stopping at the first blocked stage to identify defensive gaps with precision.

**Test Score**: **8.5/10** - Advanced multi-stage killchain with realistic attack patterns and comprehensive safety mechanisms

**Score Breakdown**:
- **Real-World Accuracy: 2.5/3.0** - Simulates authentic ransomware behaviors (token manipulation, file discovery, encryption simulation) based on documented threat actors
- **Technical Sophistication: 2.5/3.0** - Multi-stage architecture with 5 distinct ATT&CK techniques, Windows API manipulation, AES-256 encryption simulation
- **Safety Mechanisms: 2.0/2.0** - Test-only directory, recovery script, no actual system damage, simulated destructive commands only
- **Detection Opportunities: 1.0/1.0** - 5 distinct detection points across killchain stages with clear behavioral indicators
- **Logging & Observability: 0.5/1.0** - Enhanced multi-stage logger with JSON/text output, stage tracking, phase logging (future: add more detailed process/file telemetry)

**Key Strengths**:
- Multi-stage architecture provides technique-level detection precision
- Realistic ransomware behaviors: privilege escalation, rapid file encryption, ransom notes
- Complete killchain coverage from initial access through impact
- Safe test environment with recovery mechanisms
- Comprehensive logging tracks exact blocking point in attack chain

## MITRE ATT&CK Mapping

This test covers a complete ransomware killchain across 5 stages:

**Stage 1: Initial Access/Execution**
- **Tactic**: Execution
- **Technique**: T1204.002 - User Execution: Malicious File
- **Description**: Simulates initial payload execution and component deployment

**Stage 2: Privilege Escalation**
- **Tactic**: Privilege Escalation
- **Technique**: T1134.001 - Access Token Manipulation
- **Description**: Attempts to elevate privileges via token manipulation and dangerous privilege enablement

**Stage 3: Discovery**
- **Tactic**: Discovery
- **Technique**: T1083 - File and Directory Discovery
- **Description**: Enumerates file system for high-value encryption targets

**Stage 4: Impact - Encryption** (CRITICAL DETECTION POINT)
- **Tactic**: Impact
- **Technique**: T1486 - Data Encrypted for Impact
- **Description**: Simulates rapid file encryption with AES-256

**Stage 5: Impact - Ransom Note**
- **Tactic**: Impact
- **Technique**: T1491.001 - Defacement: Internal Defacement
- **Description**: Deploys ransom notes and attempts system defacement

## Test Execution

The test executes as a sequential killchain:

1. **Stage 1** extracts and executes initial ransomware components
2. **Stage 2** attempts privilege escalation via token manipulation
3. **Stage 3** discovers and enumerates files for encryption
4. **Stage 4** performs rapid file encryption simulation (key detection point)
5. **Stage 5** deploys ransom notes to multiple locations

**Test stops at first blocked stage** - provides precise identification of where EDR prevented the attack.

## Expected Outcomes

### Protected System (Exit 126 or 105)
- **Most Common**: Stage 2 (privilege escalation) or Stage 4 (encryption) blocked by EDR
- EDR behavioral detection triggers on:
  - Token manipulation attempts
  - Rapid file operations (encryption pattern)
  - Mass file modifications
  - Ransomware note deployment
- Test stops immediately at first blocked stage
- Logs show exact technique that triggered protection

### Unprotected System (Exit 101)
- All 5 stages complete successfully
- Test files encrypted with .f0rtika extension
- Ransom notes deployed to desktop/documents
- System vulnerable to ransomware attacks
- **CRITICAL**: Immediate security review required

## Build Instructions

```bash
# Build all stages and main orchestrator with embedded signed binaries
cd /Users/jimx/Documents/F0RT1KA/f0_library
./tests_source/5ed12ef2-5e29-49a2-8f26-269d8e9edcea/build_all.sh

# The build process:
# 1. Builds 5 stage binaries (unsigned)
# 2. Signs all stage binaries with F0RT1KA certificate
# 3. Verifies signatures
# 4. Builds main orchestrator (embeds SIGNED stages)
# 5. Signs main binary
# 6. Cleans up temporary files

# Result: Single signed binary at build/5ed12ef2-5e29-49a2-8f26-269d8e9edcea/5ed12ef2-5e29-49a2-8f26-269d8e9edcea.exe
```

## Deployment

```powershell
# Copy single binary to target Windows system
scp build/5ed12ef2-5e29-49a2-8f26-269d8e9edcea/5ed12ef2-5e29-49a2-8f26-269d8e9edcea.exe target-host:C:\

# Run test (auto-extracts stages, executes killchain)
C:\5ed12ef2-5e29-49a2-8f26-269d8e9edcea.exe

# Check exit code
echo $LASTEXITCODE
# 101 = Vulnerable (all stages succeeded)
# 126 = Protected (stage blocked by EDR)
# 105 = Protected (stage binary quarantined)
# 999 = Test error
```

## Safety Features

This test includes multiple safety mechanisms:

1. **Test-Only Directory**: All operations confined to `C:\F0` and `C:\F0\test_documents`
2. **No Actual User Files**: Test creates its own files for encryption simulation
3. **Simulated Destructive Commands**: Shadow copy deletion and recovery disable are logged but NOT executed
4. **Recovery Script**: `ransomware_recovery.ps1` cleans all test artifacts
5. **Visual Markers**: Ransom notes clearly labeled as security test
6. **Reversible Actions**: All test modifications can be rolled back

## Recovery

If the test completes (system vulnerable), clean up with:

```powershell
# Run recovery script (automatically extracted during test)
powershell -ExecutionPolicy Bypass -File C:\F0\ransomware_recovery.ps1

# The recovery script:
# - Removes all test files
# - Deletes encrypted files
# - Removes ransom notes from desktop/documents
# - Clears test artifacts
# - Restores system to pre-test state
```

## Detection Opportunities

This test provides multiple detection opportunities across the killchain:

### Stage 1: Initial Execution
- File drops to suspicious directory
- Multiple component files created rapidly
- Process spawn behavior

### Stage 2: Privilege Escalation (CRITICAL)
- OpenProcessToken API calls
- Token manipulation attempts
- Access to SYSTEM processes (winlogon.exe, lsass.exe)
- Dangerous privilege enablement (SeDebugPrivilege, SeBackupPrivilege)

### Stage 3: File Discovery
- Aggressive file system enumeration
- Recursive directory traversal
- Target list file creation

### Stage 4: Encryption (CRITICAL)
- Rapid file read/write operations (10+ files/second)
- File extension changes (.f0rtika)
- Original file deletion
- High entropy file writes (encrypted data)
- Mass file operations pattern

### Stage 5: Ransom Note Deployment
- Multiple identical files written to different locations
- Desktop/Documents folder modifications
- Registry changes (wallpaper)
- Notepad.exe spawned with suspicious file

## Log Files

After execution, review comprehensive logs:

```
C:\F0\test_execution_log.json  # Machine-parseable JSON
C:\F0\test_execution_log.txt   # Human-readable text

Log includes:
- Exact stage where attack was blocked (if protected)
- Timestamps for each stage
- File operations performed
- Process executions
- Exit codes and blocking reasons
```

## Limitations

- **Scope**: Test operates only in C:\F0 directory for safety
- **Encryption**: Simulated on test files only, not actual user data
- **Network**: No actual C2 communication (simulated only)
- **Destructive Commands**: Shadow copy deletion/recovery disable are logged but NOT executed

## Recommendations

If this test succeeds (exit 101 - vulnerable):

1. **Immediate Actions**:
   - Enable ransomware behavioral detection in EDR
   - Review and strengthen application control policies
   - Verify backup and recovery procedures
   - Test recovery from encrypted state

2. **Configuration Review**:
   - Enable controlled folder access (Windows Defender)
   - Implement behavioral analysis rules
   - Restrict token manipulation
   - Monitor file operation patterns

3. **Long-term Improvements**:
   - Regular ransomware simulation testing
   - User security awareness training
   - Incident response plan validation
   - Offline backup verification

## Technical Notes

- **Architecture**: Multi-stage with 5 separate signed binaries
- **Binary Size**: ~2.8MB (includes all embedded stages)
- **Timeout**: 5 minutes (extended for multi-stage execution)
- **Exit Code Logic**: Evaluates actual stage results, stops at first block
- **Logging**: Enhanced multi-stage logger with stage tracking
- **Certificate**: Requires F0RT1KA certificate in Trusted Root store