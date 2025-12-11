/*
    ============================================================
    MDE Authentication Bypass Command Interception - YARA Rules
    Test ID: b6c73735-0c24-4a1e-8f0a-3c24af39671b
    MITRE ATT&CK: T1562.001, T1014, T1090.003, T1140, T1071.001
    Version: 2.0
    Author: F0RT1KA Defense Guidance Builder
    Date: 2025-01-22
    ============================================================
*/

import "pe"
import "hash"

/*
    ============================================================
    Rule 1: MDE Interceptor PowerShell Script
    Purpose: Detect the mde_interceptor.ps1 script
    Confidence: Critical
    ============================================================
*/
rule MDE_Auth_Bypass_Interceptor_Script
{
    meta:
        description = "Detects MDE authentication bypass interceptor PowerShell script"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1562.001, T1059.001"
        confidence = "critical"
        severity = "critical"

    strings:
        // Core function signatures
        $func1 = "Intercept-MDECommand" ascii wide nocase
        $func2 = "Generate-UnauthorizedCloudLRToken" ascii wide nocase
        $func3 = "Get-MDEConfigWithoutAuth" ascii wide nocase

        // MDE endpoint targets
        $endpoint1 = "winatp-gw-eus.microsoft.com" ascii wide nocase
        $endpoint2 = "winatp-gw-weu.microsoft.com" ascii wide nocase
        $endpoint3 = "winatp-gw-cus.microsoft.com" ascii wide nocase
        $endpoint4 = "winatp-gw-neu.microsoft.com" ascii wide nocase

        // Attack indicators
        $attack1 = "SPOOFING_ISOLATION" ascii wide
        $attack2 = "intercepted_commands" ascii wide
        $attack3 = "SpoofedResponse" ascii wide
        $attack4 = "CloudLR" ascii wide
        $attack5 = "interceptor_status" ascii wide

        // Status file patterns
        $status1 = "INITIALIZED" ascii wide
        $status2 = "RUNNING" ascii wide
        $status3 = "COMPLETED" ascii wide

    condition:
        (any of ($func*)) or
        (2 of ($endpoint*)) or
        (3 of ($attack*)) or
        (all of ($status*) and any of ($attack*))
}

/*
    ============================================================
    Rule 2: Fake MsSense Binary Detection
    Purpose: Detect fake MDE sensor binaries
    Confidence: High
    ============================================================
*/
rule MDE_Auth_Bypass_Fake_MsSense
{
    meta:
        description = "Detects fake MDE MsSense sensor binary"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1562.001"
        confidence = "high"
        severity = "critical"

    strings:
        // F0RT1KA test identifiers
        $test1 = "b6c73735-0c24-4a1e-8f0a-3c24af39671b" ascii wide
        $test2 = "F0RT1KA" ascii wide nocase

        // Fake sensor indicators
        $fake1 = "fake_mssense" ascii wide nocase
        $fake2 = "FakeMDESensor" ascii wide nocase
        $fake3 = "MDE Authentication Bypass" ascii wide

        // Go binary indicators (embedded from test)
        $go1 = "go.buildid" ascii
        $go2 = "runtime.main" ascii

        // MDE service mimicry
        $mimic1 = "Microsoft.Windows.Sense" ascii wide
        $mimic2 = "SenseService" ascii wide

        // Command interception indicators
        $cmd1 = "/edr/commands/cnc" ascii wide
        $cmd2 = "isolation" ascii wide nocase
        $cmd3 = "spoof" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 30MB and
        (
            (any of ($test*)) or
            (any of ($fake*)) or
            (all of ($go*) and 2 of ($cmd*)) or
            (any of ($mimic*) and any of ($cmd*))
        )
}

/*
    ============================================================
    Rule 3: Isolation Spoofer Tool Detection
    Purpose: Detect the isolation_spoofer.exe binary
    Confidence: Critical
    ============================================================
*/
rule MDE_Auth_Bypass_Isolation_Spoofer
{
    meta:
        description = "Detects MDE isolation status spoofing tool"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1562.001"
        confidence = "critical"
        severity = "critical"

    strings:
        // Tool identifiers
        $tool1 = "isolation_spoofer" ascii wide nocase
        $tool2 = "IsolationSpoofer" ascii wide

        // Spoof result indicators
        $spoof1 = "spoof_result" ascii wide
        $spoof2 = "ActualStatus" ascii wide
        $spoof3 = "PortalDisplay" ascii wide
        $spoof4 = "Device Isolated" ascii wide
        $spoof5 = "Device Fully Operational" ascii wide

        // JSON structure patterns
        $json1 = "\"Status\": \"isolated\"" ascii wide nocase
        $json2 = "\"status\":\"isolated\"" ascii wide nocase
        $json3 = "NotIsolated" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 20MB and
        (
            (any of ($tool*)) or
            (3 of ($spoof*)) or
            (any of ($json*) and any of ($spoof*))
        )
}

/*
    ============================================================
    Rule 4: Certificate Bypass Watchdog Detection
    Purpose: Detect the cert_bypass_watchdog.exe binary
    Confidence: High
    ============================================================
*/
rule MDE_Auth_Bypass_Cert_Watchdog
{
    meta:
        description = "Detects certificate pinning bypass watchdog process"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1014"
        confidence = "high"
        severity = "high"

    strings:
        // Watchdog identifiers
        $watchdog1 = "cert_bypass_watchdog" ascii wide nocase
        $watchdog2 = "CertBypassWatchdog" ascii wide
        $watchdog3 = "auto-restore" ascii wide

        // State file patterns
        $state1 = "watchdog_state.json" ascii wide
        $state2 = "monitoredPid" ascii wide
        $state3 = "autoRestoreTime" ascii wide
        $state4 = "patches" ascii wide

        // Memory patch indicators
        $patch1 = "originalBytes" ascii wide
        $patch2 = "patchApplied" ascii wide
        $patch3 = "requiresRestore" ascii wide
        $patch4 = "targetAddress" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 20MB and
        (
            (any of ($watchdog*)) or
            (3 of ($state*)) or
            (3 of ($patch*))
        )
}

/*
    ============================================================
    Rule 5: MDE Identifier Extraction Patterns
    Purpose: Detect files containing extracted MDE identifiers
    Confidence: High
    ============================================================
*/
rule MDE_Auth_Bypass_Identifier_Extraction
{
    meta:
        description = "Detects extracted MDE identifier data files"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1562.001"
        confidence = "high"
        severity = "high"

    strings:
        // JSON field names for MDE identifiers
        $field1 = "\"machineId\"" ascii wide nocase
        $field2 = "\"tenantId\"" ascii wide nocase
        $field3 = "\"orgId\"" ascii wide nocase
        $field4 = "\"senseId\"" ascii wide nocase
        $field5 = "\"onboardingState\"" ascii wide nocase
        $field6 = "\"mdeInstalled\"" ascii wide nocase
        $field7 = "\"extractionSuccess\"" ascii wide nocase

        // Source indicators
        $source1 = "\"source\": \"registry\"" ascii wide nocase
        $source2 = "\"source\": \"wmi_fallback\"" ascii wide nocase
        $source3 = "\"source\": \"config_files\"" ascii wide nocase

        // Registry paths (evidence of extraction method)
        $reg1 = "Windows Advanced Threat Protection" ascii wide

    condition:
        filesize < 10KB and
        (
            (4 of ($field*)) or
            (any of ($source*) and 3 of ($field*)) or
            ($reg1 and 2 of ($field*))
        )
}

/*
    ============================================================
    Rule 6: CloudLR Token Artifact Detection
    Purpose: Detect unauthorized CloudLR token files
    Confidence: Critical
    ============================================================
*/
rule MDE_Auth_Bypass_CloudLR_Token
{
    meta:
        description = "Detects unauthorized CloudLR (Live Response) token artifacts"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1134"
        confidence = "critical"
        severity = "critical"

    strings:
        // Token type indicators
        $token1 = "\"tokenType\": \"CloudLR\"" ascii wide nocase
        $token2 = "\"TokenType\": \"CloudLR\"" ascii wide nocase
        $token3 = "cloudlr_token" ascii wide nocase

        // Capabilities indicators
        $cap1 = "command_execution" ascii wide
        $cap2 = "file_download" ascii wide
        $cap3 = "file_upload" ascii wide
        $cap4 = "FileCollection" ascii wide
        $cap5 = "ProcessExecution" ascii wide
        $cap6 = "RegistryAccess" ascii wide

        // Auth bypass indicators
        $auth1 = "\"Authenticated\": false" ascii wide nocase
        $auth2 = "\"authenticated\":false" ascii wide nocase
        $auth3 = "authentication bypass" ascii wide nocase

    condition:
        filesize < 10KB and
        (
            (any of ($token*) and 2 of ($cap*)) or
            (any of ($auth*) and any of ($cap*)) or
            (any of ($token*) and any of ($auth*))
        )
}

/*
    ============================================================
    Rule 7: Attack Summary Report Detection
    Purpose: Detect attack summary files generated by the test
    Confidence: Medium
    ============================================================
*/
rule MDE_Auth_Bypass_Attack_Summary
{
    meta:
        description = "Detects MDE authentication bypass attack summary report"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1562.001"
        confidence = "medium"
        severity = "medium"

    strings:
        // Header patterns
        $header1 = "MDE Authentication Bypass Attack Simulation" ascii wide
        $header2 = "Attack Vector: MDE Cloud Communication Authentication Bypass" ascii wide

        // Test ID
        $testid = "b6c73735-0c24-4a1e-8f0a-3c24af39671b" ascii wide

        // Attack phase indicators
        $phase1 = "Real MDE identifier extraction" ascii wide nocase
        $phase2 = "Certificate pinning bypass" ascii wide nocase
        $phase3 = "Unauthenticated network access" ascii wide nocase
        $phase4 = "Command interception" ascii wide nocase
        $phase5 = "Isolation status spoofing" ascii wide nocase
        $phase6 = "CloudLR" ascii wide

        // MITRE references
        $mitre1 = "T1562.001" ascii wide
        $mitre2 = "T1014" ascii wide
        $mitre3 = "T1090.003" ascii wide

    condition:
        filesize < 50KB and
        (
            (any of ($header*) and $testid) or
            (4 of ($phase*)) or
            ($testid and 2 of ($mitre*))
        )
}

/*
    ============================================================
    Rule 8: Emergency Restore Script Detection
    Purpose: Detect the emergency restore PowerShell script
    Confidence: High
    ============================================================
*/
rule MDE_Auth_Bypass_Emergency_Restore
{
    meta:
        description = "Detects certificate bypass emergency restore script"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1014"
        confidence = "high"
        severity = "high"

    strings:
        // Script name patterns
        $name1 = "emergency_restore" ascii wide nocase
        $name2 = "EmergencyRestore" ascii wide

        // Restore function indicators
        $restore1 = "RestoreAllPatches" ascii wide
        $restore2 = "RestoreCertificatePinning" ascii wide
        $restore3 = "original bytes" ascii wide nocase

        // Safety mechanism indicators
        $safety1 = "watchdog_state" ascii wide
        $safety2 = "-Force" ascii wide
        $safety3 = "requiresRestore" ascii wide

    condition:
        filesize < 100KB and
        (
            (any of ($name*) and any of ($restore*)) or
            (2 of ($restore*) and any of ($safety*)) or
            (any of ($name*) and 2 of ($safety*))
        )
}

/*
    ============================================================
    Rule 9: Certificate Pinning Bypass Binary Detection
    Purpose: Detect binaries with certificate bypass capabilities
    Confidence: Critical
    ============================================================
*/
rule MDE_Auth_Bypass_Cert_Bypass_Binary
{
    meta:
        description = "Detects binaries with certificate pinning bypass capabilities"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1014"
        confidence = "critical"
        severity = "critical"

    strings:
        // CRYPT32 function targets
        $crypt1 = "CertVerifyCertificateChainPolicy" ascii wide
        $crypt2 = "CertGetCertificateChain" ascii wide
        $crypt3 = "CRYPT32.dll" ascii wide nocase
        $crypt4 = "crypt32.dll" ascii wide

        // Memory manipulation imports
        $mem1 = "VirtualProtectEx" ascii wide
        $mem2 = "WriteProcessMemory" ascii wide
        $mem3 = "ReadProcessMemory" ascii wide

        // Bypass mode indicators
        $mode1 = "BypassModeTestOnly" ascii wide
        $mode2 = "BypassModeQuickPatch" ascii wide
        $mode3 = "BypassModePersistent" ascii wide
        $mode4 = "TEST_ONLY" ascii wide
        $mode5 = "QUICK_PATCH" ascii wide
        $mode6 = "PERSISTENT" ascii wide

        // Patch byte patterns (x64 return TRUE)
        $patch = { B8 01 00 00 00 C3 }  // mov eax, 1; ret

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 30MB and
        (
            (2 of ($crypt*) and any of ($mem*)) or
            (any of ($mode*) and any of ($crypt*)) or
            ($patch and any of ($crypt*)) or
            (3 of ($mode*))
        )
}

/*
    ============================================================
    Rule 10: Network Test Results Detection
    Purpose: Detect network vulnerability test result files
    Confidence: Medium
    ============================================================
*/
rule MDE_Auth_Bypass_Network_Test_Results
{
    meta:
        description = "Detects MDE network authentication test result files"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1071.001"
        confidence = "medium"
        severity = "medium"

    strings:
        // File name patterns
        $file1 = "network_test_results" ascii wide nocase
        $file2 = "network_test_report" ascii wide nocase

        // Result indicators
        $result1 = "TestedEndpoints" ascii wide
        $result2 = "VulnerableCount" ascii wide
        $result3 = "ProtectedCount" ascii wide
        $result4 = "OverallVulnerable" ascii wide

        // Endpoint patterns
        $ep1 = "winatp-gw-eus" ascii wide
        $ep2 = "winatp-gw-weu" ascii wide
        $ep3 = "winatp-gw-cus" ascii wide
        $ep4 = "winatp-gw-neu" ascii wide

    condition:
        filesize < 50KB and
        (
            (any of ($file*) and 2 of ($result*)) or
            (2 of ($ep*) and any of ($result*)) or
            (3 of ($result*))
        )
}

/*
    ============================================================
    Rule 11: Main Test Binary Detection
    Purpose: Detect the main F0RT1KA MDE auth bypass test binary
    Confidence: High
    ============================================================
*/
rule MDE_Auth_Bypass_Main_Test_Binary
{
    meta:
        description = "Detects F0RT1KA MDE Authentication Bypass main test binary"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1562.001, T1014, T1090.003"
        confidence = "high"
        severity = "high"

    strings:
        // Test identifiers
        $id1 = "b6c73735-0c24-4a1e-8f0a-3c24af39671b" ascii wide
        $id2 = "MDE Authentication Bypass Command Interception" ascii wide

        // Embedded component names
        $embed1 = "mde_interceptor.ps1" ascii wide
        $embed2 = "MsSense.exe" ascii wide
        $embed3 = "isolation_spoofer.exe" ascii wide
        $embed4 = "cert_bypass_watchdog.exe" ascii wide
        $embed5 = "emergency_restore.ps1" ascii wide

        // Phase indicators
        $phase1 = "Phase 1: Initialization" ascii wide
        $phase2 = "Phase 2: MDE Identifier Extraction" ascii wide
        $phase3 = "Phase 3: Certificate Pinning Bypass" ascii wide
        $phase4 = "Phase 4: Network Authentication Testing" ascii wide

        // Prelude library indicators
        $prelude1 = "github.com/preludeorg/libraries" ascii
        $prelude2 = "Endpoint.Dropper" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            ($id1 and any of ($id2, $embed*)) or
            (3 of ($embed*)) or
            (3 of ($phase*)) or
            (any of ($prelude*) and any of ($id*))
        )
}

/*
    ============================================================
    Rule 12: Intercepted Commands Log Detection
    Purpose: Detect logs of intercepted MDE commands
    Confidence: Critical
    ============================================================
*/
rule MDE_Auth_Bypass_Intercepted_Commands
{
    meta:
        description = "Detects intercepted MDE commands log file"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-01-22"
        test_id = "b6c73735-0c24-4a1e-8f0a-3c24af39671b"
        mitre_attack = "T1562.001"
        confidence = "critical"
        severity = "critical"

    strings:
        // File name
        $file1 = "intercepted_commands" ascii wide nocase

        // Command types
        $cmd1 = "\"Type\": \"Isolation\"" ascii wide nocase
        $cmd2 = "\"Type\": \"LiveResponse\"" ascii wide nocase
        $cmd3 = "\"Type\": \"FileCollection\"" ascii wide nocase
        $cmd4 = "\"Type\": \"Investigation\"" ascii wide nocase

        // Action types
        $action1 = "\"Action\": \"Isolate\"" ascii wide nocase
        $action2 = "\"Action\": \"InitSession\"" ascii wide nocase
        $action3 = "\"Action\": \"Collect\"" ascii wide nocase

        // Intercept indicators
        $intercept1 = "\"Intercepted\": true" ascii wide nocase
        $intercept2 = "InterceptedCommands" ascii wide
        $intercept3 = "ExfiltratedConfig" ascii wide

    condition:
        filesize < 100KB and
        (
            ($file1 and 2 of ($cmd*)) or
            (2 of ($cmd*) and any of ($action*)) or
            (any of ($intercept*) and any of ($cmd*))
        )
}

/*
    ============================================================
    END OF YARA RULES
    ============================================================
    Summary of Coverage:
    - Rule 1: MDE Interceptor PowerShell Script
    - Rule 2: Fake MsSense Binary
    - Rule 3: Isolation Spoofer Tool
    - Rule 4: Certificate Bypass Watchdog
    - Rule 5: MDE Identifier Extraction Files
    - Rule 6: CloudLR Token Artifacts
    - Rule 7: Attack Summary Reports
    - Rule 8: Emergency Restore Script
    - Rule 9: Certificate Bypass Binary
    - Rule 10: Network Test Results
    - Rule 11: Main Test Binary
    - Rule 12: Intercepted Commands Log
    ============================================================
*/
