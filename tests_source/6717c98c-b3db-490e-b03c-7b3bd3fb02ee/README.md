# SafePay Go-Native Ransomware Simulation

**Test Score**: **9.0/10**

This F0RT1KA test implements a complete SafePay ransomware simulation entirely in Go, eliminating PowerShell dependencies and providing enhanced performance and control.

## Overview

**Key Innovation: Pure Go Implementation**
- No PowerShell scripts - all operations implemented natively in Go
- Enhanced performance through Go's concurrency and direct Windows API access
- Simplified deployment with single binary + embedded WinRAR utility
- Better resource management and error handling

## Attack Simulation Phases

### Phase 1: Directory Structure Creation
- Creates realistic corporate directory structure
- Targets: `Documents/Finance/`, `HR/`, `Legal/`, `IT/`, `Sales/`, `Executive/`
- Simulates authentic enterprise file organization patterns

### Phase 2: Mass File Generation
- Generates 800-1000 realistic corporate files
- Department-specific content (financial reports, HR records, legal documents)
- File sizes: 5-10KB with authentic business data
- Extensions: `.docx`, `.xlsx`, `.pdf`, `.txt`, `.csv`, `.sql`, `.bak`, `.ppt`, `.doc`, `.zip`

### Phase 3: Multi-Phase Data Staging
- **Department Archives**: Creates `Finance_Archive_YYYYMMDD.rar`, etc.
- **Location Archives**: `Documents_Data.rar`, `Desktop_Data.rar`
- **Master Exfiltration**: `EXFIL_Master_YYYYMMDD_HHMM.rar`
- Uses embedded WinRAR.exe for authentic compression behavior

### Phase 4: Selective Mass Deletion
- Deletes 65% of original files to simulate realistic ransomware behavior
- Preserves 35% for encryption demonstration
- Batch processing with realistic timing intervals
- Excludes archives, logs, and encrypted files from deletion

### Phase 5: File Encryption Simulation
- Encrypts remaining files with Base64 encoding (safe simulation)
- Adds `.safepay` extension to encrypted files
- Removes original files after "encryption"
- Comprehensive logging of all encryption events

### Phase 6: Ransom Note & C2 Simulation
- Creates authentic `readme_safepay.txt` ransom note
- Opens note in Notepad to simulate user notification
- Simulates C2 communication patterns and header exchanges
- Generates realistic computer ID and Bitcoin payment instructions

## MITRE ATT&CK Mapping

- **T1486** - Data Encrypted for Impact
- **T1560.001** - Archive Collected Data: Archive via Utility  
- **T1071.001** - Application Layer Protocol: Web Protocols
- **T1490** - Inhibit System Recovery
- **T1083** - File and Directory Discovery
- **T1005** - Data from Local System

## Enhanced Features (Go-Native)

### Performance Improvements
- Direct file system operations (no PowerShell overhead)
- Concurrent processing where safe
- Efficient memory management
- Faster file generation and processing

### Enhanced Safety Controls
- Built-in disk space validation (minimum 2GB)
- Administrator privilege checking
- Comprehensive error handling and recovery
- Configurable parameters for safe testing

### Superior Logging
- Structured logging with timestamps and severity levels
- Detailed phase tracking and progress reporting
- Comprehensive artifact verification
- Simulation statistics and timing metrics

### Advanced Error Handling
- Graceful failure handling for each phase
- Detailed error reporting and recovery
- Safe cleanup on errors or interruptions
- Comprehensive status reporting

## Expected Behavior

### Protected Systems Should:
- Block WinRAR.exe binary execution
- Prevent mass file operations
- Detect and stop encryption simulation
- Alert on suspicious batch file operations
- Block or quarantine the main Go binary

### Detection Opportunities
- Mass file creation in user directories (800+ files in minutes)
- Multiple WinRAR compression processes with large data volumes
- Selective file deletion patterns targeting document types
- File encryption with suspicious `.safepay` extensions
- Go binary exhibiting ransomware-like behavior patterns
- Rapid directory traversal and file system modifications

## Test Execution

### Prerequisites
- Windows environment with administrator privileges
- Minimum 2GB available disk space
- WinRAR.exe embedded in test binary

### Expected Timeline
- **Phase 1-2**: 30-60 seconds (directory + file creation)
- **Phase 3**: 60-90 seconds (compression operations)
- **Phase 4-5**: 30-45 seconds (deletion + encryption)
- **Phase 6**: 5-10 seconds (ransom note + C2 simulation)
- **Total Runtime**: 2.5-4 minutes

### Output Artifacts
- **Log File**: `C:\F0\safepay_simulation.log`
- **Target Directory**: `C:\Users\fortika-test\`
- **Encrypted Files**: Multiple `.safepay` files
- **Archives**: Department and master archive files
- **Ransom Note**: `readme_safepay.txt`

## Advantages Over PowerShell Version

1. **Eliminated Dependencies**: No PowerShell execution policy bypass required
2. **Better Performance**: Native Go operations vs. PowerShell overhead
3. **Enhanced Control**: Direct API access and fine-grained operation control
4. **Improved Reliability**: No inter-process communication dependencies
5. **Simplified Deployment**: Single binary with embedded assets
6. **Better Debugging**: Native Go error handling and logging
7. **Cross-Platform Potential**: Go codebase more portable for future enhancements

## Security Testing Value

This Go-native implementation provides identical detection opportunities while offering:
- More realistic performance characteristics
- Better simulation of native malware behavior
- Enhanced logging for detailed analysis
- Improved reliability for consistent testing results

The test maintains full compatibility with existing detection rules while providing superior performance and maintainability for long-term security testing needs.