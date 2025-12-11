/*
============================================================================
DEFENSE GUIDANCE: YARA Detection Rules
============================================================================
Test ID: 94b248c0-a104-48c3-b4a5-3d45028c407d
Test Name: Gunra Ransomware Simulation
MITRE ATT&CK: T1486, T1490, T1082, T1083, T1622
Created: 2025-12-07
Author: F0RT1KA Defense Guidance Builder
============================================================================

TECHNIQUE-FOCUSED DETECTION PRINCIPLE:
These YARA rules detect the underlying ransomware behaviors and artifacts
demonstrated by Gunra ransomware, NOT the F0RT1KA testing framework
specifically. They will catch real-world Gunra ransomware and similar
variants with common characteristics.

KEY INDICATORS:
- File extension: .ENCRT
- Ransom note: R3ADM3.txt
- Ransom note content patterns
- Anti-debugging techniques (IsDebuggerPresent)
- Shadow copy deletion commands
- File enumeration APIs

============================================================================
*/


// ============================================================================
// RULE 1: Gunra Ransomware Binary Detection
// Detects Gunra ransomware executables based on code and string patterns
// ============================================================================

rule Gunra_Ransomware_Binary
{
    meta:
        description = "Detects Gunra ransomware executable binaries"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1486"
        confidence = "high"
        severity = "critical"
        reference = "https://attack.mitre.org/techniques/T1486/"

    strings:
        // Gunra-specific indicators
        $gunra1 = "gunra" ascii wide nocase
        $gunra2 = "GUNRA" ascii wide
        $gunra3 = "gunraransome" ascii wide nocase

        // File extension marker
        $ext1 = ".ENCRT" ascii wide
        $ext2 = "ENCRT" ascii wide

        // Ransom note filename
        $note1 = "R3ADM3.txt" ascii wide
        $note2 = "R3ADM3" ascii wide

        // Ransom note content patterns
        $content1 = "YOUR FILES HAVE BEEN ENCRYPTED" ascii wide nocase
        $content2 = "Your unique ID" ascii wide nocase
        $content3 = "WHAT GUARANTEES DO WE GIVE" ascii wide nocase
        $content4 = "decrypt" ascii wide nocase
        $content5 = "contact us" ascii wide nocase
        $content6 = "Tor" ascii wide nocase
        $content7 = ".onion" ascii wide nocase

        // Shadow copy deletion commands
        $vss1 = "vssadmin delete shadows" ascii wide nocase
        $vss2 = "vssadmin.exe" ascii wide nocase
        $vss3 = "delete shadows /all" ascii wide nocase
        $vss4 = "Win32_ShadowCopy" ascii wide nocase

        // Anti-debugging (T1622)
        $debug1 = "IsDebuggerPresent" ascii wide
        $debug2 = "CheckRemoteDebuggerPresent" ascii wide
        $debug3 = "NtQueryInformationProcess" ascii wide

        // File enumeration APIs (T1083)
        $enum1 = "FindFirstFileW" ascii wide
        $enum2 = "FindNextFileW" ascii wide
        $enum3 = "FindNextFileExW" ascii wide
        $enum4 = "GetFileAttributesW" ascii wide

        // Process manipulation
        $proc1 = "GetCurrentProcess" ascii wide
        $proc2 = "TerminateProcess" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            // Direct Gunra indicators
            (any of ($gunra*)) or
            // Extension + ransom note combo
            (any of ($ext*) and any of ($note*)) or
            // Ransom content + VSS deletion
            (2 of ($content*) and any of ($vss*)) or
            // Full ransomware behavior pattern
            (any of ($ext*) and any of ($vss*) and 2 of ($enum*))
        )
}


// ============================================================================
// RULE 2: Gunra Ransom Note Detection
// Detects the R3ADM3.txt ransom note file content
// ============================================================================

rule Gunra_Ransom_Note
{
    meta:
        description = "Detects Gunra ransomware ransom note content"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1486"
        confidence = "high"
        severity = "critical"
        filetype = "text"

    strings:
        // Gunra-specific ransom note patterns
        $header1 = "YOUR FILES HAVE BEEN ENCRYPTED" ascii wide nocase
        $header2 = "=== YOUR FILES HAVE BEEN ENCRYPTED ===" ascii wide

        // Unique ID marker (common in Gunra notes)
        $id1 = "Your unique ID:" ascii wide nocase
        $id2 = "GUNRA" ascii wide

        // Typical ransom note sections
        $section1 = "WHAT HAPPENED?" ascii wide nocase
        $section2 = "WHAT GUARANTEES DO WE GIVE?" ascii wide nocase
        $section3 = "WARNING!" ascii wide nocase
        $section4 = "HOW TO CONTACT US?" ascii wide nocase

        // Threat indicators
        $threat1 = "data will be published" ascii wide nocase
        $threat2 = "underground forums" ascii wide nocase
        $threat3 = "5 DAYS" ascii wide nocase
        $threat4 = "exfiltrated" ascii wide nocase

        // Contact methods
        $contact1 = "Tor" ascii wide nocase
        $contact2 = ".onion" ascii wide nocase
        $contact3 = "Visit our" ascii wide nocase

        // Decrypt offer
        $offer1 = "decrypt 1-2 files for free" ascii wide nocase
        $offer2 = "decryption tool" ascii wide nocase
        $offer3 = "proof" ascii wide nocase

    condition:
        filesize < 50KB and
        (
            // Strong Gunra indicators
            (any of ($header*) and $id2) or
            // Ransom note structure
            (any of ($header*) and 2 of ($section*) and any of ($threat*)) or
            // Typical double extortion pattern
            (any of ($header*) and any of ($threat*) and any of ($contact*))
        )
}


// ============================================================================
// RULE 3: Generic Ransomware ENCRT Extension Binary
// Detects binaries that create .ENCRT encrypted files
// ============================================================================

rule Ransomware_ENCRT_Extension
{
    meta:
        description = "Detects ransomware that uses .ENCRT file extension"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1486"
        confidence = "medium"
        severity = "high"

    strings:
        // ENCRT extension
        $ext1 = ".ENCRT" ascii wide
        $ext2 = "ENCRT" ascii wide

        // Common encryption markers
        $enc1 = "[ENCRYPTED" ascii wide
        $enc2 = "encrypted by" ascii wide nocase
        $enc3 = "encryption complete" ascii wide nocase

        // File operations
        $file1 = "CreateFileW" ascii wide
        $file2 = "WriteFile" ascii wide
        $file3 = "DeleteFileW" ascii wide
        $file4 = "MoveFileW" ascii wide
        $file5 = "CopyFileW" ascii wide

        // Crypto indicators
        $crypto1 = "CryptEncrypt" ascii wide
        $crypto2 = "CryptGenKey" ascii wide
        $crypto3 = "BCryptEncrypt" ascii wide
        $crypto4 = "AES" ascii wide
        $crypto5 = "RSA" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // ENCRT extension with file operations
            (any of ($ext*) and 3 of ($file*)) or
            // ENCRT with encryption markers
            (any of ($ext*) and any of ($enc*)) or
            // ENCRT with crypto APIs
            (any of ($ext*) and 2 of ($crypto*))
        )
}


// ============================================================================
// RULE 4: Shadow Copy Deletion Tool
// Detects tools/scripts designed to delete Volume Shadow Copies
// ============================================================================

rule Shadow_Copy_Deletion_Tool
{
    meta:
        description = "Detects tools that delete Volume Shadow Copies"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1490"
        confidence = "high"
        severity = "high"

    strings:
        // vssadmin commands
        $vss1 = "vssadmin delete shadows" ascii wide nocase
        $vss2 = "vssadmin.exe delete" ascii wide nocase
        $vss3 = "/all /quiet" ascii wide nocase
        $vss4 = "delete shadows /all" ascii wide nocase

        // WMI-based deletion
        $wmi1 = "Win32_ShadowCopy" ascii wide
        $wmi2 = "shadowcopy delete" ascii wide nocase
        $wmi3 = ".Delete()" ascii wide
        $wmi4 = "wmic shadowcopy" ascii wide nocase

        // PowerShell methods
        $ps1 = "Get-WmiObject Win32_ShadowCopy" ascii wide nocase
        $ps2 = "Remove-WmiObject" ascii wide nocase
        $ps3 = "Delete-VssSnapshot" ascii wide nocase

        // BCDEdit recovery disabling
        $bcd1 = "bcdedit" ascii wide nocase
        $bcd2 = "recoveryenabled no" ascii wide nocase
        $bcd3 = "bootstatuspolicy ignoreallfailures" ascii wide nocase

        // DiskshadowP
        $disk1 = "diskshadow" ascii wide nocase
        $disk2 = "delete shadows" ascii wide nocase

    condition:
        filesize < 10MB and
        (
            // VSS deletion commands
            (2 of ($vss*)) or
            // WMI deletion
            (2 of ($wmi*)) or
            // PowerShell deletion
            (2 of ($ps*)) or
            // BCDEdit abuse
            ($bcd1 and ($bcd2 or $bcd3)) or
            // Combined indicators
            (any of ($vss*) and any of ($bcd*))
        )
}


// ============================================================================
// RULE 5: Anti-Debugging Ransomware
// Detects ransomware with anti-debugging capabilities (T1622)
// ============================================================================

rule Ransomware_AntiDebug
{
    meta:
        description = "Detects ransomware with anti-debugging capabilities"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1622"
        confidence = "medium"
        severity = "high"

    strings:
        // Windows anti-debug APIs
        $debug1 = "IsDebuggerPresent" ascii wide
        $debug2 = "CheckRemoteDebuggerPresent" ascii wide
        $debug3 = "NtQueryInformationProcess" ascii wide
        $debug4 = "OutputDebugStringW" ascii wide
        $debug5 = "GetTickCount" ascii wide

        // PEB checking
        $peb1 = "BeingDebugged" ascii wide
        $peb2 = "NtGlobalFlag" ascii wide
        $peb3 = "ProcessHeap" ascii wide

        // Timing-based checks
        $time1 = "QueryPerformanceCounter" ascii wide
        $time2 = "rdtsc" ascii

        // Ransomware indicators (to distinguish from benign anti-debug)
        $ransom1 = "encrypt" ascii wide nocase
        $ransom2 = "decrypt" ascii wide nocase
        $ransom3 = "ransom" ascii wide nocase
        $ransom4 = ".ENCRT" ascii wide
        $ransom5 = "R3ADM3" ascii wide
        $ransom6 = "YOUR FILES" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // Anti-debug APIs with ransomware indicators
            (2 of ($debug*) and 2 of ($ransom*)) or
            // PEB checking with ransomware
            (any of ($peb*) and 2 of ($ransom*)) or
            // Gunra-specific with anti-debug
            (any of ($debug*) and ($ransom4 or $ransom5))
        )
}


// ============================================================================
// RULE 6: Go-compiled Ransomware Detection
// Detects Go-language ransomware (common for modern ransomware)
// ============================================================================

rule Go_Ransomware
{
    meta:
        description = "Detects Go-compiled ransomware binaries"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1486"
        confidence = "medium"
        severity = "high"

    strings:
        // Go runtime markers
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii
        $go4 = "runtime.main" ascii

        // Go standard library paths
        $golib1 = "golang.org" ascii
        $golib2 = "syscall.Syscall" ascii
        $golib3 = "os.(*File)" ascii
        $golib4 = "filepath.Walk" ascii

        // Ransomware behavior strings
        $ransom1 = "encrypt" ascii wide nocase
        $ransom2 = ".ENCRT" ascii wide
        $ransom3 = "R3ADM3" ascii wide
        $ransom4 = "shadows" ascii wide nocase
        $ransom5 = "vssadmin" ascii wide nocase
        $ransom6 = "YOUR FILES" ascii wide nocase

        // File operations in Go
        $file1 = "os.WriteFile" ascii
        $file2 = "os.Remove" ascii
        $file3 = "os.Rename" ascii
        $file4 = "ioutil.ReadFile" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Go binary with ransomware strings
            (2 of ($go*) and 2 of ($ransom*)) or
            // Go with Gunra-specific indicators
            (2 of ($go*) and ($ransom2 or $ransom3)) or
            // Go file operations with ransomware
            (2 of ($go*) and 2 of ($file*) and any of ($ransom*))
        )
}


// ============================================================================
// RULE 7: Encrypted File Content Pattern
// Detects files that have been encrypted by Gunra
// ============================================================================

rule Gunra_Encrypted_File
{
    meta:
        description = "Detects files encrypted by Gunra ransomware"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1486"
        confidence = "medium"
        severity = "medium"
        filetype = "encrypted"

    strings:
        // Gunra encryption header marker
        $header1 = "[ENCRYPTED BY GUNRA" ascii wide
        $header2 = "ENCRYPTED BY GUNRA" ascii wide
        $header3 = "GUNRA RANSOMWARE" ascii wide

        // Test mode marker (F0RT1KA simulation)
        $test1 = "TEST MODE" ascii wide
        $test2 = "SECURITY TEST" ascii wide

    condition:
        filesize < 100MB and
        (
            // Gunra encryption marker at file start
            ($header1 at 0) or
            ($header2 at 0) or
            // Gunra header anywhere in first 1KB
            (any of ($header*) in (0..1024)) or
            // Test mode indicators
            (any of ($test*) and any of ($header*))
        )
}


// ============================================================================
// RULE 8: PowerShell Ransomware Script
// Detects PowerShell scripts with ransomware behavior
// ============================================================================

rule PowerShell_Ransomware_Script
{
    meta:
        description = "Detects PowerShell scripts with ransomware characteristics"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1486, T1490"
        confidence = "medium"
        severity = "high"
        filetype = "script"

    strings:
        // PowerShell encryption
        $ps_enc1 = "ConvertTo-SecureString" ascii wide nocase
        $ps_enc2 = "System.Security.Cryptography" ascii wide nocase
        $ps_enc3 = "AesCryptoServiceProvider" ascii wide nocase
        $ps_enc4 = "RijndaelManaged" ascii wide nocase
        $ps_enc5 = "CryptoStream" ascii wide nocase

        // File operations
        $ps_file1 = "Get-ChildItem -Recurse" ascii wide nocase
        $ps_file2 = "Rename-Item" ascii wide nocase
        $ps_file3 = "-Extension" ascii wide nocase
        $ps_file4 = "Set-Content" ascii wide nocase

        // Shadow copy deletion
        $ps_vss1 = "vssadmin delete" ascii wide nocase
        $ps_vss2 = "Win32_ShadowCopy" ascii wide nocase
        $ps_vss3 = "Get-WmiObject.*ShadowCopy" ascii wide nocase

        // Ransom note creation
        $ps_note1 = "R3ADM3.txt" ascii wide nocase
        $ps_note2 = "Out-File" ascii wide nocase
        $ps_note3 = "YOUR FILES" ascii wide nocase

        // Extension patterns
        $ps_ext1 = ".ENCRT" ascii wide
        $ps_ext2 = "encrypted" ascii wide nocase

    condition:
        filesize < 1MB and
        (
            // Encryption with file operations
            (any of ($ps_enc*) and 2 of ($ps_file*)) or
            // VSS deletion in script
            (any of ($ps_vss*)) or
            // Ransom note creation
            ($ps_note1 and any of ($ps_note2, $ps_note3)) or
            // Full ransomware pattern
            (any of ($ps_enc*) and any of ($ps_vss*) and any of ($ps_ext*))
        )
}


// ============================================================================
// RULE 9: Batch Script Ransomware Helper
// Detects batch scripts assisting ransomware operations
// ============================================================================

rule Batch_Ransomware_Helper
{
    meta:
        description = "Detects batch scripts that assist ransomware operations"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1490"
        confidence = "medium"
        severity = "high"
        filetype = "script"

    strings:
        // VSS deletion
        $bat_vss1 = "vssadmin delete shadows" ascii nocase
        $bat_vss2 = "vssadmin.exe delete" ascii nocase
        $bat_vss3 = "/all /quiet" ascii nocase

        // BCDEdit abuse
        $bat_bcd1 = "bcdedit /set" ascii nocase
        $bat_bcd2 = "recoveryenabled no" ascii nocase
        $bat_bcd3 = "bootstatuspolicy" ascii nocase

        // WMIC shadow deletion
        $bat_wmic1 = "wmic shadowcopy delete" ascii nocase
        $bat_wmic2 = "wmic shadowcopy" ascii nocase

        // Disable recovery services
        $bat_svc1 = "sc stop VSS" ascii nocase
        $bat_svc2 = "sc config VSS" ascii nocase
        $bat_svc3 = "net stop" ascii nocase

        // File deletion
        $bat_del1 = "del /s /q" ascii nocase
        $bat_del2 = "rd /s /q" ascii nocase

    condition:
        filesize < 100KB and
        (
            // Multiple VSS operations
            (2 of ($bat_vss*)) or
            // BCDEdit abuse
            ($bat_bcd1 and ($bat_bcd2 or $bat_bcd3)) or
            // Service manipulation + VSS
            (any of ($bat_svc*) and any of ($bat_vss*)) or
            // WMIC deletion
            (any of ($bat_wmic*))
        )
}


// ============================================================================
// RULE 10: Memory Pattern - Active Ransomware
// Detects memory patterns of active Gunra ransomware
// ============================================================================

rule Gunra_Ransomware_Memory
{
    meta:
        description = "Detects Gunra ransomware in process memory"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "94b248c0-a104-48c3-b4a5-3d45028c407d"
        mitre_attack = "T1486"
        confidence = "medium"
        severity = "critical"
        filetype = "memory"

    strings:
        // Runtime strings
        $mem1 = "Gunra Ransomware simulation" ascii wide
        $mem2 = "Starting Gunra" ascii wide
        $mem3 = "Encrypting file:" ascii wide
        $mem4 = "Encrypted file:" ascii wide
        $mem5 = "Dropping ransom note" ascii wide

        // File paths being encrypted
        $path1 = ".docx.ENCRT" ascii wide
        $path2 = ".xlsx.ENCRT" ascii wide
        $path3 = ".pdf.ENCRT" ascii wide
        $path4 = ".pptx.ENCRT" ascii wide

        // Ransom note content in memory
        $note1 = "YOUR FILES HAVE BEEN ENCRYPTED" ascii wide
        $note2 = "GUNRA-TEST-2024" ascii wide
        $note3 = "5 DAYS to contact us" ascii wide

        // VSS commands
        $vss1 = "vssadmin delete shadows" ascii wide nocase
        $vss2 = "delete shadows /all /quiet" ascii wide nocase

    condition:
        (
            // Active encryption strings
            (2 of ($mem*)) or
            // Encrypted file paths in memory
            (2 of ($path*)) or
            // Ransom note being written
            (2 of ($note*)) or
            // Combined indicators
            (any of ($mem*) and any of ($note*))
        )
}
