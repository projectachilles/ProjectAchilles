/*
============================================================================
DEFENSE GUIDANCE: YARA Detection Rules
============================================================================
Test ID: e5577355-f8e4-4e52-b1b2-f7d1c8b864f1
Test Name: SilentButDeadly WFP EDR Network Isolation
MITRE ATT&CK: T1562.001 - Impair Defenses: Disable or Modify Tools
Created: 2025-12-06
Author: F0RT1KA Defense Guidance Builder
============================================================================

TECHNIQUE-FOCUSED DETECTION PRINCIPLE:
These YARA rules detect the underlying WFP-based EDR isolation technique,
NOT the F0RT1KA testing framework specifically. They will catch real-world
attackers using similar WFP manipulation tools with their own custom binaries.

============================================================================
*/


// ============================================================================
// RULE 1: Generic WFP EDR Isolation Tool Detection
// Detects PE binaries that import WFP APIs and contain EDR process strings
// ============================================================================

rule WFP_EDR_Isolation_Tool_Generic
{
    meta:
        description = "Detects tools that use WFP to block EDR network communications"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-06"
        test_id = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
        mitre_attack = "T1562.001"
        confidence = "high"
        severity = "critical"
        reference = "https://attack.mitre.org/techniques/T1562/001/"

    strings:
        // WFP API function imports
        $wfp_api1 = "FwpmEngineOpen" ascii wide nocase
        $wfp_api2 = "FwpmFilterAdd" ascii wide nocase
        $wfp_api3 = "FwpmProviderAdd" ascii wide nocase
        $wfp_api4 = "FwpmSubLayerAdd" ascii wide nocase
        $wfp_api5 = "FwpmEngineClose" ascii wide nocase
        $wfp_api6 = "FwpmFilterDeleteByKey" ascii wide nocase
        $wfp_api7 = "FWPM_LAYER_ALE_AUTH_CONNECT" ascii wide
        $wfp_api8 = "FWPM_LAYER_ALE_AUTH_RECV_ACCEPT" ascii wide
        $wfp_api9 = "FWPM_CONDITION_ALE_APP_ID" ascii wide

        // EDR/AV process targeting strings - SentinelOne
        $edr1 = "SentinelAgent" ascii wide nocase
        $edr2 = "SentinelServiceHost" ascii wide nocase
        $edr3 = "SentinelStaticEngine" ascii wide nocase

        // EDR/AV process targeting strings - CrowdStrike
        $edr4 = "CSFalconService" ascii wide nocase
        $edr5 = "CSFalconContainer" ascii wide nocase
        $edr6 = "falcon-sensor" ascii wide nocase

        // EDR/AV process targeting strings - Windows Defender
        $edr7 = "MsMpEng" ascii wide nocase
        $edr8 = "MpCmdRun" ascii wide nocase
        $edr9 = "MsSense" ascii wide nocase

        // EDR/AV process targeting strings - Carbon Black
        $edr10 = "RepMgr" ascii wide nocase
        $edr11 = "RepWAC" ascii wide nocase
        $edr12 = "RepUtils" ascii wide nocase

        // EDR/AV process targeting strings - Cylance
        $edr13 = "CylanceSvc" ascii wide nocase
        $edr14 = "CylanceUI" ascii wide nocase

        // EDR/AV process targeting strings - Symantec
        $edr15 = "ccSvcHst" ascii wide nocase
        $edr16 = "Rtvscan" ascii wide nocase

        // EDR/AV process targeting strings - McAfee
        $edr17 = "McShield" ascii wide nocase
        $edr18 = "McAfeeFramework" ascii wide nocase

        // EDR/AV process targeting strings - Trend Micro
        $edr19 = "PccNTMon" ascii wide nocase
        $edr20 = "TMBMSRV" ascii wide nocase

        // EDR/AV process targeting strings - Sophos
        $edr21 = "SavService" ascii wide nocase
        $edr22 = "SAVAdminService" ascii wide nocase

        // EDR/AV process targeting strings - Kaspersky
        $edr23 = "avp.exe" ascii wide nocase
        $edr24 = "kavtray" ascii wide nocase

        // EDR/AV process targeting strings - ESET
        $edr25 = "ekrn.exe" ascii wide nocase
        $edr26 = "egui.exe" ascii wide nocase

        // EDR/AV process targeting strings - Palo Alto Cortex
        $edr27 = "CortexXDR" ascii wide nocase
        $edr28 = "cyserver" ascii wide nocase

        // EDR/AV process targeting strings - FireEye/Trellix
        $edr29 = "xagt.exe" ascii wide nocase
        $edr30 = "FireEyeAgent" ascii wide nocase

        // EDR/AV process targeting strings - Elastic
        $edr31 = "elastic-endpoint" ascii wide nocase
        $edr32 = "elastic-agent" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            // Requires WFP APIs AND EDR targeting strings
            (2 of ($wfp_api*)) and (3 of ($edr*))
        )
}


// ============================================================================
// RULE 2: SilentButDeadly Specific Detection
// Detects the SilentButDeadly tool specifically
// ============================================================================

rule SilentButDeadly_Tool
{
    meta:
        description = "Detects the SilentButDeadly WFP EDR isolation tool"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-06"
        test_id = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
        mitre_attack = "T1562.001"
        confidence = "high"
        severity = "critical"
        reference = "https://github.com/loosehose/SilentButDeadly"

    strings:
        // Tool-specific strings
        $tool1 = "SilentButDeadly" ascii wide nocase
        $tool2 = "silent-but-deadly" ascii wide nocase
        $tool3 = "loosehose" ascii wide nocase
        $tool4 = "EDR Silencer" ascii wide nocase

        // Behavioral strings
        $msg1 = "Blocking EDR" ascii wide nocase
        $msg2 = "Filter added" ascii wide nocase
        $msg3 = "Isolating" ascii wide nocase
        $msg4 = "Network blocked" ascii wide nocase
        $msg5 = "Cleanup complete" ascii wide nocase

        // WFP-specific implementation markers
        $impl1 = "Creating WFP session" ascii wide
        $impl2 = "Adding provider" ascii wide
        $impl3 = "Adding sublayer" ascii wide
        $impl4 = "Filter weight" ascii wide

        // Common WFP GUIDs used by the tool (hex patterns)
        $guid1 = { 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 }  // Empty GUID placeholder

    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        (
            any of ($tool*) or
            (2 of ($msg*) and 2 of ($impl*))
        )
}


// ============================================================================
// RULE 3: EDRSilencer Tool Detection
// Detects the EDRSilencer and similar tools
// ============================================================================

rule EDRSilencer_Tool
{
    meta:
        description = "Detects EDRSilencer and similar WFP-based EDR blocking tools"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-06"
        test_id = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
        mitre_attack = "T1562.001"
        confidence = "high"
        severity = "critical"

    strings:
        // EDRSilencer strings
        $es1 = "EDRSilencer" ascii wide nocase
        $es2 = "edr-silencer" ascii wide nocase
        $es3 = "edrsilencer" ascii wide nocase

        // Common variant names
        $var1 = "EDRBlocker" ascii wide nocase
        $var2 = "EDRKiller" ascii wide nocase
        $var3 = "AVBlocker" ascii wide nocase
        $var4 = "FirewallBypass" ascii wide nocase
        $var5 = "NetworkBlind" ascii wide nocase
        $var6 = "BlindSide" ascii wide nocase

        // Implementation-specific patterns
        $impl1 = "block outbound" ascii wide nocase
        $impl2 = "blocking traffic" ascii wide nocase
        $impl3 = "WFP filter" ascii wide nocase
        $impl4 = "network isolation" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        (
            any of ($es*) or
            any of ($var*) or
            (3 of ($impl*))
        )
}


// ============================================================================
// RULE 4: WFP Import Table Analysis
// Detects binaries with suspicious WFP DLL imports
// ============================================================================

rule WFP_Suspicious_Imports
{
    meta:
        description = "Detects binaries importing WFP functions from fwpuclnt.dll"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-06"
        test_id = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
        mitre_attack = "T1562.001"
        confidence = "medium"
        severity = "high"

    strings:
        // DLL imports
        $dll1 = "fwpuclnt.dll" ascii wide nocase
        $dll2 = "FWPUCLNT.DLL" ascii

        // Key function exports from fwpuclnt.dll
        $func1 = "FwpmEngineOpen0" ascii
        $func2 = "FwpmFilterAdd0" ascii
        $func3 = "FwpmProviderAdd0" ascii
        $func4 = "FwpmSubLayerAdd0" ascii
        $func5 = "FwpmTransactionBegin0" ascii
        $func6 = "FwpmTransactionCommit0" ascii
        $func7 = "FwpmFilterDeleteById0" ascii
        $func8 = "FwpmFilterDeleteByKey0" ascii

        // Process enumeration functions (often used together)
        $enum1 = "CreateToolhelp32Snapshot" ascii
        $enum2 = "Process32First" ascii
        $enum3 = "Process32Next" ascii
        $enum4 = "Module32First" ascii
        $enum5 = "Module32Next" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Must import fwpuclnt.dll with multiple filter functions
            any of ($dll*) and
            3 of ($func*) and
            // Also doing process enumeration
            2 of ($enum*)
        )
}


// ============================================================================
// RULE 5: Go-compiled WFP Tool Detection
// Detects Go binaries with WFP functionality (common for these tools)
// ============================================================================

rule Go_WFP_Tool
{
    meta:
        description = "Detects Go-compiled binaries with WFP manipulation capabilities"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-06"
        test_id = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
        mitre_attack = "T1562.001"
        confidence = "medium"
        severity = "high"

    strings:
        // Go runtime markers
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii

        // Go WFP library paths
        $golib1 = "golang.org/x/sys/windows" ascii
        $golib2 = "syscall.NewLazyDLL" ascii
        $golib3 = "syscall.Syscall" ascii

        // WFP-related Go code patterns
        $wfp1 = "fwpuclnt" ascii wide nocase
        $wfp2 = "FwpmEngineOpen" ascii wide
        $wfp3 = "FwpmFilterAdd" ascii wide

        // EDR strings in Go binaries
        $edr1 = "SentinelAgent" ascii wide
        $edr2 = "CSFalcon" ascii wide
        $edr3 = "MsMpEng" ascii wide
        $edr4 = "CrowdStrike" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Go binary with WFP imports and EDR targeting
            2 of ($go*) and
            2 of ($wfp*) and
            2 of ($edr*)
        )
}


// ============================================================================
// RULE 6: PowerShell WFP Manipulation Script
// Detects PowerShell scripts using WFP for EDR blocking
// ============================================================================

rule PowerShell_WFP_EDR_Block
{
    meta:
        description = "Detects PowerShell scripts that manipulate WFP to block EDR"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-06"
        test_id = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
        mitre_attack = "T1562.001"
        confidence = "medium"
        severity = "high"
        filetype = "script"

    strings:
        // PowerShell firewall cmdlets
        $ps1 = "New-NetFirewallRule" ascii wide nocase
        $ps2 = "Set-NetFirewallRule" ascii wide nocase
        $ps3 = "Add-NetFirewallRule" ascii wide nocase
        $ps4 = "netsh advfirewall" ascii wide nocase

        // Blocking actions
        $block1 = "-Action Block" ascii wide nocase
        $block2 = "action=block" ascii wide nocase
        $block3 = "-Direction Outbound" ascii wide nocase
        $block4 = "dir=out" ascii wide nocase

        // EDR targeting
        $edr1 = "SentinelAgent" ascii wide nocase
        $edr2 = "CSFalcon" ascii wide nocase
        $edr3 = "MsMpEng" ascii wide nocase
        $edr4 = "elastic-endpoint" ascii wide nocase
        $edr5 = "CortexXDR" ascii wide nocase
        $edr6 = "CylanceSvc" ascii wide nocase

        // WFP COM objects (advanced scripts)
        $com1 = "HNetCfg.FwPolicy2" ascii wide nocase
        $com2 = "INetFwRule" ascii wide nocase

    condition:
        filesize < 1MB and
        (
            // PowerShell creating blocking firewall rules for EDR
            (any of ($ps*) and any of ($block*) and any of ($edr*)) or
            // COM-based firewall manipulation targeting EDR
            (any of ($com*) and any of ($edr*))
        )
}


// ============================================================================
// RULE 7: Memory Pattern - Active WFP Session
// Detects memory patterns indicative of active WFP filtering session
// ============================================================================

rule WFP_Active_Session_Memory
{
    meta:
        description = "Detects memory patterns of active WFP filtering session targeting EDR"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-06"
        test_id = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
        mitre_attack = "T1562.001"
        confidence = "medium"
        severity = "high"
        filetype = "memory"

    strings:
        // WFP layer GUIDs (common for filtering)
        // FWPM_LAYER_ALE_AUTH_CONNECT_V4
        $layer1 = { C3 85 E7 C3 6F 7E 40 D8 95 C8 A4 F0 97 87 E5 41 }
        // FWPM_LAYER_ALE_AUTH_CONNECT_V6
        $layer2 = { 4A 68 97 4D 73 A4 49 3B 8B 56 42 0B 91 61 29 CD }
        // FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4
        $layer3 = { 4F 3F 27 E0 D8 E0 4C 52 B6 DC 77 B8 AB 18 12 A5 }

        // Runtime strings indicating active blocking
        $active1 = "Blocking established" ascii wide
        $active2 = "Filter active" ascii wide
        $active3 = "EDR isolated" ascii wide
        $active4 = "Network blocked" ascii wide

        // Process names being targeted (runtime artifacts)
        $proc1 = "SentinelAgent.exe" ascii wide
        $proc2 = "CSFalconService.exe" ascii wide
        $proc3 = "MsMpEng.exe" ascii wide

    condition:
        (
            // WFP layer GUIDs with blocking indicators and EDR targeting
            any of ($layer*) and
            any of ($active*) and
            any of ($proc*)
        )
}


// ============================================================================
// RULE 8: Batch Script WFP/Firewall EDR Blocking
// Detects batch scripts manipulating firewall to block EDR
// ============================================================================

rule Batch_Firewall_EDR_Block
{
    meta:
        description = "Detects batch scripts blocking EDR via firewall rules"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-06"
        test_id = "e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
        mitre_attack = "T1562.001"
        confidence = "medium"
        severity = "high"
        filetype = "script"

    strings:
        // Netsh firewall commands
        $cmd1 = "netsh advfirewall firewall add rule" ascii nocase
        $cmd2 = "netsh advfirewall set" ascii nocase
        $cmd3 = "netsh firewall add" ascii nocase

        // Blocking configuration
        $block1 = "action=block" ascii nocase
        $block2 = "dir=out" ascii nocase
        $block3 = "enable=yes" ascii nocase

        // EDR process targeting
        $edr1 = "SentinelAgent" ascii nocase
        $edr2 = "CSFalcon" ascii nocase
        $edr3 = "MsMpEng" ascii nocase
        $edr4 = "Defender" ascii nocase
        $edr5 = "CrowdStrike" ascii nocase
        $edr6 = "Carbon Black" ascii nocase

    condition:
        filesize < 100KB and
        (
            any of ($cmd*) and
            any of ($block*) and
            any of ($edr*)
        )
}
