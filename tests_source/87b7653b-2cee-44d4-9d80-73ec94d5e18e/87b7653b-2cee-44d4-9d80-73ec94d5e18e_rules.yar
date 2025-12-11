/*
    ============================================================
    EDR-Freeze Defense Evasion - YARA Detection Rules
    Test ID: 87b7653b-2cee-44d4-9d80-73ec94d5e18e
    MITRE ATT&CK: T1562.001, T1055, T1574
    Author: F0RT1KA Defense Guidance Builder
    Version: 1.0.0
    Date: 2025-12-07
    ============================================================

    This file contains YARA rules for detecting:
    - EDR-Freeze tool and variants
    - Go binaries with embedded EDR-Freeze
    - Seatbelt reconnaissance tool
    - Certutil download command patterns
    - WerFaultSecure abuse indicators

    Rule Index:
      1. EDR_Freeze_Tool - Core EDR-Freeze tool detection
      2. EDR_Freeze_Embedded_Binary - Go binary with embedded tool
      3. EDR_Freeze_Strings - Suspicious strings in EDR-Freeze
      4. Seatbelt_Reconnaissance_Tool - GhostPack Seatbelt detection
      5. Certutil_Download_Pattern - Certutil LOLBin abuse
      6. WerFaultSecure_Abuse_Script - Scripts targeting WerFault
      7. CreateProcessAsPPL_Tool - PPL creation tool detection
      8. F0RT1KA_Test_Binary - F0RT1KA test framework binary

    ============================================================
*/


/*
    ============================================================
    Rule 1: EDR-Freeze Tool Detection
    ============================================================
    Detects EDR-Freeze tool based on unique string patterns,
    API imports, and behavioral indicators.
    ============================================================
*/
rule EDR_Freeze_Tool
{
    meta:
        description = "Detects EDR-Freeze defense evasion tool that suspends security processes via WerFaultSecure abuse"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1562.001, T1574"
        confidence = "high"
        severity = "critical"
        reference = "https://github.com/TwoSevenOneT/EDR-Freeze"

    strings:
        // Tool name and identifiers
        $name1 = "EDR-Freeze" ascii wide nocase
        $name2 = "EDRFreeze" ascii wide nocase
        $name3 = "edr_freeze" ascii wide nocase

        // Technique-specific strings
        $tech1 = "WerFaultSecure" ascii wide
        $tech2 = "MiniDumpWriteDump" ascii wide
        $tech3 = "CreateProcessAsPPL" ascii wide
        $tech4 = "WinTCB" ascii wide
        $tech5 = "PsProtectedSigner" ascii wide

        // Target process names
        $target1 = "MsMpEng" ascii wide nocase
        $target2 = "MpDefenderCoreService" ascii wide nocase
        $target3 = "NisSrv" ascii wide nocase

        // Error/status messages
        $msg1 = "Suspending" ascii wide
        $msg2 = "suspended" ascii wide
        $msg3 = "coma" ascii wide nocase

        // API patterns
        $api1 = "NtSuspendProcess" ascii wide
        $api2 = "NtResumeProcess" ascii wide
        $api3 = "NtQueryInformationProcess" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 5MB and
        (
            // Strong indicator: name + technique
            (any of ($name*) and any of ($tech*)) or
            // Medium indicator: technique + targets
            (2 of ($tech*) and any of ($target*)) or
            // API-based detection
            (any of ($tech*) and 2 of ($api*))
        )
}


/*
    ============================================================
    Rule 2: Go Binary with Embedded EDR-Freeze
    ============================================================
    Detects Go-compiled binaries that have EDR-Freeze.exe
    embedded using Go's embed directive.
    ============================================================
*/
rule EDR_Freeze_Embedded_Binary
{
    meta:
        description = "Detects Go binary with embedded EDR-Freeze tool (F0RT1KA test pattern)"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1562.001"
        confidence = "high"
        severity = "high"

    strings:
        // Go runtime indicators
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii

        // Embedded file markers (Go embed)
        $embed1 = "EDR-Freeze.exe" ascii wide
        $embed2 = "edrFreezeExe" ascii
        $embed3 = "go:embed" ascii

        // F0RT1KA framework indicators
        $f0_1 = "preludeorg" ascii
        $f0_2 = "c:\\F0" ascii wide nocase
        $f0_3 = "C:\\F0" ascii wide

        // Test UUID
        $uuid = "87b7653b-2cee-44d4-9d80-73ec94d5e18e" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        any of ($go*) and
        (
            any of ($embed*) or
            ($uuid and any of ($f0_*))
        )
}


/*
    ============================================================
    Rule 3: EDR-Freeze Suspicious Strings
    ============================================================
    Detects files containing suspicious string combinations
    related to EDR-Freeze attack methodology.
    ============================================================
*/
rule EDR_Freeze_Strings
{
    meta:
        description = "Detects suspicious string patterns associated with EDR-Freeze attack methodology"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1562.001, T1055"
        confidence = "medium"
        severity = "high"

    strings:
        // Process suspension patterns
        $susp1 = "suspend" ascii wide nocase
        $susp2 = "freeze" ascii wide nocase
        $susp3 = "coma" ascii wide nocase

        // Security product targeting
        $sec1 = "Defender" ascii wide
        $sec2 = "antivirus" ascii wide nocase
        $sec3 = "EDR" ascii wide
        $sec4 = "endpoint" ascii wide nocase

        // WER exploitation
        $wer1 = "WerFault" ascii wide
        $wer2 = "Windows Error Reporting" ascii wide
        $wer3 = "minidump" ascii wide nocase

        // Race condition indicators
        $race1 = "race condition" ascii wide nocase
        $race2 = "timing" ascii wide nocase

    condition:
        filesize < 10MB and
        (
            // Text file or script with attack methodology
            (2 of ($susp*) and any of ($sec*) and any of ($wer*)) or
            // Documentation or notes about the attack
            (any of ($race*) and any of ($wer*) and any of ($sec*))
        )
}


/*
    ============================================================
    Rule 4: Seatbelt Reconnaissance Tool
    ============================================================
    Detects the Seatbelt post-exploitation reconnaissance tool
    from GhostPack, commonly used after EDR bypass.
    ============================================================
*/
rule Seatbelt_Reconnaissance_Tool
{
    meta:
        description = "Detects Seatbelt reconnaissance tool from GhostPack"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1082, T1087"
        confidence = "high"
        severity = "high"
        reference = "https://github.com/GhostPack/Seatbelt"

    strings:
        // Tool identification
        $name1 = "Seatbelt" ascii wide
        $name2 = "GhostPack" ascii wide
        $name3 = "harmj0y" ascii wide

        // Module names
        $mod1 = "AMSIProviders" ascii wide
        $mod2 = "AntiVirus" ascii wide
        $mod3 = "AppLocker" ascii wide
        $mod4 = "ARPTable" ascii wide
        $mod5 = "AuditPolicies" ascii wide
        $mod6 = "CloudCredentials" ascii wide
        $mod7 = "CredentialGuard" ascii wide
        $mod8 = "DpapiMasterKeys" ascii wide
        $mod9 = "InterestingFiles" ascii wide
        $mod10 = "KerberosTickets" ascii wide
        $mod11 = "LocalGroups" ascii wide
        $mod12 = "LSASettings" ascii wide
        $mod13 = "NamedPipes" ascii wide
        $mod14 = "NetworkShares" ascii wide
        $mod15 = "NTLMSettings" ascii wide

        // .NET indicators
        $net1 = "_CorExeMain" ascii
        $net2 = "mscoree.dll" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 2MB and
        any of ($net*) and
        (
            any of ($name*) or
            5 of ($mod*)
        )
}


/*
    ============================================================
    Rule 5: Certutil Download Command Pattern
    ============================================================
    Detects scripts or memory containing certutil download
    commands used to fetch malicious executables.
    ============================================================
*/
rule Certutil_Download_Pattern
{
    meta:
        description = "Detects certutil.exe download commands commonly used for malicious downloads"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1105"
        confidence = "high"
        severity = "high"

    strings:
        // Certutil download patterns
        $cmd1 = "certutil" ascii wide nocase
        $cmd2 = "-urlcache" ascii wide nocase
        $cmd3 = "-urlfetch" ascii wide nocase
        $cmd4 = "-verifyctl" ascii wide nocase
        $cmd5 = "-split" ascii wide nocase

        // Download targets
        $target1 = "http://" ascii wide nocase
        $target2 = "https://" ascii wide nocase

        // File extensions
        $ext1 = ".exe" ascii wide nocase
        $ext2 = ".dll" ascii wide nocase
        $ext3 = ".ps1" ascii wide nocase

        // Known malicious repositories
        $repo1 = "github.com" ascii wide nocase
        $repo2 = "SharpCollection" ascii wide nocase
        $repo3 = "Flangvik" ascii wide nocase

    condition:
        filesize < 50KB and
        $cmd1 and
        any of ($cmd2, $cmd3, $cmd4, $cmd5) and
        any of ($target*) and
        (any of ($ext*) or any of ($repo*))
}


/*
    ============================================================
    Rule 6: WerFaultSecure Abuse Script
    ============================================================
    Detects scripts or tools that abuse WerFaultSecure.exe
    for process manipulation.
    ============================================================
*/
rule WerFaultSecure_Abuse_Script
{
    meta:
        description = "Detects scripts or tools abusing WerFaultSecure.exe for process manipulation"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1562.001, T1574"
        confidence = "medium"
        severity = "high"

    strings:
        // WerFault targeting
        $wer1 = "WerFaultSecure" ascii wide
        $wer2 = "WerFault.exe" ascii wide
        $wer3 = "werfault" ascii wide nocase

        // Process manipulation
        $proc1 = "/pid" ascii wide nocase
        $proc2 = "/tid" ascii wide nocase
        $proc3 = "/h" ascii wide

        // Script indicators
        $script1 = "powershell" ascii wide nocase
        $script2 = "cmd.exe" ascii wide nocase
        $script3 = ".bat" ascii wide nocase
        $script4 = ".ps1" ascii wide nocase

        // Security process names
        $sec1 = "MsMpEng" ascii wide
        $sec2 = "MpDefenderCoreService" ascii wide

    condition:
        filesize < 100KB and
        any of ($wer*) and
        (
            (any of ($proc*) and any of ($sec*)) or
            (any of ($script*) and any of ($proc*))
        )
}


/*
    ============================================================
    Rule 7: CreateProcessAsPPL Tool
    ============================================================
    Detects tools that create Protected Process Light (PPL)
    processes, often used in conjunction with EDR-Freeze.
    ============================================================
*/
rule CreateProcessAsPPL_Tool
{
    meta:
        description = "Detects CreateProcessAsPPL tool used for PPL process creation"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1055, T1574"
        confidence = "high"
        severity = "high"
        reference = "https://github.com/TwoSevenOneT/CreateProcessAsPPL"

    strings:
        // Tool name
        $name1 = "CreateProcessAsPPL" ascii wide
        $name2 = "ProcessAsPPL" ascii wide

        // PPL-related strings
        $ppl1 = "WinTcb" ascii wide
        $ppl2 = "WinSystem" ascii wide
        $ppl3 = "PsProtectedSigner" ascii wide
        $ppl4 = "ProtectedProcess" ascii wide
        $ppl5 = "PPL" ascii wide

        // Windows internal structures
        $int1 = "PROCESS_INFORMATION" ascii wide
        $int2 = "STARTUPINFO" ascii wide
        $int3 = "CREATE_PROTECTED_PROCESS" ascii wide

        // API patterns
        $api1 = "NtCreateUserProcess" ascii wide
        $api2 = "RtlCreateProcessParametersEx" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 5MB and
        (
            any of ($name*) or
            (2 of ($ppl*) and any of ($api*)) or
            (any of ($int*) and 2 of ($ppl*))
        )
}


/*
    ============================================================
    Rule 8: F0RT1KA Test Binary Pattern
    ============================================================
    Detects F0RT1KA security test framework binaries,
    specifically the EDR-Freeze test variant.
    ============================================================
*/
rule F0RT1KA_EDR_Freeze_Test
{
    meta:
        description = "Detects F0RT1KA security testing framework EDR-Freeze test binary"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1562.001"
        confidence = "very_high"
        severity = "informational"
        note = "This rule detects authorized security testing - verify with security team"

    strings:
        // Test UUID
        $uuid = "87b7653b-2cee-44d4-9d80-73ec94d5e18e" ascii wide nocase

        // F0RT1KA framework strings
        $f0_1 = "F0RT1KA" ascii wide
        $f0_2 = "preludeorg" ascii
        $f0_3 = "c:\\F0\\" ascii wide nocase
        $f0_4 = "C:\\F0\\" ascii wide

        // Test framework patterns
        $test1 = "EDR-Freeze Defense Evasion Test" ascii wide
        $test2 = "Test ID:" ascii wide
        $test3 = "Quarantined" ascii wide
        $test4 = "ExecutionPrevented" ascii wide

        // Go binary indicators
        $go1 = "runtime.gopanic" ascii
        $go2 = "go.buildid" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 25MB and
        (
            $uuid or
            (any of ($f0_*) and any of ($test*)) or
            (any of ($go*) and any of ($f0_*) and any of ($test*))
        )
}


/*
    ============================================================
    Rule 9: Generic Security Process Targeting
    ============================================================
    Detects files that reference multiple security product
    process names, indicating potential targeting.
    ============================================================
*/
rule Security_Process_Targeting
{
    meta:
        description = "Detects files referencing multiple security product processes"
        author = "F0RT1KA"
        date = "2025-12-07"
        test_id = "87b7653b-2cee-44d4-9d80-73ec94d5e18e"
        mitre_attack = "T1562.001, T1057"
        confidence = "medium"
        severity = "medium"

    strings:
        // Windows Defender
        $def1 = "MsMpEng" ascii wide
        $def2 = "MpDefenderCoreService" ascii wide
        $def3 = "NisSrv" ascii wide
        $def4 = "WinDefend" ascii wide

        // Microsoft Defender for Endpoint
        $mde1 = "SenseCE" ascii wide
        $mde2 = "SenseIR" ascii wide
        $mde3 = "MsSense" ascii wide

        // CrowdStrike
        $cs1 = "CSFalconService" ascii wide
        $cs2 = "CSFalconContainer" ascii wide

        // Cylance
        $cy1 = "CylanceSvc" ascii wide

        // SentinelOne
        $s1_1 = "SentinelAgent" ascii wide
        $s1_2 = "SentinelStaticEngine" ascii wide

        // Carbon Black
        $cb1 = "cb.exe" ascii wide
        $cb2 = "RepMgr" ascii wide

    condition:
        filesize < 10MB and
        (
            // Multiple vendor products referenced (cross-product targeting)
            (any of ($def*) and any of ($mde*)) or
            (any of ($def*) and any of ($cs*)) or
            (any of ($def*) and any of ($cy*)) or
            (any of ($def*) and any of ($s1_*)) or
            // Multiple processes from same vendor
            (3 of ($def*)) or
            (2 of ($mde*))
        )
}


/*
    ============================================================
    END OF FILE
    ============================================================
*/
