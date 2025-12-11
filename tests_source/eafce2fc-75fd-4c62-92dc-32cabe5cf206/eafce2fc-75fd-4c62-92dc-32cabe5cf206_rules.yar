/*
============================================================
F0RT1KA YARA Detection Rules
Test ID: eafce2fc-75fd-4c62-92dc-32cabe5cf206
Test Name: Tailscale Remote Access and Data Exfiltration
MITRE ATT&CK: T1105, T1219, T1543.003, T1021.004, T1041
Author: F0RT1KA Defense Guidance Builder
Date: 2025-12-07
============================================================
*/

import "pe"
import "math"

// ============================================================
// RULE 1: F0RT1KA Test Stage Binary Detection
// Detects F0RT1KA multi-stage test binaries by UUID pattern
// Confidence: High
// ============================================================

rule F0RT1KA_Tailscale_Test_Binary
{
    meta:
        description = "Detects F0RT1KA Tailscale Remote Access test binaries"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1105,T1219,T1543.003,T1021.004,T1041"
        confidence = "high"
        severity = "high"

    strings:
        // Test UUID in binary
        $uuid = "eafce2fc-75fd-4c62-92dc-32cabe5cf206" ascii wide

        // Stage technique identifiers
        $stage_t1105 = "T1105" ascii wide
        $stage_t1219 = "T1219" ascii wide
        $stage_t1543 = "T1543.003" ascii wide
        $stage_t1021 = "T1021.004" ascii wide
        $stage_t1041 = "T1041" ascii wide

        // F0RT1KA framework markers
        $f0_marker1 = "F0RT1KA" ascii wide nocase
        $f0_marker2 = "\\F0\\" ascii wide
        $f0_marker3 = "c:\\F0" ascii wide nocase

        // Logging patterns
        $log_pattern1 = "LogMessage" ascii
        $log_pattern2 = "LogStageStart" ascii
        $log_pattern3 = "LogStageEnd" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 100MB and
        (
            $uuid or
            (2 of ($stage_*) and any of ($f0_*)) or
            (2 of ($log_pattern*) and any of ($f0_*))
        )
}

// ============================================================
// RULE 2: Tailscale Auth Key Detection
// Detects Tailscale authentication key patterns
// Confidence: High
// ============================================================

rule Tailscale_Auth_Key_In_Binary
{
    meta:
        description = "Detects Tailscale authentication key embedded in binary"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1219"
        confidence = "high"
        severity = "critical"

    strings:
        // Tailscale auth key patterns
        $authkey1 = "tskey-auth-" ascii wide
        $authkey2 = "TAILSCALE_AUTH_KEY" ascii wide
        $authkey3 = "--authkey=" ascii wide
        $authkey4 = "authkey" ascii wide

        // Tailscale connection strings
        $tailscale1 = "tailscale up" ascii wide nocase
        $tailscale2 = "tailscale.exe" ascii wide nocase
        $tailscale3 = "tailscaled" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 100MB and
        (
            ($authkey1 and any of ($tailscale*)) or
            (2 of ($authkey*) and any of ($tailscale*))
        )
}

// ============================================================
// RULE 3: OpenSSH Installation Script Detection
// Detects OpenSSH installation patterns
// Confidence: Medium
// ============================================================

rule OpenSSH_Installation_Indicators
{
    meta:
        description = "Detects OpenSSH installation script patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1543.003"
        confidence = "medium"
        severity = "high"

    strings:
        // OpenSSH installation patterns
        $openssh1 = "OpenSSH.Server" ascii wide nocase
        $openssh2 = "install-sshd.ps1" ascii wide nocase
        $openssh3 = "sshd" ascii wide
        $openssh4 = "OpenSSH-Win64" ascii wide

        // Installation commands
        $install1 = "Add-WindowsCapability" ascii wide
        $install2 = "Expand-Archive" ascii wide
        $install3 = "Set-Service" ascii wide
        $install4 = "Start-Service" ascii wide

        // Service patterns
        $service1 = "\\Services\\sshd" ascii wide
        $service2 = "StartupType" ascii wide
        $service3 = "Automatic" ascii wide

    condition:
        (
            // PE file with embedded scripts
            (uint16(0) == 0x5A4D and filesize < 100MB and
             2 of ($openssh*) and any of ($install*))
            or
            // PowerShell script
            (2 of ($openssh*) and 2 of ($install*))
        )
}

// ============================================================
// RULE 4: Data Exfiltration Staging Patterns
// Detects data staging and exfiltration indicators
// Confidence: Medium
// ============================================================

rule Data_Exfiltration_Staging_Binary
{
    meta:
        description = "Detects data exfiltration staging patterns in binaries"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1041"
        confidence = "medium"
        severity = "high"

    strings:
        // Staging patterns
        $staging1 = "exfil_staging" ascii wide
        $staging2 = "exfiltration" ascii wide nocase
        $staging3 = "EXFILTRATED_DATA" ascii wide

        // Archive creation
        $archive1 = "exfiltrated_data.zip" ascii wide
        $archive2 = "archive/zip" ascii wide
        $archive3 = "zipWriter" ascii wide

        // Sensitive file patterns
        $sensitive1 = "passwords.txt" ascii wide
        $sensitive2 = "credentials.csv" ascii wide
        $sensitive3 = "api_keys.txt" ascii wide
        $sensitive4 = "ssh_private_key" ascii wide
        $sensitive5 = "customer_data" ascii wide
        $sensitive6 = "financial_report" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            (2 of ($staging*)) or
            (any of ($staging*) and any of ($archive*)) or
            (any of ($staging*) and 2 of ($sensitive*))
        )
}

// ============================================================
// RULE 5: F0RT1KA Test Configuration File
// Detects F0RT1KA test configuration files
// Confidence: High
// ============================================================

rule F0RT1KA_Test_Config_File
{
    meta:
        description = "Detects F0RT1KA test configuration files"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1105"
        confidence = "high"
        severity = "medium"

    strings:
        $config1 = "DOWNLOAD_MODE=" ascii wide
        $config2 = "AUTH_KEY=" ascii wide
        $config3 = "tskey-auth-" ascii wide

    condition:
        filesize < 10KB and
        2 of them
}

// ============================================================
// RULE 6: F0RT1KA State Capture JSON
// Detects F0RT1KA state capture files for cleanup
// Confidence: High
// ============================================================

rule F0RT1KA_State_Capture_JSON
{
    meta:
        description = "Detects F0RT1KA state capture JSON files"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1543.003"
        confidence = "high"
        severity = "low"

    strings:
        // OpenSSH state patterns
        $state1 = "was_installed" ascii
        $state2 = "service_startup" ascii
        $state3 = "service_running" ascii
        $state4 = "firewall_rule_exist" ascii

        // Service state patterns
        $svc_state1 = "startup_type" ascii
        $svc_state2 = "is_running" ascii
        $svc_state3 = "iphlpsvc" ascii
        $svc_state4 = "Dnscache" ascii

    condition:
        filesize < 10KB and
        (
            (3 of ($state*)) or
            (2 of ($svc_state*))
        )
}

// ============================================================
// RULE 7: Tailscale MSI Installer
// Detects Tailscale MSI installer files
// Confidence: Medium
// ============================================================

rule Tailscale_MSI_Installer
{
    meta:
        description = "Detects Tailscale MSI installer files"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1219"
        confidence = "medium"
        severity = "medium"

    strings:
        // MSI header
        $msi_header = { D0 CF 11 E0 A1 B1 1A E1 }

        // Tailscale identifiers
        $ts1 = "Tailscale" ascii wide
        $ts2 = "tailscale.exe" ascii wide
        $ts3 = "tailscaled.exe" ascii wide
        $ts4 = "Tailscale Inc" ascii wide

    condition:
        $msi_header at 0 and
        filesize < 100MB and
        2 of ($ts*)
}

// ============================================================
// RULE 8: Exfiltration Archive with Sensitive Content
// Detects ZIP archives containing sensitive-looking filenames
// Confidence: Medium
// ============================================================

rule Suspicious_Exfiltration_Archive
{
    meta:
        description = "Detects ZIP archives with sensitive content indicators"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1041,T1560.001"
        confidence = "medium"
        severity = "high"

    strings:
        // ZIP header
        $zip_header = { 50 4B 03 04 }

        // Sensitive filename patterns in ZIP
        $fn1 = "passwords" ascii
        $fn2 = "credential" ascii
        $fn3 = "api_key" ascii
        $fn4 = "ssh_" ascii
        $fn5 = "private_key" ascii
        $fn6 = "customer" ascii
        $fn7 = "employee" ascii
        $fn8 = "financial" ascii

    condition:
        $zip_header at 0 and
        filesize < 50MB and
        3 of ($fn*)
}

// ============================================================
// RULE 9: F0RT1KA Multi-Stage Orchestrator
// Detects the main test orchestrator binary
// Confidence: High
// ============================================================

rule F0RT1KA_Orchestrator_Binary
{
    meta:
        description = "Detects F0RT1KA multi-stage test orchestrator"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1105,T1219,T1543.003,T1021.004,T1041"
        confidence = "high"
        severity = "critical"

    strings:
        // UUID
        $uuid = "eafce2fc-75fd-4c62-92dc-32cabe5cf206" ascii wide

        // Test name
        $name = "Tailscale Remote Access and Data Exfiltration" ascii wide

        // Embedded stage patterns
        $embed1 = "stage1Binary" ascii
        $embed2 = "stage2Binary" ascii
        $embed3 = "stage3Binary" ascii
        $embed4 = "stage4Binary" ascii
        $embed5 = "stage5Binary" ascii

        // Killchain patterns
        $kc1 = "KillchainStage" ascii
        $kc2 = "executeStage" ascii
        $kc3 = "extractStage" ascii

        // Output patterns
        $out1 = "VULNERABLE" ascii wide
        $out2 = "PROTECTED" ascii wide
        $out3 = "ExecutionPrevented" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize > 5MB and filesize < 150MB and  // Large due to embedded stages
        (
            $uuid or
            ($name and any of ($kc*)) or
            (3 of ($embed*) and any of ($kc*)) or
            ($uuid and 2 of ($out*))
        )
}

// ============================================================
// RULE 10: Remote Access Tool C2 Patterns
// Detects generic remote access tool C2 patterns
// Confidence: Low (hunting rule)
// ============================================================

rule Remote_Access_Tool_C2_Patterns
{
    meta:
        description = "Detects generic remote access tool C2 patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "eafce2fc-75fd-4c62-92dc-32cabe5cf206"
        mitre_attack = "T1219"
        confidence = "low"
        severity = "medium"

    strings:
        // Tailscale specific
        $ts1 = "tailscale.com" ascii wide nocase
        $ts2 = "pkgs.tailscale.com" ascii wide nocase
        $ts3 = "controlplane.tailscale.com" ascii wide nocase
        $ts4 = "derp" ascii wide  // DERP relay protocol

        // WireGuard patterns
        $wg1 = "WireGuard" ascii wide
        $wg2 = "41641" ascii  // Default WireGuard port

        // Generic RAT patterns
        $rat1 = "authkey" ascii wide
        $rat2 = "--unattended" ascii wide
        $rat3 = "accept-routes" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 100MB and
        (
            (2 of ($ts*) and any of ($rat*)) or
            (any of ($ts*) and any of ($wg*) and any of ($rat*))
        )
}

// ============================================================
// END OF YARA RULES
// ============================================================
