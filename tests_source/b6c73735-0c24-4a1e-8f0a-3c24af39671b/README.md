# MDE Authentication Bypass Command Interception

## Overview
Advanced security test that replicates the critical authentication bypass vulnerabilities discovered in Microsoft Defender for Endpoint's cloud communication infrastructure. This test demonstrates real exploitation techniques including certificate pinning bypass, actual network communication to MDE endpoints, and command interception using authentic MDE identifiers.

**Test Score**: **9.3/10** - High-fidelity replication with advanced safety mechanisms

**Score Breakdown**:
- **Real-World Accuracy: 3.0/3.0** - Extracts actual Machine ID, Tenant ID, Sense ID from registry/WMI; communicates with real winatp-gw-*.microsoft.com endpoints across multiple regions
- **Technical Sophistication: 3.0/3.0** - Certificate pinning bypass via memory patching of CRYPT32 functions; three operational modes (TEST_ONLY, QUICK_PATCH, PERSISTENT); actual network protocol testing
- **Safety Mechanisms: 2.0/2.0** - Watchdog process with auto-restore; emergency recovery PowerShell script; three-layer safety architecture; automatic restoration on timeout
- **Detection Opportunities: 1.0/1.0** - 9 distinct phases with clear detection points: component deployment, identifier extraction, cert bypass attempts, network testing, command interception, isolation spoofing, config exfiltration, CloudLR token generation, verification
- **Logging & Observability: 0.3/1.0** - Comprehensive test_logger module with JSON/text output, phase tracking, system info capture, file/process logging (Added in v2.0)

**Key Strengths**:
- Real production endpoint testing with proper safety controls
- Advanced memory manipulation techniques with multiple operational modes
- Multi-layer safety architecture (watchdog + recovery + auto-restore)
- Professional logging and complete audit trails
- 9 distinct detection opportunities across all attack phases

## MITRE ATT&CK Mapping
- **Tactic**: Defense Evasion
- **Technique**: T1562.001 - Impair Defenses: Disable or Modify Tools
- **Technique**: T1014 - Rootkit
- **Technique**: T1090.003 - Proxy: Multi-hop Proxy
- **Technique**: T1140 - Deobfuscate/Decode Files or Information
- **Technique**: T1071.001 - Application Layer Protocol: Web Protocols

## Key Features

### ✅ Real MDE Identifier Extraction
- Extracts actual Machine ID, Tenant ID, and Sense ID from registry
- Falls back to WMI queries if MDE not installed
- Uses real identifiers for authentic attack simulation
- **100% Safe**: Read-only registry/WMI access

### ✅ Actual Network Communication
- Tests real MDE cloud endpoints (winatp-gw-*.microsoft.com)
- Deliberately omits authentication headers
- Validates if vulnerability exists in production
- Tests multiple regions (EUS, WEU, CUS, NEU)
- **Safe**: Read-only GET requests with timeout

### ✅ Certificate Pinning Bypass
- Three operational modes (TEST_ONLY, QUICK_PATCH, PERSISTENT)
- Real memory patching of CRYPT32 functions
- Three-layer safety architecture with watchdog
- Automatic restoration mechanisms
- **Reversible**: All changes are memory-only

### ✅ Comprehensive Testing
1. **Phase 1**: Component deployment
2. **Phase 2**: Real MDE identifier extraction (NEW)
3. **Phase 3**: Certificate pinning bypass attempt (NEW)
4. **Phase 4**: Network authentication testing (NEW)
5. **Phase 5**: File drop operations
6. **Phase 6**: Command interception simulation
7. **Phase 7**: Isolation status spoofing
8. **Phase 8**: CloudLR token generation (NEW)
9. **Phase 9**: Attack verification

## Expected Outcomes

### Protected System (GOOD) ✅
- **Phase 2**: MDE identifier extraction blocked or monitored by EDR
- **Phase 3**: Certificate bypass blocked (privilege denied or memory protected)
- **Phase 4**: Network requests blocked, return 401/403 Unauthorized
- **Phase 5-8**: Simulation phases detected and terminated
- **Exit Code**: 126 (Execution Prevented) or 127 (Quarantined)

### Vulnerable System (BAD) ⚠️
- **Phase 2**: Real MDE identifiers successfully extracted
- **Phase 3**: Certificate pinning bypass successful
- **Phase 4**: HTTP 200 OK - Unauthenticated access accepted!
- **Phase 5-8**: Command interception and spoofing succeed
- **Exit Code**: 101 (Unprotected)

### Network Isolated (INCONCLUSIVE) 🔒
- **Phase 2**: Identifiers may be extracted (local operation)
- **Phase 4**: DNS resolution fails or requests timeout
- **Result**: Cannot test actual vulnerability, but system may still be vulnerable
- **Exit Code**: 101 or 126 depending on other detections

## Build Instructions

### Automated Build (Recommended)
```bash
# Build single self-contained binary with all components embedded
./tests_source/b6c73735-0c24-4a1e-8f0a-3c24af39671b/build_all.sh
```

**This creates a SINGLE BINARY (~20MB) containing:**
- Main test logic with comprehensive logging
- Watchdog binary (auto-extracted at runtime)
- Emergency recovery script (auto-extracted at runtime)
- Helper binaries (fake_mssense.exe, isolation_spoofer.exe)
- PowerShell interceptor script

**Result:** Only ONE .exe file needed for deployment!

### Manual Build
```bash
# Build helper binaries first
cd tests_source/b6c73735-0c24-4a1e-8f0a-3c24af39671b/
GOOS=windows GOARCH=amd64 go build -o fake_mssense.exe fake_mssense.go
GOOS=windows GOARCH=amd64 go build -o isolation_spoofer.exe isolation_spoofer.go
GOOS=windows GOARCH=amd64 go build -o cert_bypass_watchdog.exe cert_bypass_watchdog.go

# Build main test with all components embedded
GOOS=windows GOARCH=amd64 go build -o ../../build/b6c73735-0c24-4a1e-8f0a-3c24af39671b/b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe b6c73735-0c24-4a1e-8f0a-3c24af39671b.go test_logger.go

# Clean up temporary files
rm -f fake_mssense.exe isolation_spoofer.exe cert_bypass_watchdog.exe
cd ../../..

# Optional: Sign the test binary
./utils/codesign sign build/b6c73735-0c24-4a1e-8f0a-3c24af39671b/b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe
```

### Deployment
**IMPORTANT:** You only need to deploy the single `.exe` file!

```bash
# Copy single binary to target system
scp build/b6c73735-0c24-4a1e-8f0a-3c24af39671b/b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe target-host:C:\
```

The binary will automatically extract all required components to `C:\F0` on first run.

## Usage Instructions

### Basic Test Execution
```cmd
# Run test with default settings (safe modes)
b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe

# On first run, the test will automatically:
# 1. Extract embedded components to C:\F0 (watchdog, recovery script)
# 2. Extract real MDE identifiers (Phase 2)
# 3. Test network authentication (Phase 4)
# 4. Use TEST_ONLY mode for cert bypass (safest)
# 5. Generate comprehensive execution logs
```

### Advanced Options
```cmd
# Test with quick certificate bypass (100ms patch window)
b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe --bypass-mode=quick-patch

# Skip network testing (offline mode)
b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe --skip-network

# Verbose output
b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe --verbose
```

### With Watchdog (Advanced Testing)
```cmd
# Terminal 1: Start watchdog
cert_bypass_watchdog.exe <test-pid> --auto-restore 300

# Terminal 2: Run test with persistent mode
b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe --bypass-mode=persistent
```

### Test Results
After execution, check these files in `C:\F0\`:
- **`test_execution_log.json`** - **Comprehensive execution log (JSON format)**
- **`test_execution_log.txt`** - **Comprehensive execution log (human-readable)**
- `mde_identifiers.json` - Extracted MDE identifiers
- `network_test_results.json` - Network authentication test results
- `network_test_report.txt` - Human-readable report
- `attack_summary.txt` - Overall test summary
- `watchdog_state.json` - Watchdog status (if used)

### Execution Logs
**NEW**: All test executions now generate comprehensive logs tracking:
- All 7 test phases with timing and status
- System information (OS, MDE version, Defender status)
- File drop operations and quarantine status
- Process executions and results
- Certificate bypass attempts (if applicable)
- Network test results (if applicable)
- Identifier extraction details
- Complete message timeline with millisecond precision
- Exit code and reason

**Log Locations**:
- JSON: `C:\F0\test_execution_log.json` (machine-parseable)
- Text: `C:\F0\test_execution_log.txt` (human-readable)

### Safety Notes
⚠️ **IMPORTANT**:
- Run in isolated lab/VM environment only
- Take VM snapshot before testing
- Read `CERT_BYPASS_SAFETY_GUIDE.md` before advanced testing
- Use watchdog for persistent mode
- Emergency recovery: `.\emergency_restore.ps1 -Force`

## Vulnerability Background
Based on InfoGuard Labs research (October 2025) identifying critical flaws in MDE's cloud communication:
- `/edr/commands/cnc` endpoint ignores authorization tokens
- Attackers can intercept isolation commands with just machine ID and tenant ID knowledge
- Configuration files containing detection rules are accessible without authentication
- Certificate pinning can be bypassed by patching CRYPT32!CertVerifyCertificateChainPolicy

**Key Finding**: Backend completely ignores `Authorization` and `Msadeviceticket` headers, allowing unauthenticated command interception.