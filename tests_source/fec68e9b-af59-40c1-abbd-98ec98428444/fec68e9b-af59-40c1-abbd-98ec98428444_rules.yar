/*
    ============================================================
    F0RT1KA YARA Detection Rules
    Test ID: fec68e9b-af59-40c1-abbd-98ec98428444
    Test Name: MDE Process Injection and API Authentication Bypass
    MITRE ATT&CK: T1055, T1055.001, T1562.001, T1014, T1557, T1071.001, T1140
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-12-07
    ============================================================
*/

import "pe"
import "math"

/*
    ============================================================
    RULE 1: F0RT1KA MDE Process Injection Test Binary
    Confidence: High
    Description: Detects the main test binary with embedded components
    ============================================================
*/
rule F0RTIKA_MDE_Process_Injection_Test {
    meta:
        description = "Detects F0RT1KA MDE Process Injection and API Authentication Bypass test binary"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1055,T1055.001,T1562.001"
        confidence = "high"
        reference = "https://attack.mitre.org/techniques/T1055/"

    strings:
        // Test identification strings
        $uuid = "fec68e9b-af59-40c1-abbd-98ec98428444" ascii wide nocase
        $test_name = "MDE Process Injection" ascii wide nocase

        // Target process names
        $target1 = "MsSense.exe" ascii wide nocase
        $target2 = "SenseIR.exe" ascii wide nocase
        $target3 = "SenseCncProxy.exe" ascii wide nocase

        // Windows API function names for injection
        $api1 = "OpenProcess" ascii
        $api2 = "WriteProcessMemory" ascii
        $api3 = "ReadProcessMemory" ascii
        $api4 = "VirtualAllocEx" ascii
        $api5 = "CreateRemoteThread" ascii
        $api6 = "CreateToolhelp32Snapshot" ascii

        // Memory patch shellcode pattern
        $shellcode = { 33 C0 40 C3 }  // xor eax,eax; inc eax; ret

        // Certificate bypass target
        $cert_func = "CertVerifyCertificateChainPolicy" ascii wide

        // MDE cloud endpoints
        $endpoint1 = "winatp-gw" ascii wide nocase
        $endpoint2 = "/edr/commands/cnc" ascii wide nocase
        $endpoint3 = "/senseir/" ascii wide nocase

        // F0RT1KA artifacts
        $artifact1 = "c:\\F0" ascii wide nocase
        $artifact2 = "mde_process_watchdog" ascii wide nocase
        $artifact3 = "emergency_restore.ps1" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            // High confidence: UUID match
            $uuid or
            // High confidence: Test name + targets
            ($test_name and 1 of ($target*)) or
            // Medium confidence: Injection APIs + MDE targets
            (3 of ($api*) and 1 of ($target*)) or
            // Medium confidence: Certificate bypass pattern
            ($cert_func and ($shellcode or 2 of ($api*))) or
            // Medium confidence: MDE endpoints + artifacts
            (2 of ($endpoint*) and 2 of ($artifact*))
        )
}

/*
    ============================================================
    RULE 2: MDE Process Watchdog Binary
    Confidence: High
    Description: Detects the embedded watchdog process used for memory restoration
    ============================================================
*/
rule F0RTIKA_MDE_Watchdog_Binary {
    meta:
        description = "Detects F0RT1KA MDE watchdog binary for memory restoration"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1055"
        confidence = "high"

    strings:
        // Watchdog-specific strings
        $name1 = "mde_process_watchdog" ascii wide nocase
        $name2 = "watchdog" ascii wide nocase

        // Monitoring functionality
        $func1 = "--timeout" ascii wide
        $func2 = "restore" ascii wide nocase
        $func3 = "monitoring" ascii wide nocase

        // Memory APIs for restoration
        $api1 = "WriteProcessMemory" ascii
        $api2 = "ReadProcessMemory" ascii

        // Target process
        $target = "MsSense" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (
            $name1 or
            ($name2 and 2 of ($func*)) or
            ($target and all of ($api*) and 1 of ($func*))
        )
}

/*
    ============================================================
    RULE 3: Process Injection API Pattern
    Confidence: Medium
    Description: Generic detection for process injection capability
    ============================================================
*/
rule F0RTIKA_Process_Injection_APIs {
    meta:
        description = "Detects binaries with process injection API import pattern"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1055,T1055.001"
        confidence = "medium"

    strings:
        // Core injection APIs
        $api_open = "OpenProcess" ascii
        $api_write = "WriteProcessMemory" ascii
        $api_read = "ReadProcessMemory" ascii
        $api_alloc = "VirtualAllocEx" ascii
        $api_thread = "CreateRemoteThread" ascii
        $api_snapshot = "CreateToolhelp32Snapshot" ascii
        $api_module = "Module32First" ascii
        $api_process = "Process32First" ascii

        // Access right constants (in strings)
        $access1 = "PROCESS_VM_WRITE" ascii wide nocase
        $access2 = "PROCESS_VM_READ" ascii wide nocase
        $access3 = "PROCESS_VM_OPERATION" ascii wide nocase
        $access4 = "PROCESS_CREATE_THREAD" ascii wide nocase

        // Security product names (targeting)
        $target1 = "MsSense" ascii wide nocase
        $target2 = "SenseIR" ascii wide nocase
        $target3 = "MsMpEng" ascii wide nocase
        $target4 = "defender" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Full injection toolkit
            ($api_open and $api_write and ($api_thread or $api_alloc)) or
            // Process enumeration + injection
            ($api_snapshot and $api_write and ($api_process or $api_module)) or
            // Access rights + targeting
            (2 of ($access*) and 1 of ($target*))
        )
}

/*
    ============================================================
    RULE 4: Certificate Validation Bypass Pattern
    Confidence: High
    Description: Detects patterns targeting certificate validation functions
    ============================================================
*/
rule F0RTIKA_Certificate_Bypass_Pattern {
    meta:
        description = "Detects certificate validation bypass attempts"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1014,T1553.004"
        confidence = "high"

    strings:
        // CRYPT32 function targets
        $func1 = "CertVerifyCertificateChainPolicy" ascii wide
        $func2 = "CertGetCertificateChain" ascii wide
        $func3 = "CertFreeCertificateChain" ascii wide

        // CRYPT32 DLL
        $dll1 = "CRYPT32.dll" ascii wide nocase
        $dll2 = "crypt32" ascii wide nocase

        // Memory patching shellcode patterns
        $patch1 = { 33 C0 40 C3 }  // xor eax,eax; inc eax; ret (return TRUE)
        $patch2 = { 31 C0 40 C3 }  // xor eax,eax; inc eax; ret (alternative)
        $patch3 = { B8 01 00 00 00 C3 }  // mov eax,1; ret
        $patch4 = { 33 C0 FF C0 C3 }  // xor eax,eax; inc eax; ret

        // Memory APIs
        $api1 = "WriteProcessMemory" ascii
        $api2 = "ReadProcessMemory" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Certificate function + memory API
            (1 of ($func*) and 1 of ($api*)) or
            // CRYPT32 + patch pattern
            (1 of ($dll*) and 1 of ($patch*)) or
            // Certificate function + patch pattern
            (1 of ($func*) and 1 of ($patch*))
        )
}

/*
    ============================================================
    RULE 5: MDE API Endpoint Targeting
    Confidence: High
    Description: Detects binaries targeting MDE cloud API endpoints
    ============================================================
*/
rule F0RTIKA_MDE_API_Targeting {
    meta:
        description = "Detects binaries targeting MDE cloud API endpoints"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1071.001,T1557"
        confidence = "high"

    strings:
        // MDE cloud gateway endpoints
        $endpoint1 = "winatp-gw-eus.microsoft.com" ascii wide nocase
        $endpoint2 = "winatp-gw-weu.microsoft.com" ascii wide nocase
        $endpoint3 = "winatp-gw-cus.microsoft.com" ascii wide nocase
        $endpoint4 = "winatp-gw-neu.microsoft.com" ascii wide nocase
        $endpoint5 = "winatp-gw" ascii wide nocase

        // MDE API paths
        $path1 = "/edr/commands/cnc" ascii wide
        $path2 = "/edr/config" ascii wide
        $path3 = "/senseir/v1/actions" ascii wide
        $path4 = "/commands/status" ascii wide

        // MDE header values
        $header1 = "X-MachineId" ascii wide
        $header2 = "X-TenantId" ascii wide
        $header3 = "Msadeviceticket" ascii wide

        // HTTP functionality
        $http1 = "http.Client" ascii
        $http2 = "net/http" ascii
        $http3 = "InsecureSkipVerify" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Direct endpoint targeting
            (1 of ($endpoint*) and 1 of ($path*)) or
            // MDE headers + HTTP
            (2 of ($header*) and 1 of ($http*)) or
            // Multiple endpoints
            (2 of ($endpoint*))
        )
}

/*
    ============================================================
    RULE 6: Emergency Restore PowerShell Script
    Confidence: High
    Description: Detects emergency restore scripts for MDE memory restoration
    ============================================================
*/
rule F0RTIKA_Emergency_Restore_Script {
    meta:
        description = "Detects F0RT1KA emergency restore PowerShell script"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1059.001"
        confidence = "high"

    strings:
        // Script identification
        $name1 = "emergency_restore" ascii wide nocase
        $name2 = "Emergency Recovery" ascii wide nocase

        // Target process
        $target1 = "MsSense" ascii wide nocase
        $target2 = "SenseIR" ascii wide nocase

        // Memory operations
        $op1 = "WriteProcessMemory" ascii wide nocase
        $op2 = "ReadProcessMemory" ascii wide nocase
        $op3 = "OpenProcess" ascii wide nocase

        // Restoration keywords
        $restore1 = "Restore" ascii wide nocase
        $restore2 = "original" ascii wide nocase
        $restore3 = "bytes" ascii wide nocase
        $restore4 = "CRYPT32" ascii wide nocase

        // PowerShell indicators
        $ps1 = "param(" ascii wide nocase
        $ps2 = "[CmdletBinding" ascii wide nocase
        $ps3 = "function " ascii wide nocase

    condition:
        filesize < 100KB and
        (
            // Script markers + targets
            (1 of ($name*) and 1 of ($target*)) or
            // Memory ops + restoration
            (1 of ($op*) and 2 of ($restore*)) or
            // PowerShell + MDE restoration
            (1 of ($ps*) and 1 of ($target*) and 1 of ($restore*))
        )
}

/*
    ============================================================
    RULE 7: Embedded PE Detection (Dropper Pattern)
    Confidence: Medium
    Description: Detects PE files with embedded executables
    ============================================================
*/
rule F0RTIKA_Embedded_PE_Dropper {
    meta:
        description = "Detects PE files with embedded executables (dropper pattern)"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1027.002"
        confidence = "medium"

    strings:
        // PE header pattern (MZ...PE)
        $pe_header = { 4D 5A [0-100] 50 45 00 00 }

        // Go embed directive (common in Go binaries)
        $go_embed = "go:embed" ascii
        $watchdog_embed = "mde_process_watchdog.exe" ascii

        // Resource extraction patterns
        $extract1 = "WriteFile" ascii
        $extract2 = "os.WriteFile" ascii
        $extract3 = "ioutil.WriteFile" ascii

        // F0RT1KA patterns
        $f0_path = "c:\\F0" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize > 1MB and
        filesize < 50MB and
        (
            // Multiple PE headers (embedded executables)
            (#pe_header > 2) or
            // Go embed with watchdog
            ($go_embed and $watchdog_embed) or
            // Extraction + F0 path
            (1 of ($extract*) and $f0_path)
        )
}

/*
    ============================================================
    RULE 8: F0RT1KA Test Artifacts JSON
    Confidence: High
    Description: Detects JSON report files from test execution
    ============================================================
*/
rule F0RTIKA_Test_Report_JSON {
    meta:
        description = "Detects F0RT1KA test execution report files"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1055"
        confidence = "high"

    strings:
        // JSON structure indicators
        $json1 = "\"targetProcess\"" ascii
        $json2 = "\"handleAttempts\"" ascii
        $json3 = "\"memoryPatch\"" ascii
        $json4 = "\"overallSuccess\"" ascii
        $json5 = "\"blockedByEDR\"" ascii

        // Test identification
        $uuid = "fec68e9b-af59-40c1-abbd-98ec98428444" ascii

        // Process names
        $target1 = "MsSense.exe" ascii
        $target2 = "SenseIR.exe" ascii

        // Memory patch indicators
        $patch1 = "\"originalBytes\"" ascii
        $patch2 = "\"patchBytes\"" ascii
        $patch3 = "\"functionAddress\"" ascii

    condition:
        filesize < 1MB and
        (
            // Test UUID in report
            $uuid or
            // JSON structure + targets
            (3 of ($json*) and 1 of ($target*)) or
            // Memory patch report
            (2 of ($patch*) and 1 of ($target*))
        )
}

/*
    ============================================================
    RULE 9: High-Risk Windows API Import Combination
    Confidence: Medium
    Description: Detects PE files importing dangerous API combinations
    ============================================================
*/
rule F0RTIKA_HighRisk_API_Imports {
    meta:
        description = "Detects PE files with high-risk API import patterns"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1055,T1055.001"
        confidence = "medium"

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        pe.number_of_imports > 0 and
        (
            // Process injection toolkit
            (
                pe.imports("kernel32.dll", "OpenProcess") and
                pe.imports("kernel32.dll", "WriteProcessMemory") and
                (
                    pe.imports("kernel32.dll", "CreateRemoteThread") or
                    pe.imports("kernel32.dll", "VirtualAllocEx")
                )
            ) or
            // Process enumeration + memory access
            (
                pe.imports("kernel32.dll", "CreateToolhelp32Snapshot") and
                pe.imports("kernel32.dll", "WriteProcessMemory")
            )
        )
}

/*
    ============================================================
    RULE 10: Suspicious Entropy Sections (Packed/Embedded Content)
    Confidence: Low
    Description: Detects PE files with high-entropy sections indicating embedding
    ============================================================
*/
rule F0RTIKA_High_Entropy_Sections {
    meta:
        description = "Detects PE files with high-entropy sections (possible embedded content)"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "fec68e9b-af59-40c1-abbd-98ec98428444"
        mitre_attack = "T1027.002"
        confidence = "low"

    strings:
        // Additional context required
        $context1 = "MsSense" ascii wide nocase
        $context2 = "watchdog" ascii wide nocase
        $context3 = "inject" ascii wide nocase
        $context4 = "F0RT1KA" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize > 5MB and
        filesize < 50MB and
        // Look for sections with high entropy (>7.0)
        for any i in (0..pe.number_of_sections - 1): (
            math.entropy(pe.sections[i].raw_data_offset, pe.sections[i].raw_data_size) > 7.0
        ) and
        // Require additional context to reduce false positives
        1 of ($context*)
}
