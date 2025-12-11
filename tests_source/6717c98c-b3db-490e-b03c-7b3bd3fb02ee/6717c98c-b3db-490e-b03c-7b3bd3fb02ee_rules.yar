/*
============================================================
F0RT1KA Defense Guidance - YARA Detection Rules
Test ID: 6717c98c-b3db-490e-b03c-7b3bd3fb02ee
Test Name: SafePay Go-Native Ransomware Simulation
MITRE ATT&CK: T1486, T1560.001, T1490, T1083, T1005, T1071.001
Generated: 2025-12-07
============================================================

Purpose: YARA rules for file and memory detection of SafePay
         ransomware artifacts and related indicators

Rules Included:
  1. SafePay_Ransom_Note - Detects ransom note content
  2. SafePay_Encrypted_File - Detects .safepay encrypted files
  3. SafePay_Go_Binary - Detects SafePay Go binary characteristics
  4. SafePay_Archive_Patterns - Detects exfiltration archive naming
  5. SafePay_Embedded_WinRAR - Detects Go binary with embedded WinRAR
  6. SafePay_C2_Patterns - Detects C2 communication patterns
  7. SafePay_Simulation_Log - Detects simulation log content
  8. SafePay_Corporate_Document_Staging - Detects staged documents

============================================================
*/


/*
============================================================
Rule 1: SafePay Ransom Note Detection
MITRE ATT&CK: T1486 (Data Encrypted for Impact)
Confidence: Critical
Description: Detects SafePay ransom note content patterns
============================================================
*/

rule SafePay_Ransom_Note
{
    meta:
        description = "Detects SafePay ransomware ransom note content"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1486"
        confidence = "critical"
        threat_type = "ransomware"
        severity = 10

    strings:
        // SafePay specific identifiers
        $safepay_header = "SAFEPAY RANSOMWARE" ascii wide nocase
        $safepay_note_name = "readme_safepay" ascii wide nocase

        // Ransom note content patterns
        $encrypted_msg1 = "All your files have been encrypted" ascii wide nocase
        $encrypted_msg2 = "files are encrypted" ascii wide nocase
        $encrypted_msg3 = "military-grade encryption" ascii wide nocase

        // Payment instructions
        $payment1 = "pay" ascii wide nocase
        $payment2 = "Bitcoin" ascii wide nocase
        $payment3 = "Computer ID" ascii wide nocase

        // Threat language
        $threat1 = "permanently lost" ascii wide nocase
        $threat2 = "72 hours" ascii wide nocase
        $threat3 = "do not try to decrypt" ascii wide nocase

        // Contact patterns
        $contact1 = "@darkweb.onion" ascii wide nocase
        $contact2 = "safepay@" ascii wide nocase

    condition:
        (
            $safepay_header or
            $safepay_note_name
        ) or
        (
            2 of ($encrypted_msg*) and
            2 of ($payment*) and
            1 of ($threat*)
        ) or
        (
            1 of ($contact*) and
            1 of ($encrypted_msg*)
        )
}


/*
============================================================
Rule 2: SafePay Encrypted File Detection
MITRE ATT&CK: T1486 (Data Encrypted for Impact)
Confidence: High
Description: Detects files with .safepay extension markers
============================================================
*/

rule SafePay_Encrypted_File
{
    meta:
        description = "Detects files encrypted by SafePay ransomware (Base64 encoded)"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1486"
        confidence = "high"
        threat_type = "ransomware"
        severity = 8

    strings:
        // Base64 encoded content patterns (SafePay uses Base64 for simulation)
        // These detect Base64-encoded document headers
        $b64_pdf = "JVBERi0" ascii  // %PDF- in Base64
        $b64_docx = "UEsDBBQ" ascii  // PK (ZIP/DOCX header) in Base64
        $b64_xlsx = "UEsFBgA" ascii  // PK (ZIP/XLSX) variant
        $b64_zip = "UEsDB" ascii    // Generic ZIP in Base64

        // Large Base64 blocks (typical of encrypted files)
        $b64_block = /[A-Za-z0-9+\/]{100,}={0,2}/ ascii

    condition:
        // File has .safepay in name (checked by external condition)
        // OR file content is primarily Base64
        (
            filesize < 50MB and
            (
                $b64_pdf at 0 or
                $b64_docx at 0 or
                $b64_xlsx at 0 or
                $b64_zip at 0
            )
        ) or
        (
            // File is mostly Base64 content
            filesize < 50MB and
            #b64_block > 10
        )
}


/*
============================================================
Rule 3: SafePay Go Binary Detection
MITRE ATT&CK: T1486, T1005 (Multiple)
Confidence: High
Description: Detects SafePay Go-compiled ransomware binary
============================================================
*/

rule SafePay_Go_Binary
{
    meta:
        description = "Detects SafePay Go-native ransomware binary"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1486,T1005"
        confidence = "high"
        threat_type = "ransomware"
        severity = 9

    strings:
        // Go binary markers
        $go_build = "Go build ID" ascii
        $go_runtime = "runtime.main" ascii
        $go_path = "go.string" ascii

        // SafePay specific function names (Go symbols)
        $func1 = "executeGoNativeRansomwareSimulation" ascii
        $func2 = "createCorporateDirectoryStructure" ascii
        $func3 = "createRealisticCorporateFiles" ascii
        $func4 = "executeMultiPhaseCompression" ascii
        $func5 = "performSelectiveDeletion" ascii
        $func6 = "simulateFileEncryption" ascii
        $func7 = "createRansomNote" ascii
        $func8 = "simulateC2Communication" ascii

        // SafePay specific strings
        $str1 = "safepay_simulation.log" ascii wide
        $str2 = ".safepay" ascii wide
        $str3 = "readme_safepay.txt" ascii wide
        $str4 = "EXFIL_Master" ascii wide
        $str5 = "fortika-test" ascii wide

        // Department targeting strings
        $dept1 = "Finance_Archive" ascii wide
        $dept2 = "HR_Archive" ascii wide
        $dept3 = "Legal_Archive" ascii wide
        $dept4 = "Documents_Data" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            // Go binary with SafePay functions
            (1 of ($go_*) and 3 of ($func*)) or
            // Go binary with SafePay strings
            (1 of ($go_*) and 4 of ($str*)) or
            // SafePay specific combinations
            (3 of ($func*) and 2 of ($str*)) or
            // Department targeting pattern
            (2 of ($dept*) and 2 of ($str*))
        )
}


/*
============================================================
Rule 4: Exfiltration Archive Naming Pattern
MITRE ATT&CK: T1560.001 (Archive Collected Data)
Confidence: High
Description: Detects archive files with exfiltration naming patterns
============================================================
*/

rule SafePay_Archive_Patterns
{
    meta:
        description = "Detects archive files with SafePay exfiltration naming patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1560.001"
        confidence = "high"
        threat_type = "data-staging"
        severity = 7

    strings:
        // RAR file header
        $rar_header = { 52 61 72 21 1A 07 }  // Rar!
        $rar_header2 = { 52 61 72 21 1A 07 01 00 }  // RAR5 header

        // ZIP header (for completeness)
        $zip_header = { 50 4B 03 04 }  // PK

        // Archive naming patterns in filename (if embedded)
        $name1 = "Finance_Archive" ascii wide nocase
        $name2 = "HR_Archive" ascii wide nocase
        $name3 = "Legal_Archive" ascii wide nocase
        $name4 = "IT_Archive" ascii wide nocase
        $name5 = "Sales_Archive" ascii wide nocase
        $name6 = "Executive_Archive" ascii wide nocase
        $name7 = "Documents_Data" ascii wide nocase
        $name8 = "Desktop_Data" ascii wide nocase
        $name9 = "EXFIL_Master" ascii wide nocase
        $name10 = "EXFIL_" ascii wide nocase

    condition:
        (
            ($rar_header at 0 or $rar_header2 at 0 or $zip_header at 0) and
            1 of ($name*)
        ) or
        (
            // Just naming patterns (for filename matching)
            2 of ($name*)
        )
}


/*
============================================================
Rule 5: Go Binary with Embedded WinRAR
MITRE ATT&CK: T1560.001 (Archive Collected Data)
Confidence: High
Description: Detects Go binary containing embedded WinRAR executable
============================================================
*/

rule SafePay_Embedded_WinRAR
{
    meta:
        description = "Detects Go binary with embedded WinRAR for data staging"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1560.001"
        confidence = "high"
        threat_type = "data-staging"
        severity = 8

    strings:
        // Go embed directive marker
        $embed = "go:embed" ascii
        $embed2 = "//go:embed WinRAR.exe" ascii

        // WinRAR binary signatures (when embedded)
        $winrar_str1 = "WinRAR.exe" ascii wide
        $winrar_str2 = "RARLAB" ascii wide
        $winrar_str3 = "WinRAR archiver" ascii wide
        $winrar_str4 = "Alexander Roshal" ascii wide

        // PE header for embedded executable
        $pe_marker = "MZ" ascii
        $pe_message = "This program cannot be run in DOS mode" ascii

        // Go binary markers
        $go_build = "Go build ID" ascii

    condition:
        uint16(0) == 0x5A4D and  // Main file is PE
        filesize < 50MB and
        $go_build and
        (
            $embed2 or
            (2 of ($winrar_str*) and #pe_marker > 1)  // Multiple PE headers
        )
}


/*
============================================================
Rule 6: SafePay C2 Communication Patterns
MITRE ATT&CK: T1071.001 (Application Layer Protocol)
Confidence: Medium
Description: Detects C2 communication simulation patterns
============================================================
*/

rule SafePay_C2_Patterns
{
    meta:
        description = "Detects SafePay C2 communication simulation patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1071.001"
        confidence = "medium"
        threat_type = "c2-communication"
        severity = 6

    strings:
        // C2 header patterns from simulation
        $c2_header1 = "C4 C3 C2 C1" ascii wide
        $c2_header2 = "header pattern" ascii wide nocase

        // C2 simulation messages
        $c2_msg1 = "Simulating C2 communication" ascii wide
        $c2_msg2 = "Establishing connection to C2 server" ascii wide
        $c2_msg3 = "Encryption key sent to attacker server" ascii wide

        // Onion address patterns
        $onion = ".onion" ascii wide
        $darkweb = "darkweb" ascii wide nocase

    condition:
        2 of them
}


/*
============================================================
Rule 7: SafePay Simulation Log Content
MITRE ATT&CK: T1486 (Multiple)
Confidence: High
Description: Detects SafePay simulation log file content
============================================================
*/

rule SafePay_Simulation_Log
{
    meta:
        description = "Detects SafePay ransomware simulation log content"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1486"
        confidence = "high"
        threat_type = "ransomware-artifact"
        severity = 5

    strings:
        // Log file markers
        $log1 = "SafePay Go-Native Ransomware Simulation" ascii wide
        $log2 = "[PHASE]" ascii
        $log3 = "DIRECTORY STRUCTURE CREATION" ascii
        $log4 = "FILE GENERATION" ascii
        $log5 = "MULTI-PHASE COMPRESSION" ascii
        $log6 = "SELECTIVE MASS DELETION" ascii
        $log7 = "FILE ENCRYPTION" ascii
        $log8 = "RANSOM NOTE CREATION" ascii
        $log9 = "C2 COMMUNICATION SIMULATION" ascii

        // Statistics markers
        $stat1 = "Files Created:" ascii
        $stat2 = "Files Deleted:" ascii
        $stat3 = "Files Encrypted" ascii
        $stat4 = "Archive Files Created:" ascii

        // Phase markers
        $phase1 = "STARTED" ascii
        $phase2 = "COMPLETED" ascii

    condition:
        $log1 or
        (3 of ($log*) and 2 of ($stat*)) or
        (4 of ($log*) and $phase1 and $phase2)
}


/*
============================================================
Rule 8: Corporate Document Staging Content
MITRE ATT&CK: T1005 (Data from Local System)
Confidence: Medium
Description: Detects staged corporate document content patterns
============================================================
*/

rule SafePay_Corporate_Document_Staging
{
    meta:
        description = "Detects SafePay staged corporate document content"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1005"
        confidence = "medium"
        threat_type = "data-collection"
        severity = 4

    strings:
        // Finance department content
        $finance1 = "FINANCIAL REPORT - CONFIDENTIAL" ascii wide
        $finance2 = "REVENUE ANALYSIS" ascii wide
        $finance3 = "EXPENSE BREAKDOWN" ascii wide
        $finance4 = "NET PROFIT MARGIN" ascii wide

        // HR department content
        $hr1 = "HUMAN RESOURCES DATABASE - RESTRICTED ACCESS" ascii wide
        $hr2 = "EMPLOYEE RECORDS SUMMARY" ascii wide
        $hr3 = "SALARY INFORMATION" ascii wide
        $hr4 = "SENSITIVE HR DATA" ascii wide

        // Legal department content
        $legal1 = "LEGAL DEPARTMENT - ATTORNEY-CLIENT PRIVILEGE" ascii wide
        $legal2 = "ACTIVE LITIGATION SUMMARY" ascii wide
        $legal3 = "INTELLECTUAL PROPERTY PORTFOLIO" ascii wide

        // IT department content (credentials - simulated)
        $it1 = "IT SYSTEMS ADMINISTRATION" ascii wide
        $it2 = "CRITICAL SYSTEM CREDENTIALS" ascii wide
        $it3 = "Domain Admin:" ascii wide
        $it4 = "DATABASE SERVERS:" ascii wide

        // Executive content
        $exec1 = "EXECUTIVE BOARD MATERIALS - BOARD EYES ONLY" ascii wide
        $exec2 = "STRATEGIC INITIATIVES" ascii wide
        $exec3 = "EXECUTIVE COMPENSATION" ascii wide
        $exec4 = "MATERIAL NON-PUBLIC INFORMATION" ascii wide

    condition:
        filesize < 100KB and
        (
            3 of ($finance*) or
            3 of ($hr*) or
            2 of ($legal*) or
            3 of ($it*) or
            3 of ($exec*)
        )
}


/*
============================================================
Rule 9: PowerShell Disk Space Enumeration
MITRE ATT&CK: T1082 (System Information Discovery)
Confidence: Medium
Description: Detects PowerShell command for disk space check
============================================================
*/

rule SafePay_DiskSpace_Enumeration
{
    meta:
        description = "Detects disk space enumeration pattern used by SafePay"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1082"
        confidence = "medium"
        threat_type = "discovery"
        severity = 3

    strings:
        // PowerShell disk space check commands
        $ps1 = "Get-WmiObject" ascii wide nocase
        $ps2 = "Win32_LogicalDisk" ascii wide nocase
        $ps3 = "FreeSpace" ascii wide nocase
        $ps4 = "DeviceID='C:'" ascii wide nocase

        // Combined pattern
        $combined = "Get-WmiObject -Class Win32_LogicalDisk" ascii wide nocase

    condition:
        $combined or
        (3 of ($ps*))
}


/*
============================================================
Rule 10: SafePay Full Artifact Collection
MITRE ATT&CK: T1486 (Multiple techniques)
Confidence: Critical
Description: Comprehensive rule matching multiple SafePay indicators
============================================================
*/

rule SafePay_Full_Attack_Chain
{
    meta:
        description = "Detects multiple SafePay ransomware indicators (full attack chain)"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "6717c98c-b3db-490e-b03c-7b3bd3fb02ee"
        mitre_attack = "T1486,T1560.001,T1490,T1083,T1005"
        confidence = "critical"
        threat_type = "ransomware"
        severity = 10

    strings:
        // Primary indicators
        $pri1 = ".safepay" ascii wide
        $pri2 = "readme_safepay" ascii wide
        $pri3 = "SAFEPAY RANSOMWARE" ascii wide

        // Secondary indicators
        $sec1 = "EXFIL_Master" ascii wide
        $sec2 = "safepay_simulation" ascii wide
        $sec3 = "executeGoNativeRansomwareSimulation" ascii
        $sec4 = "fortika-test" ascii wide

        // Behavioral strings
        $beh1 = "All your files have been encrypted" ascii wide
        $beh2 = "Files Encrypted" ascii wide
        $beh3 = "selective deletion" ascii wide nocase
        $beh4 = "Archive" ascii wide

    condition:
        (
            2 of ($pri*) or
            (1 of ($pri*) and 2 of ($sec*)) or
            (1 of ($pri*) and 2 of ($beh*)) or
            (3 of ($sec*))
        )
}
