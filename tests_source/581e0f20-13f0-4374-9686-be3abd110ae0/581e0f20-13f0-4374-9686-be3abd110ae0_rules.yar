/*
============================================================
F0RT1KA YARA Rules - Ransomware Encryption via BitLocker
Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0
MITRE ATT&CK: T1070.001, T1562.004, T1082, T1083, T1486, T1490
Generated: 2024-12-07
============================================================

Rule Index:
1. F0RT1KA_BitLocker_Ransomware_Test - Main test binary detection
2. F0RT1KA_BitLocker_Stage_Binary - Stage binary detection
3. F0RT1KA_BitLocker_PowerShell_EventLog - PowerShell event log clearing
4. F0RT1KA_BitLocker_Discovery_Script - Discovery script patterns
5. F0RT1KA_BitLocker_Diskpart_Script - VHD creation script detection
6. F0RT1KA_Generic_Ransomware_Indicators - Generic ransomware patterns

============================================================
*/


/*
============================================================
YARA Rule: F0RT1KA BitLocker Ransomware Test Binary
Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0
MITRE ATT&CK: T1486, T1490
Confidence: High
Description: Detects F0RT1KA BitLocker ransomware test binaries
Author: F0RT1KA Defense Guidance Builder
Date: 2024-12-07
============================================================
*/

rule F0RT1KA_BitLocker_Ransomware_Test
{
    meta:
        description = "Detects F0RT1KA BitLocker ransomware simulation test binary"
        author = "F0RT1KA"
        date = "2024-12-07"
        test_id = "581e0f20-13f0-4374-9686-be3abd110ae0"
        mitre_attack = "T1486,T1490"
        confidence = "high"
        severity = "informational"
        reference = "F0RT1KA Security Testing Framework"

    strings:
        // Test UUID
        $uuid = "581e0f20-13f0-4374-9686-be3abd110ae0" ascii wide

        // Test name strings
        $name1 = "Ransomware Encryption via BitLocker" ascii wide
        $name2 = "F0RT1KA Multi-Stage Test" ascii wide
        $name3 = "F0RT1KA Security Testing Framework" ascii wide

        // Stage binary patterns
        $stage1 = "-stage1.exe" ascii wide
        $stage2 = "-stage2.exe" ascii wide
        $stage3 = "-stage3.exe" ascii wide

        // BitLocker password used in test
        $password = "F0RT1KA-Recovery-2024!" ascii wide

        // VHD path
        $vhd_path = "bitlocker_test.vhd" ascii wide nocase
        $vhd_label = "F0RT1KA-TEST" ascii wide

        // Output paths
        $log_path = "c:\\F0\\" ascii wide nocase
        $log_file = "test_execution_log.json" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            $uuid or
            ($name1 and $name2) or
            ($stage1 and $stage2 and $stage3) or
            ($password and ($vhd_path or $vhd_label)) or
            ($log_path and $log_file and $uuid)
        )
}


/*
============================================================
YARA Rule: F0RT1KA BitLocker Stage Binary Detection
Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0
MITRE ATT&CK: T1070.001, T1562.004, T1082, T1083, T1486, T1490
Confidence: High
Description: Detects individual stage binaries from the test
Author: F0RT1KA Defense Guidance Builder
Date: 2024-12-07
============================================================
*/

rule F0RT1KA_BitLocker_Stage_Binary
{
    meta:
        description = "Detects F0RT1KA BitLocker test stage binaries"
        author = "F0RT1KA"
        date = "2024-12-07"
        test_id = "581e0f20-13f0-4374-9686-be3abd110ae0"
        mitre_attack = "T1070.001,T1562.004,T1082,T1083,T1486,T1490"
        confidence = "high"
        severity = "informational"

    strings:
        // Test UUID
        $uuid = "581e0f20-13f0-4374-9686-be3abd110ae0" ascii wide

        // Stage identification strings
        $stage1_id = "Stage 1: Defense Evasion" ascii wide
        $stage2_id = "Stage 2: Discovery" ascii wide
        $stage3_id = "Stage 3: Impact" ascii wide

        // Technique identifiers
        $tech1 = "T1070.001" ascii wide
        $tech2 = "T1562.004" ascii wide
        $tech3 = "T1082" ascii wide
        $tech4 = "T1083" ascii wide
        $tech5 = "T1486" ascii wide
        $tech6 = "T1490" ascii wide

        // Stage-specific functionality
        $eventlog = "F0RT1KA-Test" ascii wide  // Custom event log channel
        $firewall = "F0RT1KA-Test-Rule" ascii wide  // Test firewall rule
        $bitlocker_cmd = "manage-bde" ascii wide
        $vss_cmd = "vssadmin" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 10MB and
        $uuid and
        (
            ($stage1_id and ($tech1 or $tech2)) or
            ($stage2_id and ($tech3 or $tech4)) or
            ($stage3_id and ($tech5 or $tech6)) or
            ($eventlog and $firewall) or
            ($bitlocker_cmd and $vss_cmd)
        )
}


/*
============================================================
YARA Rule: PowerShell Event Log Clearing Commands
Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0
MITRE ATT&CK: T1070.001
Confidence: Medium
Description: Detects PowerShell scripts with event log clearing commands
Author: F0RT1KA Defense Guidance Builder
Date: 2024-12-07
============================================================
*/

rule F0RT1KA_BitLocker_PowerShell_EventLog
{
    meta:
        description = "Detects PowerShell commands for event log manipulation"
        author = "F0RT1KA"
        date = "2024-12-07"
        test_id = "581e0f20-13f0-4374-9686-be3abd110ae0"
        mitre_attack = "T1070.001"
        confidence = "medium"
        severity = "high"

    strings:
        // PowerShell event log commands
        $ps_clear1 = "Clear-EventLog" ascii wide nocase
        $ps_clear2 = "Remove-EventLog" ascii wide nocase
        $ps_clear3 = "wevtutil cl" ascii wide nocase
        $ps_clear4 = "wevtutil clear-log" ascii wide nocase

        // New-EventLog for creating custom channels
        $ps_new = "New-EventLog" ascii wide nocase
        $ps_write = "Write-EventLog" ascii wide nocase

        // F0RT1KA specific
        $f0rt1ka = "F0RT1KA" ascii wide nocase

    condition:
        filesize < 1MB and
        (
            any of ($ps_clear*) or
            (($ps_new or $ps_write) and $f0rt1ka)
        )
}


/*
============================================================
YARA Rule: Diskpart VHD Creation Script
Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0
MITRE ATT&CK: T1486
Confidence: Medium
Description: Detects diskpart scripts for VHD creation (potential encryption container)
Author: F0RT1KA Defense Guidance Builder
Date: 2024-12-07
============================================================
*/

rule F0RT1KA_BitLocker_Diskpart_Script
{
    meta:
        description = "Detects diskpart scripts for VHD creation"
        author = "F0RT1KA"
        date = "2024-12-07"
        test_id = "581e0f20-13f0-4374-9686-be3abd110ae0"
        mitre_attack = "T1486"
        confidence = "medium"
        severity = "medium"

    strings:
        // Diskpart VHD commands
        $dp_create = "create vdisk" ascii wide nocase
        $dp_attach = "attach vdisk" ascii wide nocase
        $dp_detach = "detach vdisk" ascii wide nocase
        $dp_select = "select vdisk" ascii wide nocase

        // File paths
        $dp_file = ".vhd" ascii wide nocase
        $dp_f0 = "c:\\F0\\" ascii wide nocase

        // Format commands
        $dp_format = "format fs=ntfs" ascii wide nocase
        $dp_partition = "create partition primary" ascii wide nocase
        $dp_assign = "assign" ascii wide nocase

    condition:
        filesize < 100KB and
        (
            ($dp_create and $dp_attach and $dp_file) or
            ($dp_select and $dp_detach and $dp_file) or
            ($dp_create and $dp_format and $dp_partition) or
            ($dp_f0 and any of ($dp_*))
        )
}


/*
============================================================
YARA Rule: Generic BitLocker Ransomware Indicators
Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0
MITRE ATT&CK: T1486, T1490
Confidence: Medium
Description: Generic patterns associated with BitLocker-based ransomware
Author: F0RT1KA Defense Guidance Builder
Date: 2024-12-07
============================================================
*/

rule F0RT1KA_Generic_Ransomware_Indicators
{
    meta:
        description = "Detects generic BitLocker ransomware behavioral patterns"
        author = "F0RT1KA"
        date = "2024-12-07"
        test_id = "581e0f20-13f0-4374-9686-be3abd110ae0"
        mitre_attack = "T1486,T1490"
        confidence = "medium"
        severity = "high"
        note = "May have false positives with legitimate admin tools"

    strings:
        // BitLocker encryption commands
        $bl_on = "manage-bde -on" ascii wide nocase
        $bl_password = "-Password" ascii wide nocase
        $bl_recovery = "-RecoveryPassword" ascii wide nocase
        $bl_used_space = "-UsedSpaceOnly" ascii wide nocase

        // VSS deletion patterns
        $vss_delete1 = "vssadmin delete shadows" ascii wide nocase
        $vss_delete2 = "wmic shadowcopy delete" ascii wide nocase
        $vss_quiet = "/quiet" ascii wide nocase

        // System enumeration
        $enum_wmic = "wmic logicaldisk" ascii wide nocase
        $enum_vol = "wmic volume" ascii wide nocase

        // Recovery inhibition
        $bcdedit1 = "bcdedit /set" ascii wide nocase
        $bcdedit2 = "recoveryenabled no" ascii wide nocase
        $wbadmin = "wbadmin delete catalog" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            // BitLocker with password (unusual)
            ($bl_on and $bl_password) or

            // Multiple ransomware indicators
            (any of ($vss_delete*) and any of ($bl_*)) or

            // Recovery prevention combination
            (any of ($vss_delete*) and any of ($bcdedit*)) or
            ($wbadmin and any of ($vss_delete*)) or

            // Full attack chain indicators
            (any of ($enum_*) and any of ($bl_*) and any of ($vss_delete*))
        )
}


/*
============================================================
YARA Rule: Discovery Phase Script Detection
Test ID: 581e0f20-13f0-4374-9686-be3abd110ae0
MITRE ATT&CK: T1082, T1083
Confidence: Low
Description: Detects scripts performing pre-encryption reconnaissance
Author: F0RT1KA Defense Guidance Builder
Date: 2024-12-07
============================================================
*/

rule F0RT1KA_BitLocker_Discovery_Script
{
    meta:
        description = "Detects discovery scripts used in ransomware preparation"
        author = "F0RT1KA"
        date = "2024-12-07"
        test_id = "581e0f20-13f0-4374-9686-be3abd110ae0"
        mitre_attack = "T1082,T1083"
        confidence = "low"
        severity = "low"

    strings:
        // System enumeration
        $wmic_cs = "wmic computersystem" ascii wide nocase
        $wmic_os = "wmic os get" ascii wide nocase
        $wmic_disk = "wmic logicaldisk" ascii wide nocase
        $wmic_vol = "wmic volume" ascii wide nocase

        // BitLocker status check
        $bde_status = "manage-bde -status" ascii wide nocase

        // Target file creation
        $target_file = "target_volumes" ascii wide nocase

        // F0RT1KA specific
        $f0rt1ka_path = "c:\\F0\\" ascii wide nocase

    condition:
        filesize < 10MB and
        (
            // Multiple WMIC enumeration commands
            (2 of ($wmic_*)) or

            // BitLocker recon with drive enumeration
            ($bde_status and any of ($wmic_*)) or

            // F0RT1KA test specific
            ($f0rt1ka_path and $target_file) or
            ($f0rt1ka_path and any of ($wmic_*) and $bde_status)
        )
}


/*
============================================================
END OF YARA RULES
============================================================
*/
