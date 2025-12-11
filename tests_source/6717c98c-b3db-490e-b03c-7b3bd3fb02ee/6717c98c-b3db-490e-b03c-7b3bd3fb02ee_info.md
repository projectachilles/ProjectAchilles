# SafePay Go-Native Ransomware Simulation

## Test Score: 9.0/10

### Score Breakdown

| Criterion | Score |
|-----------|-------|
| **Real-World Accuracy** | **2.8/3.0** |
| **Technical Sophistication** | **2.7/3.0** |
| **Safety Mechanisms** | **1.6/2.0** |
| **Detection Opportunities** | **0.9/1.0** |
| **Logging & Observability** | **1.0/1.0** |

**Justification**: Pure Go implementation of SafePay ransomware with full kill chain: directory structure creation, mass file generation (800-1000 files), multi-phase data staging with WinRAR, selective deletion, Base64 encryption simulation, and ransom note generation. Superior logging and performance. No actual encryption - uses safe Base64 encoding for simulation.

## Overview
This test implements a complete SafePay ransomware simulation entirely in Go, eliminating PowerShell dependencies. It provides enhanced performance, reliability, and control while maintaining identical detection opportunities as the original PowerShell-based test.

## MITRE ATT&CK Mapping
- **T1486** - Data Encrypted for Impact: Simulates file encryption with .safepay extension
- **T1560.001** - Archive Collected Data via Utility: Uses WinRAR for data staging operations
- **T1071.001** - Application Layer Protocol Web Protocols: Simulates C2 communication patterns
- **T1490** - Inhibit System Recovery: Deletes original files after encryption simulation
- **T1083** - File and Directory Discovery: Traverses directory structures for file operations
- **T1005** - Data from Local System: Targets local user directories and corporate files

## Test Behavior

### Phase 1: Corporate Infrastructure Simulation
1. Creates realistic corporate directory structure
2. Generates 800-1000 authentic business documents
3. Populates files with department-specific content (Finance, HR, Legal, IT, Sales, Executive)
4. File sizes: 5-10KB with realistic business data patterns

### Phase 2: Data Staging Operations
1. Creates department-level archives (Finance_Archive.rar, HR_Archive.rar, etc.)
2. Generates location-based archives (Documents_Data.rar, Desktop_Data.rar)
3. Creates master exfiltration archive (EXFIL_Master.rar)
4. Uses embedded WinRAR.exe for authentic compression behavior

### Phase 3: Selective Mass Deletion
1. Identifies all corporate document files across directory structure
2. Randomly selects 65% of files for deletion (preserving 35% for encryption)
3. Performs batch deletion with realistic timing intervals
4. Excludes archives, logs, and encrypted files from deletion

### Phase 4: File Encryption Simulation
1. Encrypts remaining files using Base64 encoding (safe simulation method)
2. Adds .safepay extension to all encrypted files
3. Removes original files after encryption
4. Logs detailed encryption events for verification

### Phase 5: Ransomware Artifacts
1. Creates authentic readme_safepay.txt ransom note
2. Opens ransom note in Notepad to simulate user notification
3. Simulates C2 communication with header pattern exchange
4. Generates computer ID and payment instructions

## Detection Opportunities

### File System Activity
- Mass file creation (800+ files in user directory within minutes)
- Systematic directory traversal and enumeration
- Large-scale file deletion patterns targeting document types
- File extension changes (.docx → .docx.safepay)
- Creation of suspicious archive files with exfiltration naming

### Process Activity
- WinRAR.exe execution with suspicious command-line arguments
- Go binary exhibiting ransomware behavior patterns
- Multiple compression processes with large data volumes
- Batch file operations at scale
- Notepad.exe launching ransom note display

### Network Simulation
- C2 communication pattern simulation
- Header exchange patterns (C4 C3 C2 C1)
- Simulated data exfiltration preparation

## Go-Native Advantages

### Performance Benefits
- Direct file system operations (no PowerShell overhead)
- Native Windows API access for better integration
- Efficient memory management and resource utilization
- Concurrent processing capabilities where appropriate

### Enhanced Reliability
- Single binary deployment with embedded assets
- No PowerShell execution policy dependencies
- Comprehensive error handling and recovery
- Deterministic behavior and consistent results

### Superior Logging
- Structured logging with millisecond timestamps
- Detailed phase tracking and progress reporting
- Comprehensive artifact verification
- Performance metrics and execution statistics

## Expected Outcomes

### Protected Systems (Exit Codes)
- **105** (`FileQuarantinedOnExtraction`): WinRAR.exe or Go binary quarantined
- **126** (`ExecutionPrevented`): Mass file operations or encryption blocked by EDR
- **127** (`FileQuarantinedOnExecution`): Binary caught during execution

### Unprotected Systems (Exit Code)
- **101** (`Unprotected`): Full ransomware simulation completes successfully
  - 800+ files created and processed
  - Multiple archive files generated
  - 65% selective deletion completed
  - Remaining files encrypted with .safepay extension
  - Ransom note created and displayed

## Technical Specifications

### Execution Environment
- **Target OS**: Windows (Go-native Windows binary)
- **Privileges**: Administrator recommended (checks performed)
- **Disk Space**: Minimum 2GB required (validated)
- **Timeout**: 5-minute maximum (custom runner)

### Performance Metrics
- **Expected Runtime**: 2.5-4 minutes
- **File Generation**: 800-1000 files
- **Archive Creation**: 8-12 archive files
- **Encryption Operations**: 300-400 files
- **Log Entries**: 200+ detailed log entries

### Output Artifacts
- **Primary Log**: `C:\F0\safepay_simulation.log`
- **Target Location**: `C:\Users\fortika-test\`
- **Encrypted Files**: Multiple `.safepay` files
- **Archives**: Department and master RAR files
- **Ransom Note**: `readme_safepay.txt`

## Security Testing Value

This Go-native implementation provides:
- **Identical Detection Surface**: Same behavioral patterns as PowerShell version
- **Enhanced Realism**: Native binary behavior more representative of actual malware
- **Better Performance**: Faster execution for efficient security testing
- **Improved Reliability**: Consistent results across different Windows configurations
- **Comprehensive Coverage**: Full ransomware kill chain simulation

The test validates EDR/AV capabilities against modern ransomware techniques while providing detailed insights into detection gaps and response effectiveness.

## Notes
This test represents a significant advancement in F0RT1KA's testing capabilities, demonstrating how complex PowerShell-based simulations can be refactored into high-performance, reliable Go-native implementations while maintaining complete behavioral fidelity for security testing purposes.