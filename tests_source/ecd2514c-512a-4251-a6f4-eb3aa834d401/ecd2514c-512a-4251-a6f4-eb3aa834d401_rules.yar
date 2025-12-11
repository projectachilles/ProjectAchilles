/*
    ============================================================
    F0RT1KA YARA Detection Rules
    Test ID: ecd2514c-512a-4251-a6f4-eb3aa834d401
    Test Name: CyberEye RAT - Windows Defender Disabling via PowerShell
    MITRE ATT&CK: T1562.001 - Impair Defenses: Disable or Modify Tools
    Generated: 2025-12-07
    ============================================================
*/


/*
    ============================================================
    Rule 1: CyberEye RAT Defender Disable Script
    Confidence: Critical
    Description: Detects the CyberEye RAT PowerShell script that disables Windows Defender
    ============================================================
*/

rule CyberEye_Defender_Disable_Script {
    meta:
        description = "Detects CyberEye RAT PowerShell script for disabling Windows Defender"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
        mitre_attack = "T1562.001"
        confidence = "critical"
        reference = "https://cybersecuritynews.com/cybereye-rat-disable-windows-defender-using-powershell/"

    strings:
        // Script identification
        $script_name1 = "CyberEye" ascii wide nocase
        $script_name2 = "CyberEYE RAT" ascii wide nocase
        $script_header = "Windows Defender registry manipulation" ascii wide nocase

        // Registry paths targeted
        $reg_path1 = "HKLM:\\SOFTWARE\\Microsoft\\Windows Defender\\Features" ascii wide nocase
        $reg_path2 = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender" ascii wide nocase
        $reg_path3 = "SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection" ascii wide nocase
        $reg_path4 = "Windows Defender\\Features" ascii wide nocase

        // Registry values targeted
        $reg_value1 = "TamperProtection" ascii wide nocase
        $reg_value2 = "DisableAntiSpyware" ascii wide nocase
        $reg_value3 = "DisableBehaviorMonitoring" ascii wide nocase
        $reg_value4 = "DisableOnAccessProtection" ascii wide nocase
        $reg_value5 = "DisableScanOnRealtimeEnable" ascii wide nocase
        $reg_value6 = "DisableRealtimeMonitoring" ascii wide nocase

        // PowerShell commands
        $ps_cmd1 = "Set-ItemProperty" ascii wide nocase
        $ps_cmd2 = "New-ItemProperty" ascii wide nocase
        $ps_cmd3 = "-ExecutionPolicy Bypass" ascii wide nocase
        $ps_cmd4 = "Get-MpPreference" ascii wide nocase

        // Success indicators
        $success1 = "Registry manipulations completed successfully" ascii wide nocase
        $success2 = "Set TamperProtection to 0" ascii wide nocase

    condition:
        filesize < 100KB and
        (
            // CyberEye specific script
            (any of ($script_name*) and 2 of ($reg_path*) and 2 of ($reg_value*)) or
            // Generic Defender disable script pattern
            (3 of ($reg_value*) and 2 of ($ps_cmd*) and any of ($reg_path*)) or
            // Success message patterns
            (any of ($success*) and 2 of ($reg_value*))
        )
}


/*
    ============================================================
    Rule 2: Generic Windows Defender Registry Manipulation Script
    Confidence: High
    Description: Detects generic PowerShell scripts that manipulate Windows Defender registry
    ============================================================
*/

rule Defender_Registry_Manipulation_Script {
    meta:
        description = "Detects PowerShell scripts that manipulate Windows Defender registry settings"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
        mitre_attack = "T1562.001"
        confidence = "high"

    strings:
        // PowerShell script indicators
        $ps_shebang = "#Requires -RunAsAdministrator" ascii wide nocase
        $ps_param = "[CmdletBinding()]" ascii wide nocase

        // Defender registry manipulation
        $defender_path1 = "Windows Defender" ascii wide nocase
        $defender_path2 = "HKLM:\\SOFTWARE\\Microsoft\\Windows Defender" ascii wide nocase
        $defender_path3 = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender" ascii wide nocase

        // Disable values being set
        $disable_tamper = { 54 61 6D 70 65 72 50 72 6F 74 65 63 74 69 6F 6E }  // "TamperProtection"
        $disable_spy = "DisableAntiSpyware" ascii wide nocase
        $disable_behavior = "DisableBehaviorMonitoring" ascii wide nocase
        $disable_access = "DisableOnAccessProtection" ascii wide nocase
        $disable_scan = "DisableScanOnRealtimeEnable" ascii wide nocase

        // PowerShell registry commands
        $set_item = "Set-ItemProperty" ascii wide nocase
        $new_item = "New-Item" ascii wide nocase
        $reg_type = "-Type DWord" ascii wide nocase

        // Setting value to disable (0 for tamper, 1 for others)
        $value_zero = "-Value 0" ascii wide nocase
        $value_one = "-Value 1" ascii wide nocase

    condition:
        filesize < 200KB and
        (
            // Script with Defender paths and disable commands
            (any of ($defender_path*) and ($set_item or $new_item) and ($value_zero or $value_one)) and
            // At least 2 disable value names present
            (2 of ($disable_*))
        )
}


/*
    ============================================================
    Rule 3: PowerShell Execution Policy Bypass Script
    Confidence: Medium
    Description: Detects scripts using execution policy bypass techniques
    ============================================================
*/

rule PowerShell_ExecutionPolicy_Bypass {
    meta:
        description = "Detects PowerShell scripts with execution policy bypass techniques"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
        mitre_attack = "T1562.001"
        confidence = "medium"

    strings:
        // Execution policy bypass patterns
        $bypass1 = "-ExecutionPolicy Bypass" ascii wide nocase
        $bypass2 = "-ep bypass" ascii wide nocase
        $bypass3 = "-exec bypass" ascii wide nocase
        $bypass4 = "Set-ExecutionPolicy Bypass" ascii wide nocase
        $bypass5 = "Set-ExecutionPolicy Unrestricted" ascii wide nocase

        // Self-relaunching bypass pattern
        $relaunch1 = "Invoke-Expression" ascii wide nocase
        $relaunch2 = "powershell.exe -ExecutionPolicy Bypass -File" ascii wide nocase
        $relaunch3 = "$MyInvocation.MyCommand.Path" ascii wide nocase

        // Security-related targets
        $target1 = "Windows Defender" ascii wide nocase
        $target2 = "TamperProtection" ascii wide nocase
        $target3 = "DisableAntiSpyware" ascii wide nocase
        $target4 = "Real-Time Protection" ascii wide nocase

        // Admin check patterns
        $admin1 = "WindowsBuiltInRole]::Administrator" ascii wide nocase
        $admin2 = "RunAsAdministrator" ascii wide nocase
        $admin3 = "Test-Admin" ascii wide nocase

    condition:
        filesize < 100KB and
        (
            // Bypass with security target
            (any of ($bypass*) and any of ($target*)) or
            // Self-relaunching bypass pattern
            (any of ($relaunch*) and any of ($bypass*)) or
            // Admin-required script with bypass
            (any of ($admin*) and any of ($bypass*) and any of ($target*))
        )
}


/*
    ============================================================
    Rule 4: F0RT1KA Test Script Indicator
    Confidence: High
    Description: Detects scripts in F0RT1KA test directory structure
    ============================================================
*/

rule F0RT1KA_Test_Script_Indicator {
    meta:
        description = "Detects scripts associated with F0RT1KA security testing framework"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
        mitre_attack = "T1562.001"
        confidence = "high"

    strings:
        // F0RT1KA framework indicators
        $f0_comment1 = "F0RT1KA" ascii wide nocase
        $f0_comment2 = "security test" ascii wide nocase
        $f0_comment3 = "controlled testing" ascii wide nocase
        $f0_comment4 = "isolated test environment" ascii wide nocase

        // F0 directory references
        $f0_path1 = "c:\\F0\\" ascii wide nocase
        $f0_path2 = "C:\\F0\\" ascii wide nocase
        $f0_path3 = "$env:SystemDrive\\F0" ascii wide nocase

        // Test-related comments
        $test_comment1 = "test environment" ascii wide nocase
        $test_comment2 = "security controls" ascii wide nocase
        $test_comment3 = ".SYNOPSIS" ascii wide nocase
        $test_comment4 = ".WARNING" ascii wide nocase

        // Defender manipulation (must be present for this rule)
        $defender1 = "Windows Defender" ascii wide nocase
        $defender2 = "TamperProtection" ascii wide nocase
        $defender3 = "DisableAntiSpyware" ascii wide nocase

    condition:
        filesize < 200KB and
        (
            // F0RT1KA framework script with Defender manipulation
            (any of ($f0_comment*) and any of ($defender*)) or
            // F0 directory script
            (any of ($f0_path*) and any of ($defender*)) or
            // Test script with security focus
            (2 of ($test_comment*) and 2 of ($defender*))
        )
}


/*
    ============================================================
    Rule 5: Windows Defender Service Manipulation Commands
    Confidence: High
    Description: Detects commands targeting WinDefend service
    ============================================================
*/

rule Defender_Service_Manipulation {
    meta:
        description = "Detects commands that manipulate or query Windows Defender service"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
        mitre_attack = "T1562.001"
        confidence = "high"

    strings:
        // Service manipulation commands
        $sc_query = "sc query WinDefend" ascii wide nocase
        $sc_stop = "sc stop WinDefend" ascii wide nocase
        $sc_config = "sc config WinDefend" ascii wide nocase
        $sc_delete = "sc delete WinDefend" ascii wide nocase

        // PowerShell service commands
        $ps_stop = "Stop-Service -Name WinDefend" ascii wide nocase
        $ps_stop2 = "Stop-Service WinDefend" ascii wide nocase
        $ps_start = "Start-Service -Name WinDefend" ascii wide nocase
        $ps_disable = "Set-Service -Name WinDefend -StartupType Disabled" ascii wide nocase

        // Net commands
        $net_stop = "net stop WinDefend" ascii wide nocase
        $net_start = "net start WinDefend" ascii wide nocase

        // MsMpEng process targeting
        $msmpeng1 = "MsMpEng" ascii wide nocase
        $msmpeng2 = "taskkill /f /im MsMpEng" ascii wide nocase

    condition:
        filesize < 500KB and
        (
            // Any service manipulation command
            any of ($sc_*) or
            any of ($ps_*) or
            any of ($net_*) or
            any of ($msmpeng*)
        )
}


/*
    ============================================================
    Rule 6: Encoded PowerShell with Defender Keywords
    Confidence: Medium
    Description: Detects Base64 encoded PowerShell with Defender-related content
    ============================================================
*/

rule Encoded_PowerShell_Defender_Keywords {
    meta:
        description = "Detects encoded PowerShell that may contain Defender manipulation"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
        mitre_attack = "T1562.001"
        confidence = "medium"

    strings:
        // PowerShell encoded command indicators
        $ps_enc1 = "-EncodedCommand" ascii wide nocase
        $ps_enc2 = "-enc " ascii wide nocase
        $ps_enc3 = "-e " ascii wide nocase
        $ps_enc4 = "FromBase64String" ascii wide nocase

        // Base64 encoded Defender-related strings
        // "Windows Defender" in Base64
        $b64_defender1 = "V2luZG93cyBEZWZlbmRlcg" ascii wide
        // "TamperProtection" in Base64
        $b64_tamper = "VGFtcGVyUHJvdGVjdGlvbg" ascii wide
        // "DisableAntiSpyware" in Base64
        $b64_disable = "RGlzYWJsZUFudGlTcHl3YXJl" ascii wide
        // "Set-ItemProperty" in Base64
        $b64_setitem = "U2V0LUl0ZW1Qcm9wZXJ0eQ" ascii wide

        // Suspicious patterns in scripts
        $iex = "IEX" ascii wide
        $invoke = "Invoke-Expression" ascii wide nocase
        $downloadstring = "DownloadString" ascii wide nocase

    condition:
        filesize < 1MB and
        (
            // Encoded command with Defender Base64 content
            (any of ($ps_enc*) and any of ($b64_*)) or
            // IEX with Base64 Defender content
            ($iex and any of ($b64_*)) or
            // Download and execute with Defender targeting
            ($downloadstring and any of ($b64_*))
        )
}


/*
    ============================================================
    Rule 7: Cleanup Script for Defender Settings
    Confidence: Low
    Description: Detects cleanup/restoration scripts for Defender settings
    ============================================================
*/

rule Defender_Cleanup_Script {
    meta:
        description = "Detects scripts that restore/cleanup Windows Defender settings"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
        mitre_attack = "T1562.001"
        confidence = "low"
        note = "May indicate post-attack cleanup or legitimate restoration"

    strings:
        // Cleanup indicators
        $cleanup1 = "cleanup" ascii wide nocase
        $cleanup2 = "restore" ascii wide nocase
        $cleanup3 = "revert" ascii wide nocase
        $cleanup4 = "re-enable" ascii wide nocase

        // Removal commands
        $remove1 = "Remove-ItemProperty" ascii wide nocase
        $remove2 = "Remove-Item" ascii wide nocase

        // Defender-related paths
        $defender_path = "Windows Defender" ascii wide nocase
        $defender_reg = "HKLM:\\SOFTWARE" ascii wide nocase

        // Service restart
        $restart1 = "Restart-Service -Name WinDefend" ascii wide nocase
        $restart2 = "Start-Service -Name WinDefend" ascii wide nocase

        // Registry values being removed
        $value_remove1 = "DisableAntiSpyware" ascii wide nocase
        $value_remove2 = "DisableBehaviorMonitoring" ascii wide nocase
        $value_remove3 = "TamperProtection" ascii wide nocase

    condition:
        filesize < 100KB and
        (
            // Cleanup script with Defender focus
            (any of ($cleanup*) and $defender_path and any of ($remove*)) or
            // Restoration script with service restart
            (any of ($restart*) and any of ($value_remove*)) or
            // Removal of disable settings
            (any of ($remove*) and 2 of ($value_remove*))
        )
}


/*
    ============================================================
    Rule 8: Embedded Go Binary with Defender Script
    Confidence: High
    Description: Detects Go binaries embedding Defender manipulation scripts
    ============================================================
*/

rule Go_Binary_Embedded_Defender_Script {
    meta:
        description = "Detects Go binaries with embedded Defender manipulation scripts"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "ecd2514c-512a-4251-a6f4-eb3aa834d401"
        mitre_attack = "T1562.001"
        confidence = "high"

    strings:
        // Go binary indicators
        $go_build = "Go build" ascii
        $go_runtime = "runtime.main" ascii
        $go_embed = "go:embed" ascii

        // Embedded script content
        $script_ps1 = ".ps1" ascii wide
        $script_defender = "Windows Defender" ascii wide
        $script_tamper = "TamperProtection" ascii wide
        $script_disable = "DisableAntiSpyware" ascii wide

        // PE header
        $mz = { 4D 5A }

        // CyberEye specific
        $cybereye = "CyberEye" ascii wide nocase

    condition:
        $mz at 0 and
        filesize < 20MB and
        (
            // Go binary with embedded Defender script
            (any of ($go_*) and $script_defender and ($script_tamper or $script_disable)) or
            // Go binary with CyberEye script
            (any of ($go_*) and $cybereye) or
            // PE with embedded script targeting Defender
            ($script_ps1 and $script_defender and 2 of ($script_*))
        )
}
