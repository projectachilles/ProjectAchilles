/*
============================================================================
DEFENSE GUIDANCE: YARA Detection Rules
============================================================================
Test ID: c3634a9c-e8c9-44a8-992b-0faeca14f612
Test Name: Akira Ransomware BYOVD Attack Chain
MITRE ATT&CK: T1068 (Privilege Escalation), T1562.001 (Impair Defenses)
Created: 2025-12-07
Author: F0RT1KA Defense Guidance Builder
============================================================================

TECHNIQUE-FOCUSED DETECTION PRINCIPLE:
These YARA rules detect the underlying BYOVD and defense evasion techniques,
NOT the F0RT1KA testing framework specifically. They will catch real-world
attackers using similar vulnerable driver exploitation and Defender tampering.

============================================================================
*/


// ============================================================================
// RULE 1: ThrottleStop Vulnerable Driver (rwdrv.sys)
// Detects the rwdrv.sys driver commonly abused for BYOVD attacks
// ============================================================================

rule BYOVD_ThrottleStop_Driver
{
    meta:
        description = "Detects ThrottleStop rwdrv.sys driver used in BYOVD attacks"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1068"
        confidence = "high"
        severity = "critical"
        reference = "https://attack.mitre.org/techniques/T1068/"

    strings:
        // Driver name patterns
        $name1 = "rwdrv" ascii wide nocase
        $name2 = "ThrottleStop" ascii wide nocase
        $name3 = "RWDRV" ascii

        // Driver-specific strings from rwdrv.sys
        $drv1 = "\\Device\\rwdrv" ascii wide
        $drv2 = "\\DosDevices\\rwdrv" ascii wide
        $drv3 = "RW Driver" ascii wide

        // Kernel mode indicators
        $kernel1 = "ntoskrnl.exe" ascii
        $kernel2 = "IoCreateDevice" ascii
        $kernel3 = "IoCreateSymbolicLink" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 500KB and
        (
            any of ($name*) and any of ($drv*) and any of ($kernel*)
        )
}


// ============================================================================
// RULE 2: Generic BYOVD Vulnerable Driver Detection
// Detects common patterns in vulnerable drivers used for privilege escalation
// ============================================================================

rule BYOVD_Vulnerable_Driver_Generic
{
    meta:
        description = "Detects generic patterns in vulnerable kernel drivers"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1068"
        confidence = "medium"
        severity = "high"

    strings:
        // Known vulnerable driver names
        $vdrv1 = "rwdrv.sys" ascii wide nocase
        $vdrv2 = "mhyprot2.sys" ascii wide nocase
        $vdrv3 = "dbutil_2_3.sys" ascii wide nocase
        $vdrv4 = "gdrv.sys" ascii wide nocase
        $vdrv5 = "iqvw64e.sys" ascii wide nocase
        $vdrv6 = "winio64.sys" ascii wide nocase
        $vdrv7 = "asmmap64.sys" ascii wide nocase
        $vdrv8 = "ntbios.sys" ascii wide nocase
        $vdrv9 = "asio.sys" ascii wide nocase
        $vdrv10 = "elrawdisk.sys" ascii wide nocase

        // Physical memory access patterns (commonly exploited)
        $mem1 = "\\Device\\PhysicalMemory" ascii wide
        $mem2 = "ZwMapViewOfSection" ascii
        $mem3 = "MmMapIoSpace" ascii
        $mem4 = "MmMapLockedPages" ascii

        // Kernel manipulation functions
        $kern1 = "ZwQuerySystemInformation" ascii
        $kern2 = "PsSetLoadImageNotifyRoutine" ascii
        $kern3 = "ObRegisterCallbacks" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 5MB and
        (
            any of ($vdrv*) or
            (any of ($mem*) and 2 of ($kern*))
        )
}


// ============================================================================
// RULE 3: Akira Ransomware Defense Evasion Script
// Detects PowerShell scripts that attempt to disable Windows Defender
// ============================================================================

rule Akira_Defender_Disable_Script
{
    meta:
        description = "Detects PowerShell scripts targeting Windows Defender configuration"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1562.001"
        confidence = "high"
        severity = "critical"
        filetype = "script"

    strings:
        // Registry path patterns for Defender
        $reg1 = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender" ascii wide nocase
        $reg2 = "HKLM:\\SOFTWARE\\Microsoft\\Windows Defender" ascii wide nocase
        $reg3 = "Windows Defender\\Real-Time Protection" ascii wide nocase
        $reg4 = "Windows Defender\\Features" ascii wide nocase

        // Registry manipulation cmdlets
        $cmd1 = "Set-ItemProperty" ascii wide nocase
        $cmd2 = "New-ItemProperty" ascii wide nocase
        $cmd3 = "Remove-ItemProperty" ascii wide nocase
        $cmd4 = "New-Item" ascii wide nocase

        // Defender-specific values being targeted
        $val1 = "DisableAntiSpyware" ascii wide nocase
        $val2 = "DisableRealtimeMonitoring" ascii wide nocase
        $val3 = "TamperProtection" ascii wide nocase
        $val4 = "DisableBehaviorMonitoring" ascii wide nocase

        // Bypass indicators
        $bypass1 = "-ExecutionPolicy" ascii wide nocase
        $bypass2 = "Bypass" ascii wide nocase
        $bypass3 = "Set-ExecutionPolicy" ascii wide nocase

        // Akira-specific strings
        $akira1 = "Akira" ascii wide nocase
        $akira2 = "BYOVD" ascii wide nocase
        $akira3 = "defender_disable" ascii wide nocase

    condition:
        filesize < 500KB and
        (
            // Script targeting Defender registry with manipulation cmdlets
            (any of ($reg*) and any of ($cmd*) and any of ($val*)) or
            // Script with bypass + Defender targeting
            (any of ($bypass*) and any of ($val*)) or
            // Akira-specific indicators
            (any of ($akira*) and any of ($val*))
        )
}


// ============================================================================
// RULE 4: Malicious Driver Helper Pattern (hlpdrv.sys style)
// Detects patterns common in malicious helper drivers used with BYOVD
// ============================================================================

rule BYOVD_Malicious_Helper_Driver
{
    meta:
        description = "Detects patterns in malicious helper drivers used in BYOVD attacks"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1068"
        confidence = "medium"
        severity = "high"

    strings:
        // Common malicious driver names
        $name1 = "hlpdrv" ascii wide nocase
        $name2 = "helper" ascii wide nocase
        $name3 = "hlpsvc" ascii wide nocase

        // Device paths
        $dev1 = "\\Device\\hlpdrv" ascii wide
        $dev2 = "\\DosDevices\\hlpdrv" ascii wide
        $dev3 = "\\Device\\helper" ascii wide

        // Kernel manipulation strings
        $kern1 = "KeAttachProcess" ascii
        $kern2 = "KeStackAttachProcess" ascii
        $kern3 = "ZwOpenProcess" ascii
        $kern4 = "PsLookupProcessByProcessId" ascii

        // Process/memory manipulation
        $proc1 = "ZwTerminateProcess" ascii
        $proc2 = "MmCopyVirtualMemory" ascii
        $proc3 = "ZwProtectVirtualMemory" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 500KB and
        (
            (any of ($name*) or any of ($dev*)) and
            (2 of ($kern*) or 2 of ($proc*))
        )
}


// ============================================================================
// RULE 5: Service Creation Batch/Script Pattern
// Detects scripts that create kernel services for driver loading
// ============================================================================

rule BYOVD_Service_Creation_Script
{
    meta:
        description = "Detects scripts that create kernel services for BYOVD driver loading"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1068"
        confidence = "high"
        severity = "high"
        filetype = "script"

    strings:
        // SC.EXE service creation patterns
        $sc1 = "sc create" ascii wide nocase
        $sc2 = "sc.exe create" ascii wide nocase
        $sc3 = "sc start" ascii wide nocase
        $sc4 = "sc delete" ascii wide nocase

        // Kernel service type
        $type1 = "type= kernel" ascii wide nocase
        $type2 = "type=kernel" ascii wide nocase
        $type3 = "kernel" ascii wide nocase

        // Suspicious service names
        $svc1 = "mgdsrv" ascii wide nocase
        $svc2 = "KMHLPSVC" ascii wide nocase
        $svc3 = "hlpsvc" ascii wide nocase

        // Binary path patterns
        $path1 = "binPath=" ascii wide nocase
        $path2 = "C:\\F0\\" ascii wide nocase
        $path3 = ".sys" ascii wide nocase

    condition:
        filesize < 100KB and
        (
            // Service creation with kernel type
            (any of ($sc*) and any of ($type*) and any of ($path*)) or
            // Known malicious service names
            (any of ($sc*) and any of ($svc*))
        )
}


// ============================================================================
// RULE 6: Combined BYOVD Attack Tool Detection
// Detects tools/binaries that combine driver loading with Defender evasion
// ============================================================================

rule BYOVD_Attack_Tool_Combined
{
    meta:
        description = "Detects tools that combine BYOVD with defense evasion capabilities"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1068, T1562.001"
        confidence = "high"
        severity = "critical"

    strings:
        // Driver-related strings
        $drv1 = "rwdrv.sys" ascii wide
        $drv2 = "hlpdrv.sys" ascii wide
        $drv3 = ".sys" ascii wide

        // Service-related strings
        $svc1 = "sc create" ascii wide
        $svc2 = "mgdsrv" ascii wide
        $svc3 = "KMHLPSVC" ascii wide

        // Defender-related strings
        $def1 = "DisableAntiSpyware" ascii wide
        $def2 = "Windows Defender" ascii wide
        $def3 = "TamperProtection" ascii wide

        // PowerShell patterns
        $ps1 = "powershell" ascii wide nocase
        $ps2 = "-ExecutionPolicy" ascii wide
        $ps3 = "Bypass" ascii wide

        // Attack phase strings (from logging)
        $phase1 = "Phase 1" ascii wide
        $phase2 = "Phase 2" ascii wide
        $phase3 = "Phase 3" ascii wide
        $phase4 = "Phase 4" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            // Has driver + service + defender manipulation
            (any of ($drv*) and any of ($svc*) and any of ($def*)) or
            // Has multiple attack phases
            (3 of ($phase*) and (any of ($drv*) or any of ($def*)))
        )
}


// ============================================================================
// RULE 7: Registry Modification for Defender Evasion (Memory Pattern)
// Detects memory patterns indicating active Defender registry manipulation
// ============================================================================

rule Defender_Registry_Tampering_Memory
{
    meta:
        description = "Detects memory patterns of Defender registry tampering"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1562.001"
        confidence = "medium"
        severity = "high"
        filetype = "memory"

    strings:
        // Registry key patterns
        $key1 = "SOFTWARE\\Policies\\Microsoft\\Windows Defender" wide
        $key2 = "SOFTWARE\\Microsoft\\Windows Defender\\Features" wide
        $key3 = "SOFTWARE\\Microsoft\\Windows Defender\\Real-Time Protection" wide

        // Value names being set
        $val1 = "DisableAntiSpyware" wide
        $val2 = "DisableRealtimeMonitoring" wide
        $val3 = "TamperProtection" wide

        // Status indicators
        $status1 = "DEFENDER_DISABLED" ascii wide
        $status2 = "ACCESS_DENIED" ascii wide
        $status3 = "SECURITY_BLOCKED" ascii wide

        // Registry API patterns
        $api1 = "RegSetValueEx" ascii
        $api2 = "RegCreateKeyEx" ascii
        $api3 = "RegOpenKeyEx" ascii

    condition:
        (
            // Registry key + value + API
            (any of ($key*) and any of ($val*) and any of ($api*)) or
            // Status indicators with registry access
            (any of ($status*) and any of ($key*))
        )
}


// ============================================================================
// RULE 8: Go-Compiled BYOVD Tool
// Detects Go-compiled binaries with BYOVD attack capabilities
// ============================================================================

rule Go_BYOVD_Attack_Tool
{
    meta:
        description = "Detects Go-compiled tools with BYOVD attack capabilities"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1068, T1562.001"
        confidence = "medium"
        severity = "high"

    strings:
        // Go runtime markers
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii
        $go4 = "github.com/preludeorg" ascii

        // BYOVD-related embedded content
        $embed1 = "//go:embed" ascii
        $embed2 = "defender_disable.ps1" ascii
        $embed3 = "rwdrv.sys" ascii

        // Attack logic strings
        $attack1 = "checkAdminPrivileges" ascii
        $attack2 = "createService" ascii
        $attack3 = "simulateDriverDrop" ascii
        $attack4 = "executeDefenderDisable" ascii

        // Dropper patterns
        $dropper1 = "Dropper.Dropper" ascii
        $dropper2 = "Endpoint.Say" ascii
        $dropper3 = "Endpoint.Stop" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 100MB and
        (
            // Go binary with embedded attack components
            (2 of ($go*) and 2 of ($embed*)) or
            // Go binary with attack functions
            (2 of ($go*) and 2 of ($attack*)) or
            // F0RT1KA test binary patterns
            (2 of ($dropper*) and any of ($attack*))
        )
}


// ============================================================================
// RULE 9: Driver Signature Bypass Indicator
// Detects indicators of unsigned or improperly signed drivers
// ============================================================================

rule Unsigned_Driver_Indicator
{
    meta:
        description = "Detects indicators of unsigned or test-signed drivers"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1068"
        confidence = "medium"
        severity = "medium"

    strings:
        // MZ header for PE files
        $mz = { 4D 5A }

        // Driver entry points
        $entry1 = "DriverEntry" ascii
        $entry2 = "GsDriverEntry" ascii

        // Missing or fake signature indicators
        $nosig1 = "Test Signing" ascii wide
        $nosig2 = "Self-Signed" ascii wide
        $nosig3 = "DO NOT TRUST" ascii wide

        // Common driver imports
        $import1 = "ntoskrnl.exe" ascii
        $import2 = "HAL.dll" ascii

    condition:
        $mz at 0 and
        filesize < 5MB and
        (FileName matches /\.sys$/i) and
        any of ($entry*) and
        any of ($import*) and
        any of ($nosig*)
}


// ============================================================================
// RULE 10: Simulated Driver Pattern (Behavioral Test)
// Detects simulated/dummy drivers used in security testing
// ============================================================================

rule Simulated_Driver_Pattern
{
    meta:
        description = "Detects simulated drivers used in security testing"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c3634a9c-e8c9-44a8-992b-0faeca14f612"
        mitre_attack = "T1068"
        confidence = "low"
        severity = "low"

    strings:
        // MZ header
        $mz = { 4D 5A }

        // Dummy/test patterns
        $dummy1 = { 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 }
        $dummy2 = { FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF }

    condition:
        $mz at 0 and
        filesize >= 10KB and
        filesize < 100KB and
        (
            // Large blocks of null or padding bytes (simulated driver)
            #dummy1 > 50 or #dummy2 > 50
        )
}
