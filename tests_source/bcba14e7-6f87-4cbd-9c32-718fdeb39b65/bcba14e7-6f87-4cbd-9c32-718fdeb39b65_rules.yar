/*
    ============================================================
    EDRSilencer Detection - YARA Rules
    Test ID: bcba14e7-6f87-4cbd-9c32-718fdeb39b65
    MITRE ATT&CK: T1562.001 - Impair Defenses: Disable or Modify Tools
    Author: F0RT1KA Defense Guidance Builder
    Date: 2024-12-07
    ============================================================

    These rules detect EDRSilencer and similar EDR tampering tools
    based on file content, strings, and behavioral patterns.

    Usage:
        yara -r bcba14e7-6f87-4cbd-9c32-718fdeb39b65_rules.yar /path/to/scan

    ============================================================
*/


/*
    ============================================================
    Rule: EDRSilencer_Binary
    Confidence: High
    Description: Detects EDRSilencer binary by unique strings and structure
    ============================================================
*/
rule EDRSilencer_Binary
{
    meta:
        description = "Detects EDRSilencer tool binary used for blocking EDR communications"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-12-07"
        test_id = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
        mitre_attack = "T1562.001"
        confidence = "high"
        reference = "https://github.com/netero1010/EDRSilencer"

    strings:
        // EDRSilencer specific strings
        $name1 = "EDRSilencer" ascii wide nocase
        $name2 = "edrsilencer" ascii wide nocase

        // Command parameters
        $cmd1 = "blockedr" ascii wide nocase
        $cmd2 = "unblockall" ascii wide nocase
        $cmd3 = "unblock" ascii wide nocase

        // WFP API function names
        $api1 = "FwpmEngineOpen0" ascii wide
        $api2 = "FwpmFilterAdd0" ascii wide
        $api3 = "FwpmFilterDeleteById0" ascii wide
        $api4 = "FwpmGetAppIdFromFileName0" ascii wide
        $api5 = "FwpmSubLayerAdd0" ascii wide

        // EDR process names targeted
        $edr1 = "MsMpEng" ascii wide nocase
        $edr2 = "MpDefenderCoreService" ascii wide nocase
        $edr3 = "NisSrv" ascii wide nocase
        $edr4 = "SenseCE" ascii wide nocase
        $edr5 = "MsSense" ascii wide nocase
        $edr6 = "CylanceSvc" ascii wide nocase
        $edr7 = "CSFalconService" ascii wide nocase
        $edr8 = "SentinelAgent" ascii wide nocase
        $edr9 = "CarbonBlack" ascii wide nocase
        $edr10 = "TmListen" ascii wide nocase

        // Library import
        $lib1 = "fwpuclnt.dll" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 5MB and
        (
            // Definitive match: EDRSilencer name + commands
            (any of ($name*) and any of ($cmd*)) or
            // High confidence: WFP APIs + EDR targets
            (3 of ($api*) and 3 of ($edr*)) or
            // Medium confidence: Name + WFP APIs
            (any of ($name*) and 2 of ($api*))
        )
}


/*
    ============================================================
    Rule: EDRSilencer_Strings_Generic
    Confidence: Medium
    Description: Detects files containing EDRSilencer-related strings
    ============================================================
*/
rule EDRSilencer_Strings_Generic
{
    meta:
        description = "Detects files containing EDRSilencer tool strings"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-12-07"
        test_id = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
        mitre_attack = "T1562.001"
        confidence = "medium"
        reference = "https://github.com/netero1010/EDRSilencer"

    strings:
        // Tool identification
        $tool1 = "EDRSilencer" ascii wide nocase
        $tool2 = "Usage: EDRSilencer.exe" ascii wide
        $tool3 = "netero1010" ascii wide  // Author

        // Operational strings
        $op1 = "Add WFP filters to block" ascii wide
        $op2 = "Remove all WFP filters" ascii wide
        $op3 = "block the IPv4 and IPv6 outbound traffic" ascii wide
        $op4 = "detected EDR processes" ascii wide

        // Console output strings
        $out1 = "Found and blocked:" ascii wide
        $out2 = "Unblocking filter" ascii wide
        $out3 = "WFP filter added successfully" ascii wide

    condition:
        filesize < 10MB and
        (
            2 of ($tool*) or
            2 of ($op*) or
            (any of ($tool*) and any of ($out*))
        )
}


/*
    ============================================================
    Rule: WFP_Filter_Manipulation_Tool
    Confidence: Medium
    Description: Detects tools designed to manipulate Windows Filtering Platform
    ============================================================
*/
rule WFP_Filter_Manipulation_Tool
{
    meta:
        description = "Detects tools that manipulate Windows Filtering Platform filters"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-12-07"
        test_id = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
        mitre_attack = "T1562.001"
        confidence = "medium"

    strings:
        // WFP API imports (complete set)
        $api1 = "FwpmEngineOpen0" ascii wide
        $api2 = "FwpmFilterAdd0" ascii wide
        $api3 = "FwpmFilterDeleteById0" ascii wide
        $api4 = "FwpmFilterDeleteByKey0" ascii wide
        $api5 = "FwpmFilterEnum0" ascii wide
        $api6 = "FwpmGetAppIdFromFileName0" ascii wide
        $api7 = "FwpmSubLayerAdd0" ascii wide
        $api8 = "FwpmSubLayerDeleteByKey0" ascii wide
        $api9 = "FwpmEngineClose0" ascii wide
        $api10 = "FwpmFilterCreateEnumHandle0" ascii wide

        // WFP layer GUIDs (common for outbound filtering)
        $guid1 = "FWPM_LAYER_ALE_AUTH_CONNECT" ascii wide
        $guid2 = "FWPM_LAYER_ALE_AUTH_LISTEN" ascii wide
        $guid3 = "FWPM_LAYER_OUTBOUND_TRANSPORT" ascii wide
        $guid4 = {C3 8D 41 C9 46 21 12 4E 80 F2 3E 6D 2F 28 14 07}  // FWPM_LAYER_ALE_AUTH_CONNECT_V4

        // Action types
        $action1 = "FWP_ACTION_BLOCK" ascii wide
        $action2 = "FWP_ACTION_PERMIT" ascii wide

        // Library
        $lib1 = "fwpuclnt" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 10MB and
        (
            // 4+ WFP APIs + blocking action
            (4 of ($api*) and any of ($action*)) or
            // 3+ WFP APIs + layer GUIDs
            (3 of ($api*) and any of ($guid*)) or
            // Library + multiple APIs
            ($lib1 and 4 of ($api*))
        )
}


/*
    ============================================================
    Rule: EDR_Process_Targeting_Strings
    Confidence: Medium
    Description: Detects tools that enumerate or target EDR processes by name
    ============================================================
*/
rule EDR_Process_Targeting_Strings
{
    meta:
        description = "Detects tools containing strings to identify and target EDR processes"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-12-07"
        test_id = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
        mitre_attack = "T1562.001"
        confidence = "medium"

    strings:
        // Microsoft Defender processes
        $ms1 = "MsMpEng.exe" ascii wide nocase
        $ms2 = "MpDefenderCoreService.exe" ascii wide nocase
        $ms3 = "NisSrv.exe" ascii wide nocase
        $ms4 = "SenseCE.exe" ascii wide nocase
        $ms5 = "SenseIR.exe" ascii wide nocase
        $ms6 = "SenseNdr.exe" ascii wide nocase
        $ms7 = "MsSense.exe" ascii wide nocase

        // CrowdStrike
        $cs1 = "CSFalconService.exe" ascii wide nocase
        $cs2 = "CSFalconContainer.exe" ascii wide nocase

        // Cylance
        $cy1 = "CylanceSvc.exe" ascii wide nocase

        // SentinelOne
        $s1_1 = "SentinelAgent.exe" ascii wide nocase
        $s1_2 = "SentinelServiceHost.exe" ascii wide nocase

        // Carbon Black
        $cb1 = "cb.exe" ascii wide nocase
        $cb2 = "CarbonBlack.exe" ascii wide nocase
        $cb3 = "cbdefense.exe" ascii wide nocase

        // TrendMicro
        $tm1 = "TmListen.exe" ascii wide nocase
        $tm2 = "TmCCSF.exe" ascii wide nocase
        $tm3 = "TMBMSRV.exe" ascii wide nocase

        // Palo Alto Cortex
        $pa1 = "Traps.exe" ascii wide nocase
        $pa2 = "CortexXDR.exe" ascii wide nocase
        $pa3 = "cyserver.exe" ascii wide nocase

        // Elastic
        $el1 = "elastic-agent.exe" ascii wide nocase
        $el2 = "elastic-endpoint.exe" ascii wide nocase

        // Trellix/McAfee
        $tr1 = "mfetp.exe" ascii wide nocase
        $tr2 = "mfemactl.exe" ascii wide nocase

        // Other EDRs
        $oth1 = "FortiEDR.exe" ascii wide nocase
        $oth2 = "sfc.exe" ascii wide nocase  // Cisco
        $oth3 = "ERAAgent.exe" ascii wide nocase  // ESET
        $oth4 = "Tanium" ascii wide nocase
        $oth5 = "Cybereason" ascii wide nocase

        // Blocking/disabling keywords
        $kill1 = "taskkill" ascii wide nocase
        $kill2 = "terminate" ascii wide nocase
        $kill3 = "stop" ascii wide nocase
        $kill4 = "disable" ascii wide nocase
        $kill5 = "block" ascii wide nocase

    condition:
        filesize < 10MB and
        (
            // Multiple EDR process names (unlikely in benign software)
            5 of ($ms*, $cs*, $cy*, $s1_*, $cb*, $tm*, $pa*, $el*, $tr*, $oth*) or
            // EDR names + killing keywords
            (3 of ($ms*, $cs*, $cy*, $s1_*, $cb*, $tm*, $pa*, $el*, $tr*, $oth*) and any of ($kill*))
        )
}


/*
    ============================================================
    Rule: FireBlock_Tool
    Confidence: High
    Description: Detects FireBlock tool (similar to EDRSilencer)
    ============================================================
*/
rule FireBlock_Tool
{
    meta:
        description = "Detects MdSec NightHawk FireBlock tool for EDR evasion"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-12-07"
        test_id = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
        mitre_attack = "T1562.001"
        confidence = "high"
        reference = "https://www.mdsec.co.uk/2023/09/nighthawk-0-2-6-three-wise-monkeys/"

    strings:
        $name1 = "FireBlock" ascii wide nocase
        $name2 = "fireblock" ascii wide nocase
        $name3 = "NightHawk" ascii wide nocase

        // WFP APIs
        $api1 = "FwpmEngineOpen" ascii wide
        $api2 = "FwpmFilterAdd" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (
            any of ($name*) and any of ($api*)
        )
}


/*
    ============================================================
    Rule: EDR_Evasion_Tool_Generic
    Confidence: Medium
    Description: Generic detection for EDR evasion/tampering tools
    ============================================================
*/
rule EDR_Evasion_Tool_Generic
{
    meta:
        description = "Generic detection for tools designed to evade or disable EDR solutions"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-12-07"
        test_id = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
        mitre_attack = "T1562.001"
        confidence = "medium"

    strings:
        // Tool names
        $tool1 = "EDRSilencer" ascii wide nocase
        $tool2 = "EDR-Freeze" ascii wide nocase
        $tool3 = "Backstab" ascii wide nocase
        $tool4 = "EDRSandBlast" ascii wide nocase
        $tool5 = "FireBlock" ascii wide nocase
        $tool6 = "edr" ascii wide nocase

        // Evasion keywords
        $evade1 = "bypass" ascii wide nocase
        $evade2 = "disable" ascii wide nocase
        $evade3 = "blind" ascii wide nocase
        $evade4 = "silence" ascii wide nocase
        $evade5 = "block" ascii wide nocase
        $evade6 = "unhook" ascii wide nocase
        $evade7 = "evasion" ascii wide nocase

        // Security product terms
        $sec1 = "antivirus" ascii wide nocase
        $sec2 = "endpoint" ascii wide nocase
        $sec3 = "detection" ascii wide nocase
        $sec4 = "response" ascii wide nocase
        $sec5 = "security" ascii wide nocase

    condition:
        filesize < 10MB and
        (
            // Known tool name
            any of ($tool1, $tool2, $tool3, $tool4, $tool5) or
            // Combination of evasion + security terms
            (2 of ($evade*) and 2 of ($sec*))
        )
}


/*
    ============================================================
    Rule: WFP_Sublayer_Creation
    Confidence: Medium
    Description: Detects binaries that create custom WFP sublayers
    ============================================================
*/
rule WFP_Sublayer_Creation
{
    meta:
        description = "Detects binaries creating custom Windows Filtering Platform sublayers"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-12-07"
        test_id = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
        mitre_attack = "T1562.001"
        confidence = "medium"

    strings:
        // Sublayer manipulation APIs
        $api1 = "FwpmSubLayerAdd0" ascii wide
        $api2 = "FwpmSubLayerDeleteByKey0" ascii wide
        $api3 = "FwpmSubLayerGetByKey0" ascii wide
        $api4 = "FwpmSubLayerEnum0" ascii wide

        // Filter APIs (needed with sublayer)
        $filter1 = "FwpmFilterAdd0" ascii wide
        $filter2 = "FwpmEngineOpen0" ascii wide

        // Suspicious strings
        $sus1 = "blocking" ascii wide nocase
        $sus2 = "filter" ascii wide nocase
        $sus3 = "outbound" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (
            // Sublayer creation + filter addition
            (any of ($api*) and any of ($filter*)) or
            // Sublayer APIs + suspicious strings
            (2 of ($api*) and any of ($sus*))
        )
}


/*
    ============================================================
    Rule: Packed_EDRSilencer
    Confidence: High
    Description: Detects packed/obfuscated EDRSilencer variants
    ============================================================
*/
rule Packed_EDRSilencer
{
    meta:
        description = "Detects potentially packed or obfuscated EDRSilencer variants"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-12-07"
        test_id = "bcba14e7-6f87-4cbd-9c32-718fdeb39b65"
        mitre_attack = "T1562.001"
        confidence = "high"

    strings:
        // Encoded/obfuscated variants of key strings
        $enc1 = "RURSU2lsZW5jZXI" ascii wide  // Base64: EDRSilencer
        $enc2 = "YmxvY2tlZHI" ascii wide       // Base64: blockedr
        $enc3 = "dW5ibG9ja2FsbA" ascii wide    // Base64: unblockall

        // XOR encoded (common key patterns)
        $xor1 = {45 44 52 53 69 6C 65 6E 63 65 72}  // EDRSilencer plain
        $xor2 = {62 6C 6F 63 6B 65 64 72}           // blockedr plain

        // Rotated strings
        $rot1 = "ROEFvyrapr" ascii  // ROT13: EDRSilencer (partial)

        // Hash of EDRSilencer (if compiling with specific hash)
        $hash_pattern = { 45 44 52 [0-3] 53 69 6C }  // EDR?Sil pattern

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (
            any of ($enc*) or
            all of ($xor*) or
            any of ($rot*) or
            $hash_pattern
        )
}
