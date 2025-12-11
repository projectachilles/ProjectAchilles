/*
============================================================================
DEFENSE GUIDANCE: YARA Detection Rules
============================================================================
Test ID: 7e93865c-0033-4db3-af3c-a9f4215c1c49
Test Name: Process Injection via CreateRemoteThread
MITRE ATT&CK: T1055.002 - Process Injection: Portable Executable Injection
Created: 2025-12-07
Author: F0RT1KA Defense Guidance Builder
============================================================================

DETECTION PRINCIPLE:
These YARA rules detect process injection tools and techniques, including
the specific patterns used by CreateRemoteThread-based injection. They are
designed to catch both the F0RT1KA test and real-world injection tools.

USAGE:
  yara -r 7e93865c-0033-4db3-af3c-a9f4215c1c49_rules.yar <target>

============================================================================
*/


// ============================================================================
// RULE 1: F0RT1KA Process Injection Test Detection
// Detects the specific F0RT1KA CreateRemoteThread test binary
// ============================================================================

rule F0RT1KA_Process_Injection_CreateRemoteThread
{
    meta:
        description = "Detects F0RT1KA Process Injection via CreateRemoteThread test"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.002"
        confidence = "high"
        severity = "informational"
        threat_type = "Security Testing Framework"

    strings:
        // Test UUID
        $uuid1 = "7e93865c-0033-4db3-af3c-a9f4215c1c49" ascii wide nocase
        $uuid2 = "7e93865c" ascii wide nocase

        // Test name
        $name1 = "Process Injection via CreateRemoteThread" ascii wide
        $name2 = "Process Injection" ascii wide

        // F0RT1KA framework markers
        $framework1 = "F0RT1KA" ascii wide
        $framework2 = "c:\\F0" ascii wide nocase
        $framework3 = "Endpoint.Unprotected" ascii wide
        $framework4 = "Endpoint.ExecutionPrevented" ascii wide

        // Test-specific strings
        $test1 = "Attempting process injection" ascii wide
        $test2 = "PROTECTED: OpenProcess denied" ascii wide
        $test3 = "PROTECTED: VirtualAllocEx denied" ascii wide
        $test4 = "PROTECTED: CreateRemoteThread denied" ascii wide
        $test5 = "VULNERABLE: Process injection completed" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            $uuid1 or
            (any of ($name*) and any of ($framework*)) or
            (3 of ($test*))
        )
}


// ============================================================================
// RULE 2: CreateRemoteThread Injection Tool Generic
// Detects binaries with CreateRemoteThread process injection capabilities
// ============================================================================

rule CreateRemoteThread_Injection_Tool
{
    meta:
        description = "Detects tools using CreateRemoteThread for process injection"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.002"
        confidence = "high"
        severity = "high"

    strings:
        // Windows API imports for process injection
        $api1 = "OpenProcess" ascii
        $api2 = "VirtualAllocEx" ascii
        $api3 = "WriteProcessMemory" ascii
        $api4 = "CreateRemoteThread" ascii
        $api5 = "VirtualFreeEx" ascii

        // Additional injection-related APIs
        $api6 = "NtCreateThreadEx" ascii
        $api7 = "RtlCreateUserThread" ascii
        $api8 = "NtWriteVirtualMemory" ascii

        // Memory protection constants
        $const1 = { 40 00 00 00 }  // PAGE_EXECUTE_READWRITE = 0x40
        $const2 = "PAGE_EXECUTE_READWRITE" ascii wide

        // Error handling strings
        $err1 = "OpenProcess failed" ascii wide nocase
        $err2 = "VirtualAllocEx failed" ascii wide nocase
        $err3 = "WriteProcessMemory failed" ascii wide nocase
        $err4 = "CreateRemoteThread failed" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        (
            // Classic injection API chain
            (all of ($api1, $api2, $api3, $api4)) or
            // Alternative injection APIs with memory write
            ($api3 and any of ($api6, $api7)) or
            // Error handling indicates injection capability
            (3 of ($err*)) or
            // API chain with memory protection constant
            (3 of ($api1, $api2, $api3, $api4) and ($const1 or $const2))
        )
}


// ============================================================================
// RULE 3: Process Injection Shellcode Patterns
// Detects common shellcode patterns used in process injection
// ============================================================================

rule Process_Injection_Shellcode_Patterns
{
    meta:
        description = "Detects common shellcode patterns used in process injection"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.002"
        confidence = "medium"
        severity = "high"

    strings:
        // x64 shellcode prologue patterns
        $x64_1 = { 48 89 5C 24 ?? 48 89 74 24 ?? }  // mov [rsp+xx], rbx; mov [rsp+xx], rsi
        $x64_2 = { 48 83 EC ?? 48 8B }              // sub rsp, xx; mov ...
        $x64_3 = { 48 31 C0 }                        // xor rax, rax
        $x64_4 = { 48 31 D2 }                        // xor rdx, rdx
        $x64_5 = { 65 48 8B 04 25 60 00 00 00 }     // mov rax, gs:[0x60] (PEB access)

        // x86 shellcode prologue patterns
        $x86_1 = { 55 8B EC }                        // push ebp; mov ebp, esp
        $x86_2 = { 31 C0 }                           // xor eax, eax
        $x86_3 = { 64 A1 30 00 00 00 }              // mov eax, fs:[0x30] (PEB access)

        // Common shellcode API resolution patterns
        $api_res1 = "kernel32.dll" ascii wide nocase
        $api_res2 = "ntdll.dll" ascii wide nocase
        $api_res3 = "LoadLibraryA" ascii
        $api_res4 = "GetProcAddress" ascii

        // MessageBox shellcode (benign test payload)
        $msgbox1 = "MessageBoxA" ascii
        $msgbox2 = "MessageBoxW" ascii
        $msgbox3 = "user32.dll" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // x64 shellcode indicators with API resolution
            (2 of ($x64_*) and 2 of ($api_res*)) or
            // x86 shellcode indicators with API resolution
            (2 of ($x86_*) and 2 of ($api_res*)) or
            // MessageBox payload (common test shellcode)
            (any of ($msgbox*) and any of ($x64_*, $x86_*)) or
            // PEB access patterns (common in shellcode)
            ($x64_5 or $x86_3) and (any of ($api_res*))
        )
}


// ============================================================================
// RULE 4: Go Binary with Process Injection
// Detects Go-compiled binaries with process injection capabilities
// ============================================================================

rule Go_Process_Injection_Binary
{
    meta:
        description = "Detects Go binaries with process injection capabilities"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.002"
        confidence = "medium"
        severity = "high"

    strings:
        // Go runtime markers
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii
        $go4 = "runtime.main" ascii

        // Go Windows API bindings
        $goapi1 = "golang.org/x/sys/windows" ascii
        $goapi2 = "syscall.NewLazyDLL" ascii
        $goapi3 = "syscall.MustLoadDLL" ascii

        // Injection-related function references
        $inject1 = "OpenProcess" ascii
        $inject2 = "VirtualAllocEx" ascii
        $inject3 = "WriteProcessMemory" ascii
        $inject4 = "CreateRemoteThread" ascii
        $inject5 = "kernel32.dll" ascii wide

        // Process injection strings
        $str1 = "inject" ascii wide nocase
        $str2 = "shellcode" ascii wide nocase
        $str3 = "remote thread" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Go binary with Windows API injection calls
            (2 of ($go*) and 3 of ($inject*)) or
            // Go binary with injection-related strings
            (2 of ($go*) and 2 of ($str*)) or
            // Go Windows syscall with injection APIs
            (any of ($goapi*) and 3 of ($inject*))
        )
}


// ============================================================================
// RULE 5: Process Hollowing / RunPE Patterns
// Detects patterns associated with process hollowing technique
// ============================================================================

rule Process_Hollowing_Patterns
{
    meta:
        description = "Detects process hollowing / RunPE injection patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.012"
        confidence = "high"
        severity = "critical"

    strings:
        // Process hollowing APIs
        $api1 = "NtUnmapViewOfSection" ascii
        $api2 = "ZwUnmapViewOfSection" ascii
        $api3 = "NtResumeThread" ascii
        $api4 = "ResumeThread" ascii
        $api5 = "SetThreadContext" ascii
        $api6 = "GetThreadContext" ascii
        $api7 = "Wow64SetThreadContext" ascii
        $api8 = "NtSetContextThread" ascii

        // Process creation in suspended state
        $create1 = "CREATE_SUSPENDED" ascii wide
        $create2 = { 04 00 00 00 }  // CREATE_SUSPENDED = 0x4

        // Common hollowing targets
        $target1 = "svchost.exe" ascii wide nocase
        $target2 = "notepad.exe" ascii wide nocase
        $target3 = "explorer.exe" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Process hollowing API combination
            (any of ($api1, $api2) and any of ($api3, $api4, $api5, $api8)) or
            // Thread context manipulation with suspended creation
            (any of ($api5, $api6, $api7) and any of ($create*)) or
            // APIs with common targets
            (3 of ($api*) and any of ($target*))
        )
}


// ============================================================================
// RULE 6: Reflective DLL Injection Patterns
// Detects reflective DLL loader patterns
// ============================================================================

rule Reflective_DLL_Injection
{
    meta:
        description = "Detects reflective DLL injection patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.001"
        confidence = "high"
        severity = "critical"

    strings:
        // Reflective loader markers
        $reflect1 = "ReflectiveLoader" ascii wide
        $reflect2 = "ReflectiveDll" ascii wide
        $reflect3 = "reflective" ascii wide nocase

        // Manual PE loading patterns
        $pe1 = "IMAGE_DOS_HEADER" ascii
        $pe2 = "IMAGE_NT_HEADERS" ascii
        $pe3 = "IMAGE_SECTION_HEADER" ascii
        $pe4 = "VirtualAlloc" ascii

        // Relocation processing
        $reloc1 = "IMAGE_BASE_RELOCATION" ascii
        $reloc2 = ".reloc" ascii

        // Import resolution
        $import1 = "IMAGE_IMPORT_DESCRIPTOR" ascii
        $import2 = "GetProcAddress" ascii
        $import3 = "LoadLibraryA" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        (
            // Explicit reflective loader
            any of ($reflect*) or
            // Manual PE loading with relocation
            (2 of ($pe*) and any of ($reloc*) and any of ($import*))
        )
}


// ============================================================================
// RULE 7: Memory-Only Execution Patterns
// Detects patterns indicating fileless / memory-only execution
// ============================================================================

rule Memory_Only_Execution
{
    meta:
        description = "Detects memory-only execution patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055"
        confidence = "medium"
        severity = "high"

    strings:
        // Memory allocation with execute permissions
        $mem1 = "VirtualAlloc" ascii
        $mem2 = "VirtualProtect" ascii
        $mem3 = "NtAllocateVirtualMemory" ascii
        $mem4 = "ZwAllocateVirtualMemory" ascii

        // Memory protection flags
        $prot1 = "PAGE_EXECUTE" ascii wide
        $prot2 = "PAGE_EXECUTE_READ" ascii wide
        $prot3 = "PAGE_EXECUTE_READWRITE" ascii wide

        // Shellcode execution patterns
        $exec1 = "CallWindowProc" ascii
        $exec2 = "EnumWindows" ascii
        $exec3 = "CreateThread" ascii
        $exec4 = "QueueUserAPC" ascii

        // Anti-analysis / evasion
        $evasion1 = "IsDebuggerPresent" ascii
        $evasion2 = "CheckRemoteDebuggerPresent" ascii
        $evasion3 = "NtQueryInformationProcess" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Memory allocation with execute and execution
            (2 of ($mem*) and any of ($prot*) and any of ($exec*)) or
            // Memory operations with anti-analysis
            (2 of ($mem*) and 2 of ($evasion*))
        )
}


// ============================================================================
// RULE 8: F0RT1KA Framework Binary Generic
// Detects any F0RT1KA framework test binary
// ============================================================================

rule F0RT1KA_Framework_Binary
{
    meta:
        description = "Detects F0RT1KA security testing framework binaries"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.002"
        confidence = "high"
        severity = "informational"
        category = "Security Testing Framework"

    strings:
        // Framework name markers
        $framework1 = "F0RT1KA" ascii wide
        $framework2 = "f0rt1ka" ascii wide nocase
        $framework3 = "F0RTIKA" ascii wide

        // Framework directory
        $dir1 = "c:\\F0\\" ascii wide nocase
        $dir2 = "c:/F0/" ascii wide nocase

        // Exit code constants
        $exitcode1 = "Endpoint.Unprotected" ascii wide
        $exitcode2 = "Endpoint.ExecutionPrevented" ascii wide
        $exitcode3 = "Endpoint.FileQuarantinedOnExtraction" ascii wide
        $exitcode4 = "Endpoint.UnexpectedTestError" ascii wide

        // Prelude library imports
        $prelude1 = "preludeorg/libraries" ascii
        $prelude2 = "github.com/preludeorg" ascii

        // Test logger patterns
        $logger1 = "test_execution_log" ascii wide
        $logger2 = "TestMetadata" ascii
        $logger3 = "ExecutionContext" ascii
        $logger4 = "LogMessage" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            any of ($framework*) or
            (any of ($dir*) and any of ($exitcode*)) or
            (any of ($prelude*) and any of ($logger*))
        )
}


// ============================================================================
// RULE 9: Suspicious Notepad.exe Spawning Patterns
// Detects patterns of binaries designed to spawn notepad as injection target
// ============================================================================

rule Suspicious_Notepad_Spawner
{
    meta:
        description = "Detects binaries designed to spawn notepad as injection target"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.002"
        confidence = "medium"
        severity = "medium"

    strings:
        // Notepad references
        $notepad1 = "notepad.exe" ascii wide nocase
        $notepad2 = "notepad" ascii wide nocase

        // Process creation APIs
        $create1 = "CreateProcess" ascii
        $create2 = "ShellExecute" ascii
        $create3 = "WinExec" ascii

        // Injection-related APIs
        $inject1 = "OpenProcess" ascii
        $inject2 = "VirtualAllocEx" ascii
        $inject3 = "WriteProcessMemory" ascii
        $inject4 = "CreateRemoteThread" ascii

        // Target strings
        $target1 = "target process" ascii wide nocase
        $target2 = "injection target" ascii wide nocase
        $target3 = "target PID" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Notepad with injection APIs
            (any of ($notepad*) and 3 of ($inject*)) or
            // Notepad with process creation and injection
            (any of ($notepad*) and any of ($create*) and 2 of ($inject*)) or
            // Explicit target references with injection APIs
            (any of ($target*) and 2 of ($inject*))
        )
}


// ============================================================================
// RULE 10: Cobalt Strike Beacon Injection Patterns
// Detects patterns associated with Cobalt Strike beacon injection
// ============================================================================

rule CobaltStrike_Injection_Patterns
{
    meta:
        description = "Detects Cobalt Strike-style injection patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "7e93865c-0033-4db3-af3c-a9f4215c1c49"
        mitre_attack = "T1055.002"
        confidence = "high"
        severity = "critical"

    strings:
        // Cobalt Strike markers
        $cs1 = "%s as %s\\%s: %d" ascii
        $cs2 = "beacon.dll" ascii wide
        $cs3 = "beacon.x64.dll" ascii wide

        // Named pipe patterns
        $pipe1 = "\\\\.\\pipe\\msagent" ascii wide
        $pipe2 = "\\\\.\\pipe\\MSSE-" ascii wide
        $pipe3 = "\\pipe\\" ascii wide

        // Spawn-to patterns
        $spawn1 = "spawnto_x86" ascii wide
        $spawn2 = "spawnto_x64" ascii wide

        // Injection patterns
        $inject1 = "process-inject" ascii wide
        $inject2 = "shinject" ascii wide
        $inject3 = "dllspawn" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (
            // Cobalt Strike markers
            any of ($cs*) or
            // Spawn-to configuration
            any of ($spawn*) or
            // Injection module patterns
            2 of ($inject*) or
            // Named pipe with injection
            (any of ($pipe*) and any of ($inject*))
        )
}
