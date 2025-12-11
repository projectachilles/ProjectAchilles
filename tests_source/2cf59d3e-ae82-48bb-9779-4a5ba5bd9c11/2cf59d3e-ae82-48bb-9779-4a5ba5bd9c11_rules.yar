/*
    ============================================================================
    YARA Detection Rules
    ============================================================================
    Test ID: 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11
    Test Name: SafePay UAC Bypass & Defense Evasion
    MITRE ATT&CK: T1548.002, T1562.001, T1547.001
    Created: 2025-12-07
    Author: F0RT1KA Defense Guidance Builder
    ============================================================================

    These rules detect SafePay-style UAC bypass techniques, registry persistence
    patterns, and Windows Defender tampering attempts in scripts and binaries.

    Usage:
        yara -r 2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11_rules.yar /path/to/scan

    ============================================================================
*/


// ============================================================================
// Rule 1: CMSTPLUA UAC Bypass Script Detection
// Purpose: Detect PowerShell scripts using CMSTPLUA COM object for UAC bypass
// Confidence: HIGH
// ============================================================================

rule SafePay_CMSTPLUA_UAC_Bypass_Script {
    meta:
        description = "Detects PowerShell script using CMSTPLUA COM object for UAC bypass"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1548.002"
        confidence = "high"
        reference = "https://attack.mitre.org/techniques/T1548/002/"

    strings:
        // CMSTPLUA COM GUID
        $guid1 = "3E5FC7F9-9A51-4367-9063-A120244FBEC7" ascii wide nocase
        $guid2 = "{3E5FC7F9-9A51-4367-9063-A120244FBEC7}" ascii wide nocase

        // CMSTPLUA indicators
        $cmstplua1 = "CMSTPLUA" ascii wide nocase
        $cmstplua2 = "cmstplua" ascii wide

        // COM object creation patterns
        $com1 = "GetTypeFromCLSID" ascii wide nocase
        $com2 = "CreateInstance" ascii wide nocase
        $com3 = "[System.Activator]::CreateInstance" ascii wide nocase
        $com4 = "Activator.CreateInstance" ascii wide nocase

        // UAC bypass context
        $context1 = "UAC" ascii wide nocase
        $context2 = "bypass" ascii wide nocase
        $context3 = "elevate" ascii wide nocase

    condition:
        (any of ($guid*) or any of ($cmstplua*)) and
        any of ($com*)
}


// ============================================================================
// Rule 2: SafePay Registry Persistence Pattern
// Purpose: Detect scripts creating SafePay-style registry persistence
// Confidence: HIGH
// ============================================================================

rule SafePay_Registry_Persistence_Script {
    meta:
        description = "Detects SafePay-specific registry persistence pattern"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1547.001"
        confidence = "high"

    strings:
        // SafePay-specific IoCs
        $ioc1 = "SafePayService" ascii wide nocase
        $ioc2 = "6F22-C16F-0C71-688A" ascii wide nocase
        $ioc3 = "SafePay" ascii wide nocase

        // Registry Run key patterns
        $regpath1 = "CurrentVersion\\Run" ascii wide nocase
        $regpath2 = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" ascii wide nocase
        $regpath3 = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" ascii wide nocase

        // Registry modification commands
        $regcmd1 = "Set-ItemProperty" ascii wide nocase
        $regcmd2 = "New-ItemProperty" ascii wide nocase
        $regcmd3 = "reg add" ascii wide nocase
        $regcmd4 = "RegSetValueEx" ascii wide

    condition:
        any of ($ioc*) and
        any of ($regpath*) and
        any of ($regcmd*)
}


// ============================================================================
// Rule 3: Generic Registry Run Key Persistence via PowerShell
// Purpose: Detect any PowerShell script creating Run key persistence
// Confidence: MEDIUM
// ============================================================================

rule Generic_Registry_RunKey_Persistence_PowerShell {
    meta:
        description = "Detects PowerShell script creating registry Run key persistence"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1547.001"
        confidence = "medium"

    strings:
        // Registry Run key paths
        $regpath1 = "CurrentVersion\\Run" ascii wide nocase
        $regpath2 = "CurrentVersion\\RunOnce" ascii wide nocase

        // PowerShell registry commands
        $pscmd1 = "Set-ItemProperty" ascii wide nocase
        $pscmd2 = "New-ItemProperty" ascii wide nocase
        $pscmd3 = "Set-Item" ascii wide nocase

        // Persistence indicators
        $persist1 = "-Name" ascii wide nocase
        $persist2 = "-Value" ascii wide nocase

        // PowerShell script indicators
        $ps1 = "powershell" ascii wide nocase
        $ps2 = ".ps1" ascii wide nocase
        $ps3 = "Write-Host" ascii wide nocase

    condition:
        any of ($regpath*) and
        any of ($pscmd*) and
        any of ($persist*) and
        (any of ($ps*) or filesize < 100KB)
}


// ============================================================================
// Rule 4: Windows Defender Tampering Script
// Purpose: Detect scripts attempting to disable Windows Defender
// Confidence: HIGH
// ============================================================================

rule SafePay_Defender_Tampering_Script {
    meta:
        description = "Detects script attempting to disable Windows Defender"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1562.001"
        confidence = "high"

    strings:
        // Windows Defender cmdlet tampering
        $mpcmd1 = "Set-MpPreference" ascii wide nocase
        $mpcmd2 = "Add-MpPreference" ascii wide nocase
        $mpcmd3 = "Get-MpPreference" ascii wide nocase

        // Disable options
        $disable1 = "DisableRealtimeMonitoring" ascii wide nocase
        $disable2 = "DisableBehaviorMonitoring" ascii wide nocase
        $disable3 = "DisableIOAVProtection" ascii wide nocase
        $disable4 = "DisableBlockAtFirstSeen" ascii wide nocase
        $disable5 = "DisableIntrusionPreventionSystem" ascii wide nocase

        // Value indicators
        $value1 = "$true" ascii wide nocase
        $value2 = "True" ascii wide
        $value3 = "1" ascii wide

        // Service tampering
        $svc1 = "Stop-Service" ascii wide nocase
        $svc2 = "Set-Service" ascii wide nocase
        $svc3 = "WinDefend" ascii wide nocase
        $svc4 = "Defender" ascii wide nocase

    condition:
        (any of ($mpcmd*) and any of ($disable*)) or
        (any of ($svc*) and $svc3)
}


// ============================================================================
// Rule 5: GUI Automation P/Invoke Pattern
// Purpose: Detect scripts using P/Invoke for GUI automation
// Confidence: MEDIUM
// ============================================================================

rule SafePay_GUI_Automation_PInvoke {
    meta:
        description = "Detects script using P/Invoke for GUI automation (potential security tool tampering)"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1562.001"
        confidence = "medium"

    strings:
        // Add-Type with P/Invoke
        $addtype = "Add-Type" ascii wide nocase

        // DllImport pattern
        $dllimport = "DllImport" ascii wide nocase
        $pinvoke = "DllImportAttribute" ascii wide nocase

        // user32.dll functions for GUI automation
        $user32 = "user32.dll" ascii wide nocase
        $func1 = "FindWindow" ascii wide nocase
        $func2 = "ShowWindow" ascii wide nocase
        $func3 = "SendMessage" ascii wide nocase
        $func4 = "PostMessage" ascii wide nocase
        $func5 = "GetForegroundWindow" ascii wide nocase
        $func6 = "SetForegroundWindow" ascii wide nocase
        $func7 = "EnumWindows" ascii wide nocase

        // Security tool targets
        $target1 = "Windows Security" ascii wide nocase
        $target2 = "SecurityHealth" ascii wide nocase
        $target3 = "Windows Defender" ascii wide nocase
        $target4 = "Virus & threat" ascii wide nocase

    condition:
        $addtype and
        ($dllimport or $pinvoke) and
        $user32 and
        any of ($func*) and
        any of ($target*)
}


// ============================================================================
// Rule 6: PowerShell Execution Policy Bypass with Suspicious Script Path
// Purpose: Detect PowerShell bypass execution from suspicious locations
// Confidence: MEDIUM
// ============================================================================

rule SafePay_PowerShell_Bypass_Suspicious_Path {
    meta:
        description = "Detects PowerShell execution policy bypass for script in suspicious location"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1059.001"
        confidence = "medium"

    strings:
        // Execution policy bypass
        $bypass1 = "-ExecutionPolicy Bypass" ascii wide nocase
        $bypass2 = "-ep bypass" ascii wide nocase
        $bypass3 = "-exec bypass" ascii wide nocase
        $bypass4 = "Set-ExecutionPolicy" ascii wide nocase

        // Script execution
        $script1 = "-File" ascii wide nocase
        $script2 = ".ps1" ascii wide nocase

        // Suspicious paths
        $path1 = "c:\\F0\\" ascii wide nocase
        $path2 = "C:\\F0\\" ascii wide nocase
        $path3 = "\\Temp\\" ascii wide nocase
        $path4 = "\\AppData\\Local\\Temp\\" ascii wide nocase
        $path5 = "\\Public\\" ascii wide nocase

    condition:
        any of ($bypass*) and
        any of ($script*) and
        any of ($path*)
}


// ============================================================================
// Rule 7: Combined SafePay Attack Pattern
// Purpose: High-confidence detection of full SafePay attack chain
// Confidence: HIGH
// ============================================================================

rule SafePay_Full_Attack_Chain {
    meta:
        description = "Detects SafePay full attack chain (UAC bypass + persistence + defense evasion)"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1548.002, T1547.001, T1562.001"
        confidence = "high"

    strings:
        // SafePay indicators
        $safepay = "SafePay" ascii wide nocase

        // UAC bypass indicators
        $uac1 = "CMSTPLUA" ascii wide nocase
        $uac2 = "3E5FC7F9-9A51-4367-9063-A120244FBEC7" ascii wide nocase
        $uac3 = "UAC bypass" ascii wide nocase
        $uac4 = "GetTypeFromCLSID" ascii wide nocase

        // Persistence indicators
        $persist1 = "CurrentVersion\\Run" ascii wide nocase
        $persist2 = "SafePayService" ascii wide nocase
        $persist3 = "6F22-C16F-0C71-688A" ascii wide nocase

        // Defense evasion indicators
        $evasion1 = "Set-MpPreference" ascii wide nocase
        $evasion2 = "DisableRealtimeMonitoring" ascii wide nocase
        $evasion3 = "Windows Defender" ascii wide nocase
        $evasion4 = "FindWindow" ascii wide nocase

    condition:
        // Must have SafePay indicator AND at least 2 of 3 attack phases
        $safepay and
        (
            (any of ($uac*) and any of ($persist*)) or
            (any of ($uac*) and any of ($evasion*)) or
            (any of ($persist*) and any of ($evasion*))
        )
}


// ============================================================================
// Rule 8: F0RT1KA Test Script Generic Pattern
// Purpose: Detect F0RT1KA security test scripts
// Confidence: HIGH
// ============================================================================

rule F0RT1KA_Test_Script_SafePay {
    meta:
        description = "Detects F0RT1KA SafePay UAC bypass test script"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        confidence = "high"
        note = "This is a test detection - verify authorized testing"

    strings:
        // F0RT1KA test markers
        $marker1 = "[SafePay]" ascii wide
        $marker2 = "SafePay UAC bypass simulation" ascii wide nocase
        $marker3 = "safepay_uac_bypass.ps1" ascii wide nocase

        // Test-specific strings
        $test1 = "UAC bypass simulation" ascii wide nocase
        $test2 = "registry persistence created" ascii wide nocase
        $test3 = "GUI automation attempt" ascii wide nocase

        // Path indicators
        $path1 = "c:\\F0\\" ascii wide nocase
        $path2 = "C:\\F0\\" ascii wide nocase

    condition:
        (any of ($marker*) or any of ($test*)) and
        any of ($path*)
}


// ============================================================================
// Rule 9: COM Object Instantiation via Activator
// Purpose: Detect .NET Activator use for COM object creation (common in UAC bypass)
// Confidence: MEDIUM
// ============================================================================

rule COM_Activator_UAC_Bypass_Pattern {
    meta:
        description = "Detects .NET Activator pattern for COM object instantiation"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1548.002"
        confidence = "medium"

    strings:
        // .NET Activator patterns
        $activator1 = "[System.Activator]::CreateInstance" ascii wide nocase
        $activator2 = "Activator.CreateInstance" ascii wide nocase
        $activator3 = "System.Activator" ascii wide nocase

        // Type resolution patterns
        $type1 = "[type]::GetTypeFromCLSID" ascii wide nocase
        $type2 = "GetTypeFromCLSID" ascii wide nocase
        $type3 = "Type.GetTypeFromProgID" ascii wide nocase

        // Known UAC bypass COM GUIDs (besides CMSTPLUA)
        $guid1 = "3E5FC7F9-9A51-4367-9063-A120244FBEC7" ascii wide nocase  // CMSTPLUA
        $guid2 = "1f486a52-3cb1-48fd-8f50-b8dc300d9f9d" ascii wide nocase  // CMLUA
        $guid3 = "9BA05972-F6A8-11CF-A442-00A0C90A8F39" ascii wide nocase  // ShellWindows

        // Elevation keywords
        $elevate1 = "elevate" ascii wide nocase
        $elevate2 = "elevated" ascii wide nocase
        $elevate3 = "administrator" ascii wide nocase

    condition:
        (any of ($activator*) or any of ($type*)) and
        (any of ($guid*) or any of ($elevate*))
}


// ============================================================================
// Rule 10: PowerShell Admin Check Pattern (Pre-UAC Bypass)
// Purpose: Detect admin privilege checking often seen before UAC bypass attempts
// Confidence: LOW (informational)
// ============================================================================

rule PowerShell_Admin_Check_UAC_Pattern {
    meta:
        description = "Detects admin privilege checking pattern common before UAC bypass"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "2cf59d3e-ae82-48bb-9779-4a5ba5bd9c11"
        mitre_attack = "T1548.002"
        confidence = "low"
        note = "Informational - admin checks are common in legitimate scripts too"

    strings:
        // Admin check patterns
        $admin1 = "WindowsPrincipal" ascii wide nocase
        $admin2 = "WindowsIdentity" ascii wide nocase
        $admin3 = "WindowsBuiltInRole" ascii wide nocase
        $admin4 = "Administrator" ascii wide nocase
        $admin5 = "IsInRole" ascii wide nocase

        // Conditional elevation logic
        $cond1 = "if (-not $isAdmin)" ascii wide nocase
        $cond2 = "if (!$isAdmin)" ascii wide nocase
        $cond3 = "-not.*Administrator" ascii wide nocase

        // UAC bypass indicators nearby
        $uac1 = "UAC" ascii wide nocase
        $uac2 = "bypass" ascii wide nocase
        $uac3 = "elevat" ascii wide nocase

    condition:
        filesize < 100KB and
        2 of ($admin*) and
        any of ($cond*) and
        any of ($uac*)
}
