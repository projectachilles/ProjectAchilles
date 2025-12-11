/*
============================================================================
DEFENSE GUIDANCE: YARA Detection Rules
============================================================================
Test ID: b83616c2-84ee-4738-b398-d2d57eebecec
Test Name: NativeDump (NimDump) Detection
MITRE ATT&CK: T1003.001 - OS Credential Dumping: LSASS Memory
Created: 2025-12-07
Author: F0RT1KA Defense Guidance Builder
============================================================================

TECHNIQUE-FOCUSED DETECTION PRINCIPLE:
These YARA rules detect NativeDump, NimDump, and similar LSASS credential
dumping tools that use NTAPI functions to bypass standard detection methods.
They will catch real-world attackers using these techniques.

============================================================================
*/


// ============================================================================
// RULE 1: NimDump LSASS Dumper Detection
// Detects NimDump binary based on specific strings and patterns
// ============================================================================

rule NimDump_LSASS_Dumper
{
    meta:
        description = "Detects NimDump - Nim-based LSASS memory dumper"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "high"
        severity = "critical"
        reference = "https://github.com/ricardojoserf/NativeDump/tree/nim-flavour"

    strings:
        // Nim-specific runtime strings
        $nim1 = "nimbase.h" ascii
        $nim2 = "@NimMain" ascii
        $nim3 = "nimGC_" ascii
        $nim4 = "nimFrame" ascii

        // NimDump specific strings
        $dump1 = "MiniDumpWriteDump" ascii wide nocase
        $dump2 = "lsass.exe" ascii wide nocase
        $dump3 = "LSASS" ascii wide
        $dump4 = "SeDebugPrivilege" ascii wide

        // NTAPI function strings used by NimDump
        $ntapi1 = "NtOpenProcess" ascii
        $ntapi2 = "NtReadVirtualMemory" ascii
        $ntapi3 = "NtQueryVirtualMemory" ascii
        $ntapi4 = "NtOpenProcessToken" ascii
        $ntapi5 = "NtAdjustPrivilegesToken" ascii
        $ntapi6 = "NtQueryInformationProcess" ascii

        // Minidump structure strings
        $mdmp1 = "MDMP" ascii  // Minidump header signature
        $mdmp2 = { 4D 44 4D 50 }  // MDMP in hex
        $mdmp3 = "SystemInfoStream" ascii
        $mdmp4 = "ModuleListStream" ascii
        $mdmp5 = "Memory64ListStream" ascii

        // Command line option patterns
        $opt1 = "-r" ascii wide
        $opt2 = "-o:" ascii wide
        $opt3 = "--remap" ascii wide nocase
        $opt4 = "--output" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            // Nim binary with LSASS dumping capability
            (2 of ($nim*) and 2 of ($dump*)) or
            // Nim binary with NTAPI calls
            (2 of ($nim*) and 3 of ($ntapi*)) or
            // Minidump creation patterns with NTAPI
            (2 of ($mdmp*) and 2 of ($ntapi*)) or
            // Command line options with dump indicators
            (2 of ($opt*) and 2 of ($dump*))
        )
}


// ============================================================================
// RULE 2: NativeDump Generic Detection
// Detects NativeDump and variants using NTAPI-only credential dumping
// ============================================================================

rule NativeDump_Generic
{
    meta:
        description = "Detects NativeDump - NTAPI-based LSASS credential dumper"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "high"
        severity = "critical"
        reference = "https://github.com/ricardojoserf/NativeDump"

    strings:
        // NativeDump source code artifacts
        $src1 = "NativeDump" ascii wide nocase
        $src2 = "ricardojoserf" ascii  // Author reference
        $src3 = "nativeDump" ascii

        // NTAPI functions for LSASS access
        $ntapi1 = "NtOpenProcess" ascii
        $ntapi2 = "NtReadVirtualMemory" ascii
        $ntapi3 = "NtQueryVirtualMemory" ascii
        $ntapi4 = "NtQuerySystemInformation" ascii
        $ntapi5 = "NtOpenProcessToken" ascii
        $ntapi6 = "NtAdjustPrivilegesToken" ascii

        // Ntdll.dll strings
        $ntdll1 = "ntdll.dll" ascii wide nocase
        $ntdll2 = "ntdll" ascii wide nocase

        // Process access strings
        $proc1 = "PROCESS_ALL_ACCESS" ascii wide
        $proc2 = "PROCESS_VM_READ" ascii wide
        $proc3 = "PROCESS_QUERY_INFORMATION" ascii wide

        // LSASS targeting
        $lsass1 = "lsass.exe" ascii wide nocase
        $lsass2 = "lsass" ascii wide nocase
        $lsass3 = "Local Security Authority" ascii wide

        // Debug privilege
        $priv1 = "SeDebugPrivilege" ascii wide
        $priv2 = "SE_DEBUG_NAME" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // NativeDump identification
            any of ($src*) or
            // NTAPI with LSASS access
            (3 of ($ntapi*) and any of ($lsass*)) or
            // NTAPI with process access
            (3 of ($ntapi*) and 2 of ($proc*)) or
            // NTAPI with debug privilege
            (3 of ($ntapi*) and any of ($priv*))
        )
}


// ============================================================================
// RULE 3: LSASS Dumper NTAPI Pattern
// Detects LSASS dumpers using direct NTAPI calls
// ============================================================================

rule LSASS_Dumper_NTAPI_Pattern
{
    meta:
        description = "Detects LSASS dumpers using NTAPI functions directly"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "medium-high"
        severity = "high"

    strings:
        // NTAPI syscall stubs (common patterns)
        $syscall1 = { 4C 8B D1 B8 ?? 00 00 00 }  // mov r10, rcx; mov eax, syscall_number
        $syscall2 = { 0F 05 C3 }  // syscall; ret

        // NTAPI function names
        $nt1 = "NtOpenProcess" ascii
        $nt2 = "NtReadVirtualMemory" ascii
        $nt3 = "NtWriteVirtualMemory" ascii
        $nt4 = "NtQueryVirtualMemory" ascii
        $nt5 = "NtProtectVirtualMemory" ascii
        $nt6 = "NtCreateFile" ascii
        $nt7 = "NtWriteFile" ascii

        // Zw variants (kernel mode names, sometimes seen in user mode)
        $zw1 = "ZwOpenProcess" ascii
        $zw2 = "ZwReadVirtualMemory" ascii
        $zw3 = "ZwQueryVirtualMemory" ascii

        // LSASS process identification
        $lsass1 = "lsass.exe" ascii wide nocase
        $lsass2 = { 6C 00 73 00 61 00 73 00 73 00 }  // lsass in Unicode
        $lsass3 = "LSASS" ascii wide

        // Token manipulation
        $token1 = "NtOpenProcessToken" ascii
        $token2 = "NtAdjustPrivilegesToken" ascii
        $token3 = "NtDuplicateToken" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Syscall patterns with NTAPI
            ($syscall1 and $syscall2 and 2 of ($nt*)) or
            // Multiple NTAPI functions with LSASS
            (4 of ($nt*) and any of ($lsass*)) or
            // Zw functions with LSASS
            (2 of ($zw*) and any of ($lsass*)) or
            // Token manipulation with memory access
            (2 of ($token*) and 2 of ($nt*))
        )
}


// ============================================================================
// RULE 4: Handcrafted Minidump Detection
// Detects tools that manually craft Minidump files
// ============================================================================

rule Minidump_Handcrafted_Pattern
{
    meta:
        description = "Detects tools creating hand-crafted Minidump files"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "medium"
        severity = "high"

    strings:
        // Minidump structure constants
        $mdmp_sig = "MDMP" ascii
        $mdmp_hex = { 4D 44 4D 50 }
        $mdmp_ver = { 93 A7 }  // Minidump version signature

        // Minidump stream types (as strings, may appear in code)
        $stream1 = "ThreadListStream" ascii wide
        $stream2 = "ModuleListStream" ascii wide
        $stream3 = "Memory64ListStream" ascii wide
        $stream4 = "SystemInfoStream" ascii wide
        $stream5 = "MemoryInfoListStream" ascii wide
        $stream6 = "HandleDataStream" ascii wide

        // Minidump creation without dbghelp
        $no_dbghelp1 = "MiniDumpWriteDump" ascii wide  // Should NOT be present if handcrafted
        $handcraft1 = "MINIDUMP_HEADER" ascii wide
        $handcraft2 = "MINIDUMP_DIRECTORY" ascii wide
        $handcraft3 = "MINIDUMP_STREAM" ascii wide

        // Memory enumeration
        $mem1 = "VirtualQueryEx" ascii
        $mem2 = "NtQueryVirtualMemory" ascii
        $mem3 = "ReadProcessMemory" ascii
        $mem4 = "NtReadVirtualMemory" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Minidump structures without MiniDumpWriteDump API
            (2 of ($stream*) and not $no_dbghelp1) or
            // Handcrafted minidump structures
            (2 of ($handcraft*) and 2 of ($mem*)) or
            // Memory enumeration with minidump signature
            (($mdmp_sig or $mdmp_hex) and 2 of ($mem*))
        )
}


// ============================================================================
// RULE 5: Credential Dumper Generic Strings
// Detects generic credential dumping tool strings
// ============================================================================

rule Credential_Dumper_Generic_Strings
{
    meta:
        description = "Detects generic credential dumping tool strings"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "medium"
        severity = "high"

    strings:
        // Credential-related strings
        $cred1 = "credential" ascii wide nocase
        $cred2 = "password" ascii wide nocase
        $cred3 = "logonpasswords" ascii wide nocase
        $cred4 = "sekurlsa" ascii wide nocase
        $cred5 = "wdigest" ascii wide nocase
        $cred6 = "kerberos" ascii wide nocase
        $cred7 = "ntlm" ascii wide nocase

        // LSASS-related strings
        $lsass1 = "lsass" ascii wide nocase
        $lsass2 = "Local Security Authority" ascii wide
        $lsass3 = "LSA" ascii wide

        // Dump-related strings
        $dump1 = "dump" ascii wide nocase
        $dump2 = "minidump" ascii wide nocase
        $dump3 = "procdump" ascii wide nocase

        // Memory access strings
        $mem1 = "ReadProcessMemory" ascii wide
        $mem2 = "VirtualQueryEx" ascii wide
        $mem3 = "OpenProcess" ascii wide

        // Debug strings
        $dbg1 = "SeDebugPrivilege" ascii wide
        $dbg2 = "DEBUG" ascii wide
        $dbg3 = "AdjustTokenPrivileges" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Credential strings with LSASS
            (2 of ($cred*) and any of ($lsass*)) or
            // LSASS with dump functionality
            (any of ($lsass*) and 2 of ($dump*) and any of ($mem*)) or
            // Debug privilege with memory access
            (any of ($dbg*) and 2 of ($mem*) and any of ($lsass*))
        )
}


// ============================================================================
// RULE 6: NtDll Remapping Detection
// Detects tools that remap ntdll.dll to bypass hooks
// ============================================================================

rule NtDll_Remap_Technique
{
    meta:
        description = "Detects ntdll.dll remapping technique to bypass EDR hooks"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "high"
        severity = "critical"

    strings:
        // Ntdll path patterns
        $ntdll_path1 = "\\System32\\ntdll.dll" ascii wide nocase
        $ntdll_path2 = "\\SysWOW64\\ntdll.dll" ascii wide nocase
        $ntdll_path3 = "ntdll.dll" ascii wide nocase

        // File mapping functions
        $map1 = "CreateFileMapping" ascii wide
        $map2 = "MapViewOfFile" ascii wide
        $map3 = "NtCreateSection" ascii
        $map4 = "NtMapViewOfSection" ascii

        // Memory comparison/copy
        $cmp1 = "memcmp" ascii
        $cmp2 = "memcpy" ascii
        $cmp3 = "RtlCopyMemory" ascii wide

        // Section manipulation
        $sec1 = ".text" ascii
        $sec2 = "IMAGE_SECTION_HEADER" ascii wide
        $sec3 = "SectionAlignment" ascii wide

        // Unhooking indicators
        $unhook1 = "unhook" ascii wide nocase
        $unhook2 = "remap" ascii wide nocase
        $unhook3 = "clean" ascii wide nocase
        $unhook4 = "fresh" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Ntdll with file mapping
            (any of ($ntdll_path*) and 2 of ($map*)) or
            // Section manipulation with memory copy
            (2 of ($sec*) and any of ($cmp*) and any of ($map*)) or
            // Unhooking indicators with ntdll
            (any of ($unhook*) and any of ($ntdll_path*) and any of ($map*))
        )
}


// ============================================================================
// RULE 7: Suspicious LSASS Process Opener
// Detects binaries with patterns for opening LSASS process
// ============================================================================

rule Suspicious_LSASS_Process_Opener
{
    meta:
        description = "Detects binaries designed to open LSASS process handle"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "medium"
        severity = "high"

    strings:
        // Process opening functions
        $open1 = "OpenProcess" ascii wide
        $open2 = "NtOpenProcess" ascii
        $open3 = "ZwOpenProcess" ascii

        // LSASS identification
        $lsass1 = "lsass.exe" ascii wide nocase
        $lsass2 = "lsass" ascii wide nocase
        $lsass3 = { 6C 00 73 00 61 00 73 00 73 00 2E 00 65 00 78 00 65 00 }  // lsass.exe Unicode

        // Process enumeration
        $enum1 = "EnumProcesses" ascii wide
        $enum2 = "CreateToolhelp32Snapshot" ascii wide
        $enum3 = "Process32First" ascii wide
        $enum4 = "Process32Next" ascii wide
        $enum5 = "NtQuerySystemInformation" ascii

        // Access rights constants
        $access1 = "PROCESS_ALL_ACCESS" ascii wide
        $access2 = "PROCESS_VM_READ" ascii wide
        $access3 = "PROCESS_QUERY_INFORMATION" ascii wide
        $access4 = { FF 0F 1F 00 }  // PROCESS_ALL_ACCESS value (0x001F0FFF)

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Process opening with LSASS
            (any of ($open*) and any of ($lsass*) and any of ($access*)) or
            // Process enumeration with LSASS target
            (2 of ($enum*) and any of ($lsass*)) or
            // Full access rights with LSASS
            ($access4 and any of ($lsass*))
        )
}


// ============================================================================
// RULE 8: Disguised Credential Dumper (library_update pattern)
// Detects credential dumpers disguised with innocuous names
// ============================================================================

rule Disguised_Credential_Dumper
{
    meta:
        description = "Detects credential dumpers with disguised file names"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "medium"
        severity = "high"

    strings:
        // Common disguise names (appears in PE resources/version info)
        $disguise1 = "library_update" ascii wide nocase
        $disguise2 = "system_update" ascii wide nocase
        $disguise3 = "windows_update" ascii wide nocase
        $disguise4 = "service_helper" ascii wide nocase
        $disguise5 = "runtime_host" ascii wide nocase

        // But contains credential dumping functionality
        $cred1 = "lsass" ascii wide nocase
        $cred2 = "SeDebugPrivilege" ascii wide
        $cred3 = "NtReadVirtualMemory" ascii
        $cred4 = "NtOpenProcess" ascii
        $cred5 = "PROCESS_ALL_ACCESS" ascii wide

        // Minidump indicators
        $dump1 = "MDMP" ascii
        $dump2 = "minidump" ascii wide nocase
        $dump3 = "Memory64ListStream" ascii wide

        // Output file indicators
        $out1 = ".dmp" ascii wide
        $out2 = ".docx" ascii wide  // Document disguise (as in this test)
        $out3 = ".bin" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Disguise name with credential functionality
            (any of ($disguise*) and 2 of ($cred*)) or
            // Disguise with minidump capability
            (any of ($disguise*) and any of ($dump*)) or
            // Document output disguise with credential access
            ($out2 and 2 of ($cred*))
        )
}


// ============================================================================
// RULE 9: Windows Credential Provider Strings
// Detects binaries targeting Windows credential providers
// ============================================================================

rule Credential_Provider_Target
{
    meta:
        description = "Detects binaries targeting Windows credential providers"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "b83616c2-84ee-4738-b398-d2d57eebecec"
        mitre_attack = "T1003.001"
        confidence = "medium"
        severity = "high"

    strings:
        // Credential provider DLLs
        $dll1 = "wdigest.dll" ascii wide nocase
        $dll2 = "kerberos.dll" ascii wide nocase
        $dll3 = "msv1_0.dll" ascii wide nocase
        $dll4 = "tspkg.dll" ascii wide nocase
        $dll5 = "cloudap.dll" ascii wide nocase

        // Credential structures
        $struct1 = "KIWI_" ascii wide  // Mimikatz structures
        $struct2 = "WDIGEST_CREDENTIALS" ascii wide
        $struct3 = "KERBEROS_CREDENTIALS" ascii wide
        $struct4 = "MSV1_0_" ascii wide
        $struct5 = "CREDENTIAL_" ascii wide

        // LSASS memory patterns
        $mem1 = "lsasrv.dll" ascii wide nocase
        $mem2 = "lsass" ascii wide nocase
        $mem3 = "ntlmshared.dll" ascii wide nocase

        // Decryption indicators
        $crypt1 = "BCryptDecrypt" ascii wide
        $crypt2 = "CryptUnprotectMemory" ascii wide
        $crypt3 = "LsaUnprotectMemory" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Multiple credential DLLs referenced
            (3 of ($dll*)) or
            // Credential structures with memory access
            (2 of ($struct*) and any of ($mem*)) or
            // Decryption with LSASS
            (any of ($crypt*) and any of ($mem*) and any of ($dll*))
        )
}
