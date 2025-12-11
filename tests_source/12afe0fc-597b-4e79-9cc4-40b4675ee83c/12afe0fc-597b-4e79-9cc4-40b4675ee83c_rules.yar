/*
============================================================================
DEFENSE GUIDANCE: YARA Detection Rules
============================================================================
Test ID: 12afe0fc-597b-4e79-9cc4-40b4675ee83c
Test Name: LimaCharlie Timeout Validation Harness
MITRE ATT&CK: T1497.001 - Virtualization/Sandbox Evasion: System Checks
Created: 2025-12-07
Author: F0RT1KA Defense Guidance Builder
============================================================================

DETECTION PRINCIPLE:
These YARA rules detect timing-based sandbox evasion techniques and the
specific patterns used by the LimaCharlie Timeout Validation Harness.
While this is a utility test, the detection patterns are applicable to
real-world malware that uses extended execution times for evasion.

============================================================================
*/


// ============================================================================
// RULE 1: LimaCharlie Timeout Validation Harness Detection
// Detects the specific F0RT1KA timeout validation test binary
// ============================================================================

rule F0RT1KA_Timeout_Validation_Harness
{
    meta:
        description = "Detects the F0RT1KA LimaCharlie Timeout Validation Harness"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
        confidence = "high"
        severity = "low"
        threat_type = "Utility Test"

    strings:
        // Test UUID
        $uuid1 = "12afe0fc-597b-4e79-9cc4-40b4675ee83c" ascii wide nocase
        $uuid2 = "12afe0fc" ascii wide nocase

        // Test name and purpose
        $name1 = "LimaCharlie Timeout Validation" ascii wide nocase
        $name2 = "Timeout Validation Harness" ascii wide nocase

        // Stage binary patterns
        $stage1 = "stage-T1497.001-1" ascii wide
        $stage2 = "stage-T1497.001-2" ascii wide
        $stage3 = "stage-T1497.001-3" ascii wide

        // Console output patterns
        $output1 = "[STAGE 1]" ascii wide
        $output2 = "[STAGE 2]" ascii wide
        $output3 = "[STAGE 3]" ascii wide
        $output4 = "Progress:" ascii wide
        $output5 = "seconds remaining" ascii wide

        // F0RT1KA framework markers
        $framework1 = "F0RT1KA" ascii wide
        $framework2 = "c:\\F0" ascii wide nocase
        $framework3 = "Endpoint.Unprotected" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            $uuid1 or
            (any of ($name*) and any of ($stage*)) or
            (all of ($output1, $output2, $output3) and any of ($framework*)) or
            (3 of ($stage*))
        )
}


// ============================================================================
// RULE 2: Generic Timeout/Sleep Evasion Tool
// Detects binaries that implement extended sleep for sandbox evasion
// ============================================================================

rule Timeout_Evasion_Tool_Generic
{
    meta:
        description = "Detects tools using extended sleep for sandbox evasion"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
        confidence = "medium"
        severity = "medium"

    strings:
        // Sleep function imports
        $sleep1 = "Sleep" ascii
        $sleep2 = "SleepEx" ascii
        $sleep3 = "WaitForSingleObject" ascii
        $sleep4 = "NtDelayExecution" ascii

        // Time-related APIs
        $time1 = "GetTickCount" ascii
        $time2 = "GetTickCount64" ascii
        $time3 = "QueryPerformanceCounter" ascii
        $time4 = "timeGetTime" ascii

        // Timing-related strings (sandbox detection)
        $timing1 = "timeout" ascii wide nocase
        $timing2 = "sleep" ascii wide nocase
        $timing3 = "delay" ascii wide nocase
        $timing4 = "wait" ascii wide nocase
        $timing5 = "seconds" ascii wide nocase

        // Progress/stage patterns
        $progress1 = "Progress" ascii wide
        $progress2 = "Stage" ascii wide
        $progress3 = "elapsed" ascii wide
        $progress4 = "remaining" ascii wide

        // Sandbox evasion strings
        $evasion1 = "sandbox" ascii wide nocase
        $evasion2 = "virtual" ascii wide nocase
        $evasion3 = "analysis" ascii wide nocase
        $evasion4 = "evasion" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 20MB and
        (
            // Has sleep functions with timing logic
            (2 of ($sleep*) and 2 of ($time*) and 2 of ($timing*)) or
            // Has progress reporting with timing
            (3 of ($progress*) and 2 of ($timing*)) or
            // Explicit evasion indicators
            (any of ($evasion*) and 2 of ($sleep*))
        )
}


// ============================================================================
// RULE 3: Go Binary with Sleep Loop Pattern
// Detects Go-compiled binaries with timing-based loops
// ============================================================================

rule Go_Sleep_Loop_Pattern
{
    meta:
        description = "Detects Go binaries with sleep loop patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
        confidence = "medium"
        severity = "low"

    strings:
        // Go runtime markers
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii
        $go4 = "runtime.main" ascii

        // Go time package functions
        $gotime1 = "time.Sleep" ascii
        $gotime2 = "time.After" ascii
        $gotime3 = "time.NewTimer" ascii
        $gotime4 = "time.Duration" ascii
        $gotime5 = "time.Second" ascii

        // Duration strings
        $duration1 = "120s" ascii wide
        $duration2 = "30s" ascii wide
        $duration3 = "2m0s" ascii wide
        $duration4 = "time.Since" ascii

        // Progress output patterns
        $output1 = "Starting - Will wait" ascii wide
        $output2 = "seconds elapsed" ascii wide
        $output3 = "Completed in" ascii wide
        $output4 = "Exiting with code" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Go binary with time/sleep functions
            2 of ($go*) and 2 of ($gotime*) and
            (any of ($duration*) or any of ($output*))
        )
}


// ============================================================================
// RULE 4: Stage Binary Naming Pattern
// Detects binaries with staged execution naming conventions
// ============================================================================

rule Stage_Binary_Pattern
{
    meta:
        description = "Detects binaries with stage/phase execution naming"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
        confidence = "medium"
        severity = "medium"

    strings:
        // Stage naming patterns
        $stage1 = "stage-" ascii wide nocase
        $stage2 = "stage_" ascii wide nocase
        $stage3 = "phase-" ascii wide nocase
        $stage4 = "phase_" ascii wide nocase
        $stage5 = "step-" ascii wide nocase
        $stage6 = "step_" ascii wide nocase

        // MITRE technique references in filenames
        $mitre1 = "T1497" ascii wide
        $mitre2 = "T1036" ascii wide
        $mitre3 = "T1055" ascii wide

        // Numbered sequence patterns
        $num1 = "-1.exe" ascii wide nocase
        $num2 = "-2.exe" ascii wide nocase
        $num3 = "-3.exe" ascii wide nocase
        $num4 = "_1.exe" ascii wide nocase
        $num5 = "_2.exe" ascii wide nocase

        // Exit code patterns
        $exit1 = "os.Exit(101)" ascii
        $exit2 = "Exit(101)" ascii wide
        $exit3 = "exit code 101" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        (
            // Stage naming with numbering
            (any of ($stage*) and any of ($num*)) or
            // MITRE technique naming
            (any of ($mitre*) and any of ($num*)) or
            // Stage naming with specific exit codes
            (any of ($stage*) and any of ($exit*))
        )
}


// ============================================================================
// RULE 5: F0RT1KA Framework Indicator
// Detects binaries with F0RT1KA framework markers
// ============================================================================

rule F0RT1KA_Framework_Binary
{
    meta:
        description = "Detects binaries built with F0RT1KA framework markers"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
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
// RULE 6: Embedded Binary with Sleep Pattern
// Detects PE files embedded within other PE files with timing code
// ============================================================================

rule Embedded_Binary_Sleep_Pattern
{
    meta:
        description = "Detects embedded PE binaries with sleep/timing patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
        confidence = "medium"
        severity = "medium"

    strings:
        // Embedded PE markers (beyond first PE header)
        $pe_marker = { 4D 5A }  // MZ header

        // Go embed directive
        $embed1 = "//go:embed" ascii
        $embed2 = "go:embed" ascii

        // Stage binary references
        $stage1 = "stage1Binary" ascii
        $stage2 = "stage2Binary" ascii
        $stage3 = "stage3Binary" ascii

        // Sleep/timing strings
        $sleep1 = "time.Sleep" ascii
        $sleep2 = "Sleep" ascii
        $sleep3 = "WAIT_DURATION" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Multiple PE markers (embedded binaries)
            #pe_marker >= 2 and
            (any of ($embed*) or any of ($stage*)) and
            any of ($sleep*)
        )
}


// ============================================================================
// RULE 7: Progress Logging Pattern
// Detects binaries with periodic progress output patterns
// ============================================================================

rule Progress_Logging_Pattern
{
    meta:
        description = "Detects binaries with periodic progress logging"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
        confidence = "low"
        severity = "informational"

    strings:
        // Progress output format strings
        $fmt1 = "Progress: %d/%d" ascii wide
        $fmt2 = "Progress:" ascii wide
        $fmt3 = "%d seconds elapsed" ascii wide
        $fmt4 = "%d seconds remaining" ascii wide
        $fmt5 = "Completed in %v" ascii wide

        // Status prefixes
        $prefix1 = "[STAGE" ascii wide
        $prefix2 = "[*]" ascii wide
        $prefix3 = "[+]" ascii wide
        $prefix4 = "[INFO]" ascii wide

        // Timing intervals
        $interval1 = "LOG_INTERVAL" ascii
        $interval2 = "30" ascii  // 30 second intervals
        $interval3 = "every 30" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        (
            // Format strings with progress patterns
            2 of ($fmt*) or
            // Status prefix with timing
            (any of ($prefix*) and any of ($interval*))
        )
}


// ============================================================================
// RULE 8: Sandbox Time Acceleration Detection
// Detects code that checks for time acceleration (sandbox indicator)
// ============================================================================

rule Sandbox_Time_Check
{
    meta:
        description = "Detects code checking for sandbox time acceleration"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
        confidence = "medium"
        severity = "medium"

    strings:
        // Time verification patterns
        $verify1 = "time.Since" ascii
        $verify2 = "actual.*expected" ascii wide nocase
        $verify3 = "elapsed.*duration" ascii wide nocase

        // Sandbox detection strings
        $sandbox1 = "sandbox" ascii wide nocase
        $sandbox2 = "virtual" ascii wide nocase
        $sandbox3 = "analysis" ascii wide nocase
        $sandbox4 = "emulation" ascii wide nocase

        // Time comparison APIs
        $api1 = "GetTickCount" ascii
        $api2 = "GetSystemTime" ascii
        $api3 = "QueryPerformanceCounter" ascii
        $api4 = "timeGetTime" ascii

        // Acceleration check strings
        $accel1 = "time acceleration" ascii wide nocase
        $accel2 = "sleep skipping" ascii wide nocase
        $accel3 = "fast forward" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Time verification with sandbox strings
            (any of ($verify*) and any of ($sandbox*)) or
            // Time APIs with acceleration checks
            (2 of ($api*) and any of ($accel*)) or
            // Multiple sandbox detection indicators
            (3 of ($sandbox*))
        )
}


// ============================================================================
// RULE 9: Multi-Stage Orchestrator Pattern
// Detects binaries that orchestrate multiple child processes
// ============================================================================

rule Multi_Stage_Orchestrator
{
    meta:
        description = "Detects multi-stage orchestrator binaries"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "12afe0fc-597b-4e79-9cc4-40b4675ee83c"
        mitre_attack = "T1497.001"
        confidence = "medium"
        severity = "medium"

    strings:
        // Process execution APIs
        $exec1 = "exec.Command" ascii
        $exec2 = "CreateProcess" ascii
        $exec3 = "ShellExecute" ascii
        $exec4 = "cmd.Run" ascii

        // Stage/kill chain patterns
        $chain1 = "killchain" ascii wide nocase
        $chain2 = "KillchainStage" ascii
        $chain3 = "AttackStage" ascii
        $chain4 = "ExecutionStage" ascii

        // Phase execution strings
        $phase1 = "Phase 0" ascii wide
        $phase2 = "Phase 1" ascii wide
        $phase3 = "Stage %d" ascii wide
        $phase4 = "executeStage" ascii

        // Binary extraction patterns
        $extract1 = "extractStage" ascii
        $extract2 = "WriteFile" ascii
        $extract3 = "os.WriteFile" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Process execution with staging
            (any of ($exec*) and any of ($chain*)) or
            // Phase execution with extraction
            (2 of ($phase*) and any of ($extract*)) or
            // Kill chain orchestration
            (any of ($chain*) and any of ($extract*))
        )
}
