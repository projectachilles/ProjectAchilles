# MDE Process Injection and API Authentication Bypass

## Overview
**Advanced** security test that replicates real-world MDE exploitation techniques discovered by InfoGuard Labs. Unlike simulation-based tests, this performs **actual process injection attempts** against the running MsSense.exe process, **real memory patching** of CRYPT32 functions, and **live API command interception** using production MDE endpoints.

**Test Score**: **9.7/10** - Production-accurate attack chain with advanced safety mechanisms

**Score Breakdown**:
- **Real-World Accuracy: 3.0/3.0** - Interacts with actual running MsSense.exe process; attempts real process injection and memory manipulation; performs live API race conditions against production endpoints
- **Technical Sophistication: 3.0/3.0** - Process handle acquisition with multiple privilege levels; memory patching of CRYPT32!CertVerifyCertificateChainPolicy; API command interception race conditions; proxy configuration for traffic interception
- **Safety Mechanisms: 2.0/2.0** - Three-layer protection: watchdog process monitoring + deferred recovery + emergency PowerShell script; automatic memory restoration; timeout protections
- **Detection Opportunities: 1.0/1.0** - 11 distinct phases with clear detection points across process injection, memory manipulation, network interception, and API abuse
- **Logging & Observability: 0.7/1.0** - Enhanced logging with memory addresses, patch bytes, API responses, process handles, and complete forensic timeline

**Key Strengths**:
- Real MsSense.exe process interaction (not simulation)
- Actual memory manipulation attempts with safety rollback
- Live API race conditions testing production vulnerability
- Production-accurate attack chain based on published research
- Three-layer safety architecture ensuring reversibility

## Key Improvements Over Previous Tests

| Aspect | Previous Test (b6c73735) | This Test (fec68e9b) |
|--------|--------------------------|----------------------|
| **MsSense.exe Usage** | Drops fake binary, never executes | **Interacts with REAL running MsSense.exe process** |
| **Process Injection** | Not tested | **Tests handle acquisition, memory read/write, thread creation** |
| **Memory Patching** | Simulated only | **Attempts real CRYPT32!CertVerifyCertificateChainPolicy patching** |
| **API Testing** | Network requests only | **Command interception with race condition exploitation** |
| **Attack Realism** | Simulation-focused | **Production-accurate exploitation chain** |
| **Detection Points** | 9 phases | **11 phases with enhanced process-level detection** |

## MITRE ATT&CK Mapping
- **Tactic**: Defense Evasion, Privilege Escalation
- **Technique**: T1055 - Process Injection
- **Sub-Technique**: T1055.001 - Dynamic-link Library Injection
- **Technique**: T1562.001 - Impair Defenses: Disable or Modify Tools
- **Technique**: T1014 - Rootkit (Memory patching)
- **Technique**: T1557 - Adversary-in-the-Middle (Proxy interception)
- **Technique**: T1071.001 - Application Layer Protocol: Web Protocols
- **Technique**: T1140 - Deobfuscate/Decode Files or Information

## Prerequisites

### CRITICAL REQUIREMENTS
- **Microsoft Defender for Endpoint MUST be installed**
- **Administrator privileges REQUIRED** (process injection requires elevated rights)
- **Isolated lab environment** (VM with snapshot recommended)
- **MsSense.exe MUST be running** (test will fail if not found)

### System Requirements
- Windows 10/11 or Windows Server 2016+
- MDE fully onboarded to tenant
- Administrative PowerShell access
- Network connectivity to winatp-gw-*.microsoft.com endpoints

## Key Features

### Real MDE Process Interaction
- Enumerates running MsSense.exe and SenseIR.exe processes
- Extracts actual process details (PID, parent, architecture, module list)
- **100% Real**: Operates on production MDE agent, not simulation

### Actual Process Injection Testing
- Attempts to acquire process handles with escalating privileges
- Tests `PROCESS_VM_READ`, `PROCESS_VM_WRITE`, `PROCESS_VM_OPERATION`
- Tries `PROCESS_CREATE_THREAD` for remote thread injection
- **Detection Point**: EDR should block privileged access to its own process

### Real Memory Manipulation
- Locates CRYPT32.dll in MsSense.exe memory space
- Finds `CertVerifyCertificateChainPolicy` function address
- Attempts to patch function with `xor eax,eax; inc eax; ret` (always return success)
- **Reversible**: All patches auto-restored by watchdog

### Live API Command Interception
- Spawns background goroutine racing `/edr/commands/cnc` endpoint
- Sends rapid unauthenticated requests using real Machine ID/Tenant ID
- Attempts to steal commands before legitimate MsSense.exe process
- **Detection Point**: Unauthenticated API abuse and command theft

### Comprehensive Testing (11 Phases)
1. **Phase 1**: Prerequisites & environment validation
2. **Phase 2**: MDE process discovery and enumeration
3. **Phase 3**: Process handle acquisition attempts
4. **Phase 4**: Memory enumeration and CRYPT32 analysis
5. **Phase 5**: Memory patching with watchdog protection
6. **Phase 6**: Network proxy configuration testing
7. **Phase 7**: API command interception race conditions
8. **Phase 8**: CloudLR token generation bypass
9. **Phase 9**: Isolation command spoofing
10. **Phase 10**: Configuration exfiltration (8MB config)
11. **Phase 11**: Final verification and cleanup

## Expected Outcomes

### Protected System (GOOD) ✅
- **Phase 3**: Process handle acquisition blocked (access denied)
- **Phase 5**: Memory patching prevented (write protection or detection)
- **Phase 7-10**: API requests return 401/403 Unauthorized
- **Exit Code**: 126 (Execution Prevented) or 127 (Quarantined)

### Vulnerable System (BAD) ⚠️
- **Phase 3**: Full process access granted to MsSense.exe
- **Phase 5**: Memory patches successfully written
- **Phase 7**: Commands intercepted before legitimate agent
- **Phase 10**: 8MB configuration file exfiltrated
- **Exit Code**: 101 (Unprotected)

### Partial Protection (MIXED) 🔶
- Process access blocked BUT API authentication missing
- Memory patching prevented BUT configuration accessible
- **Exit Code**: Depends on which protection failed

## Build Instructions

### Automated Build (Recommended)
```bash
# Build single self-contained binary with all components embedded
./tests_source/fec68e9b-af59-40c1-abbd-98ec98428444/build_all.sh
```

**This creates a SINGLE BINARY (~30MB) containing:**
- Main test logic with 11-phase orchestration
- Watchdog binary (mde_process_watchdog.exe)
- Emergency recovery script (emergency_restore.ps1)
- All helper modules (process injection, memory patching, API interceptor)
- Comprehensive logging infrastructure

**Result:** Only ONE .exe file needed for deployment!

### Manual Build
```bash
# Build watchdog binary first
cd tests_source/fec68e9b-af59-40c1-abbd-98ec98428444/
GOOS=windows GOARCH=amd64 go build -o mde_process_watchdog.exe mde_process_watchdog.go

# Build main test with all components embedded
GOOS=windows GOARCH=amd64 go build -o ../../build/fec68e9b-af59-40c1-abbd-98ec98428444/fec68e9b-af59-40c1-abbd-98ec98428444.exe \
  fec68e9b-af59-40c1-abbd-98ec98428444.go \
  test_logger.go \
  process_injection.go \
  memory_patcher.go \
  api_interceptor.go

# Clean up temporary files
rm -f mde_process_watchdog.exe
cd ../../..

# Optional: Sign the test binary
./utils/codesign sign build/fec68e9b-af59-40c1-abbd-98ec98428444/fec68e9b-af59-40c1-abbd-98ec98428444.exe
```

### Deployment
**IMPORTANT:** You only need to deploy the single `.exe` file!

```bash
# Copy single binary to target system
scp build/fec68e9b-af59-40c1-abbd-98ec98428444/fec68e9b-af59-40c1-abbd-98ec98428444.exe target-host:C:\
```

The binary will automatically extract watchdog and recovery script to `C:\F0` on first run.

## Usage Instructions

### ⚠️ CRITICAL SAFETY WARNING ⚠️
**READ `SAFETY_GUIDE.md` BEFORE EXECUTING THIS TEST!**

This test performs **ACTUAL PROCESS INJECTION and MEMORY MANIPULATION** on a live EDR agent. While safety mechanisms are in place, this is inherently risky.

**Mandatory Precautions:**
1. **Take VM snapshot** before running
2. **Test in isolated lab only** (no production systems)
3. **Verify watchdog is working** before aggressive modes
4. **Have emergency_restore.ps1 ready** for manual recovery
5. **Run as Administrator** (required for process injection)

### Basic Test Execution
```cmd
# Run test (requires Administrator privileges)
# Run as Administrator
fec68e9b-af59-40c1-abbd-98ec98428444.exe

# On first run, the test will:
# 1. Verify MDE is installed (fail if not found)
# 2. Extract watchdog and recovery script to C:\F0
# 3. Enumerate running MsSense.exe process
# 4. Attempt process injection (EDR should block!)
# 5. Attempt memory patching (EDR should prevent!)
# 6. Test API authentication bypass
# 7. Generate comprehensive execution logs
```

### Test Modes
```cmd
# Standard mode (default - aggressive with watchdog)
fec68e9b-af59-40c1-abbd-98ec98428444.exe

# Test-only mode (safer - checks permissions without actual injection)
fec68e9b-af59-40c1-abbd-98ec98428444.exe --mode=test-only

# Skip memory patching (test process injection only)
fec68e9b-af59-40c1-abbd-98ec98428444.exe --skip-memory-patch

# Skip API testing (test process injection only)
fec68e9b-af59-40c1-abbd-98ec98428444.exe --skip-api-tests

# Verbose output
fec68e9b-af59-40c1-abbd-98ec98428444.exe --verbose
```

### Emergency Recovery
If the test crashes or leaves memory patches active:

```powershell
# Emergency recovery (run as Administrator)
C:\F0\emergency_restore.ps1 -Force

# This will:
# 1. Locate MsSense.exe process
# 2. Restore original CRYPT32 function bytes
# 3. Verify restoration succeeded
# 4. Restart MDE services if needed
```

### Test Results
After execution, check these files in `C:\F0\`:
- **`test_execution_log.json`** - Comprehensive execution log (JSON format)
- **`test_execution_log.txt`** - Comprehensive execution log (human-readable)
- **`process_injection_report.json`** - Process handle acquisition results
- **`memory_patch_report.json`** - Memory patching attempt details
- **`api_interception_report.json`** - API command interception results
- **`mde_identifiers.json`** - Extracted MDE identifiers
- **`attack_summary.txt`** - Overall test summary with all 11 phases

### Execution Logs
All test executions generate comprehensive logs tracking:
- All 11 test phases with timing and status
- System information (OS, MDE version, privileges, process architecture)
- Process handle acquisition attempts and results
- Memory addresses, function locations, patch bytes
- API requests, responses, stolen commands
- Complete message timeline with millisecond precision
- Exit code and reason

**Log Locations**:
- JSON: `C:\F0\test_execution_log.json` (machine-parseable)
- Text: `C:\F0\test_execution_log.txt` (human-readable)

## Vulnerability Background
Based on InfoGuard Labs research (October 2024) identifying critical flaws in MDE's cloud communication and process protection:

**Process Protection Issues:**
- MsSense.exe insufficiently protected against injection on some configurations
- Memory patching of CRYPT32 functions possible via standard injection techniques
- Certificate pinning bypassable through memory manipulation

**API Authentication Issues:**
- `/edr/commands/cnc` endpoint ignores authorization tokens
- Attackers can intercept commands with just machine ID and tenant ID
- Configuration files containing detection rules accessible without authentication
- CloudLR tokens obtainable without proper authentication

**Key Finding**: Backend completely ignores `Authorization` and `Msadeviceticket` headers, allowing unauthenticated command interception. Combined with insufficient process protection, enables complete EDR compromise.

## Detection Opportunities

### Process-Level Detection
1. **Process Enumeration**: Suspicious enumeration of MsSense.exe/SenseIR.exe
2. **Handle Acquisition**: Attempts to open privileged handles to EDR processes
3. **Memory Access**: Reading memory of security agent processes
4. **Memory Manipulation**: Writing to CRYPT32.dll or other security modules
5. **Thread Injection**: CreateRemoteThread attempts targeting MsSense.exe

### Network-Level Detection
6. **Proxy Configuration**: Suspicious `netsh winhttp set proxy` commands
7. **Certificate Errors**: Abnormal TLS validation failures in MDE communication
8. **Unauthenticated Requests**: API calls missing proper authentication headers
9. **Command Theft**: Duplicate requests to `/edr/commands/cnc` endpoint
10. **Token Abuse**: CloudLR token requests without valid authentication

### Behavioral Detection
11. **Configuration Access**: 8MB config file retrieval patterns
12. **Isolation Bypass**: Device shows isolated but maintains connectivity
13. **Correlation**: Multiple suspicious activities in rapid succession

## Safety Notes
⚠️ **CRITICAL SAFETY REQUIREMENTS**:
- Run in **isolated lab/VM environment ONLY**
- Take **VM snapshot** before testing
- Read **`SAFETY_GUIDE.md`** completely before execution
- **Administrator privileges** required (test will fail without)
- **MDE must be installed** (test will exit if not found)
- Use watchdog for all aggressive testing
- Emergency recovery: `.\emergency_restore.ps1 -Force`
- Maximum patch duration: 30 seconds (auto-rollback)

## References
- [InfoGuard Labs - MDE Authentication Bypass Research](https://labs.infoguard.ch/posts/attacking_edr_part5_vulnerabilities_in_defender_for_endpoint_communication/)
- [MITRE ATT&CK - T1055 Process Injection](https://attack.mitre.org/techniques/T1055/)
- [MITRE ATT&CK - T1562.001 Impair Defenses](https://attack.mitre.org/techniques/T1562/001/)
- [Microsoft Security Response Center - MDE Vulnerabilities](https://msrc.microsoft.com/)

## Test Version History
- **v1.0** (2025-01-24) - Initial implementation with real process injection and memory patching
- Test Score: **9.7/10** - Production-accurate attack chain

## License
This test is provided for authorized security testing only. See F0RT1KA framework license for details.
