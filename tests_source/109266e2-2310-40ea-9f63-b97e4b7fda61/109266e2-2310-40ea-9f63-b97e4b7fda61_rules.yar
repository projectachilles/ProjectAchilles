/*
============================================================================
DEFENSE GUIDANCE: YARA Detection Rules
============================================================================
Test ID: 109266e2-2310-40ea-9f63-b97e4b7fda61
Test Name: SafePay Enhanced Ransomware Simulation & Mass Data Operations
MITRE ATT&CK: T1486, T1560.001, T1071.001, T1490, T1083, T1005
Created: 2025-12-07
Author: F0RT1KA Defense Guidance Builder
============================================================================

TECHNIQUE-FOCUSED DETECTION PRINCIPLE:
These YARA rules detect real-world ransomware behaviors including:
- SafePay ransomware PowerShell scripts
- Ransom note content patterns
- Mass file encryption tools
- Data staging/exfiltration scripts
- Corporate data collection patterns

============================================================================
*/


// ============================================================================
// RULE 1: SafePay Ransomware PowerShell Script Detection
// Detects the SafePay ransomware simulation PowerShell script
// ============================================================================

rule SafePay_Ransomware_Script
{
    meta:
        description = "Detects SafePay ransomware simulation PowerShell script"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1486, T1059.001"
        confidence = "high"
        severity = "critical"
        reference = "https://attack.mitre.org/techniques/T1486/"

    strings:
        // Script identification strings
        $script1 = "SafePay Ransomware Simulation" ascii wide nocase
        $script2 = "safepay_ransomware_sim" ascii wide nocase
        $script3 = "safepay_simulation" ascii wide nocase

        // Function names specific to the script
        $func1 = "New-CorporateFileTree" ascii wide
        $func2 = "New-RealisticCorporateFiles" ascii wide
        $func3 = "Invoke-MultiPhaseCompression" ascii wide
        $func4 = "Remove-OriginalFiles" ascii wide
        $func5 = "Get-RealisticContent" ascii wide
        $func6 = "Write-SimulationLog" ascii wide

        // Ransomware behavior indicators
        $behavior1 = ".safepay" ascii wide
        $behavior2 = "readme_safepay" ascii wide
        $behavior3 = "EXFIL_Master" ascii wide
        $behavior4 = "DeletionPercentage" ascii wide
        $behavior5 = "EncryptedFiles" ascii wide

        // Status tracking
        $status1 = "FILES_CREATED" ascii wide
        $status2 = "COMPRESSION_DONE" ascii wide
        $status3 = "RANSOM_NOTE_CREATED" ascii wide
        $status4 = "COMPLETED:" ascii wide

    condition:
        filesize < 200KB and
        (
            // Script identification + functions
            (any of ($script*) and 2 of ($func*)) or
            // Behavioral indicators
            (3 of ($behavior*)) or
            // Status tracking patterns
            (3 of ($status*) and any of ($behavior*))
        )
}


// ============================================================================
// RULE 2: SafePay Ransom Note Detection
// Detects SafePay ransomware ransom note content
// ============================================================================

rule SafePay_Ransom_Note
{
    meta:
        description = "Detects SafePay ransomware ransom note content"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1486"
        confidence = "high"
        severity = "critical"
        filetype = "text"

    strings:
        // Ransom note header
        $header1 = "SAFEPAY RANSOMWARE" ascii wide nocase
        $header2 = "All your files have been encrypted" ascii wide nocase

        // Payment instructions
        $payment1 = "0.5 Bitcoin" ascii wide nocase
        $payment2 = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" ascii wide  // Example BTC address
        $payment3 = "safepay@darkweb.onion" ascii wide nocase

        // Threat content
        $threat1 = "Your files will be permanently lost" ascii wide nocase
        $threat2 = "private decryption key" ascii wide nocase
        $threat3 = "military-grade encryption" ascii wide nocase
        $threat4 = "72 hours" ascii wide nocase

        // Instructions
        $instruct1 = "HOW TO RECOVER FILES" ascii wide nocase
        $instruct2 = "Do not try to decrypt" ascii wide nocase
        $instruct3 = "Computer ID:" ascii wide nocase

        // Generic ransomware indicators
        $generic1 = "Your important files are encrypted" ascii wide nocase
        $generic2 = "decryption service" ascii wide nocase

    condition:
        filesize < 50KB and
        (
            // SafePay specific
            ($header1 and any of ($payment*)) or
            // Generic ransom note with SafePay indicators
            ($header2 and 2 of ($threat*) and any of ($instruct*)) or
            // Payment + instructions pattern
            (2 of ($payment*) and 2 of ($instruct*))
        )
}


// ============================================================================
// RULE 3: Mass File Encryption Tool Detection
// Detects tools/scripts that perform mass file encryption
// ============================================================================

rule Mass_File_Encryption_Tool
{
    meta:
        description = "Detects tools performing mass file encryption operations"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1486"
        confidence = "high"
        severity = "critical"

    strings:
        // Encryption function patterns
        $enc1 = "ToBase64String" ascii wide
        $enc2 = "[Convert]::ToBase64String" ascii wide
        $enc3 = "System.Security.Cryptography" ascii wide
        $enc4 = "AesManaged" ascii wide
        $enc5 = "RijndaelManaged" ascii wide

        // File targeting patterns
        $target1 = ".docx" ascii wide
        $target2 = ".xlsx" ascii wide
        $target3 = ".pdf" ascii wide
        $target4 = ".sql" ascii wide
        $target5 = ".bak" ascii wide

        // Mass operation indicators
        $mass1 = "Get-ChildItem" ascii wide
        $mass2 = "-Recurse" ascii wide
        $mass3 = "foreach" ascii wide nocase
        $mass4 = "ForEach-Object" ascii wide

        // Ransomware extension patterns
        $ext1 = ".safepay" ascii wide
        $ext2 = ".encrypted" ascii wide
        $ext3 = ".locked" ascii wide
        $ext4 = ".crypted" ascii wide

        // Deletion after encryption
        $del1 = "Remove-Item" ascii wide
        $del2 = "-Force" ascii wide
        $del3 = "Delete original" ascii wide nocase

    condition:
        filesize < 500KB and
        (
            // Encryption + targeting + mass ops
            (any of ($enc*) and 3 of ($target*) and 2 of ($mass*)) or
            // Ransomware extension + deletion
            (any of ($ext*) and any of ($del*) and 2 of ($mass*)) or
            // Full ransomware pattern
            (any of ($enc*) and any of ($ext*) and any of ($del*))
        )
}


// ============================================================================
// RULE 4: WinRAR Data Staging Script Detection
// Detects scripts that use WinRAR for data staging/exfiltration
// ============================================================================

rule WinRAR_Data_Staging_Script
{
    meta:
        description = "Detects scripts using WinRAR for data staging and exfiltration"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1560.001"
        confidence = "high"
        severity = "high"

    strings:
        // WinRAR invocation
        $rar1 = "WinRAR.exe" ascii wide nocase
        $rar2 = "rar.exe" ascii wide nocase
        $rar3 = "Start-Process.*WinRAR" ascii wide nocase

        // Archive command patterns
        $cmd1 = "-r" ascii wide  // Recursive
        $cmd2 = "-m5" ascii wide  // Maximum compression
        $cmd3 = "-m0" ascii wide  // Store only
        $cmd4 = "-mt" ascii wide  // Multi-threaded
        $cmd5 = "-v100m" ascii wide  // Volume splitting
        $cmd6 = "-v500m" ascii wide
        $cmd7 = "-ep1" ascii wide  // Exclude base folder

        // Exfiltration indicators
        $exfil1 = "EXFIL" ascii wide nocase
        $exfil2 = "exfiltration" ascii wide nocase
        $exfil3 = "Master" ascii wide
        $exfil4 = "_Archive_" ascii wide

        // Multi-phase indicators
        $phase1 = "Phase 1" ascii wide nocase
        $phase2 = "Phase 2" ascii wide nocase
        $phase3 = "Phase 3" ascii wide nocase

        // Department targeting
        $dept1 = "Finance" ascii wide
        $dept2 = "HR" ascii wide
        $dept3 = "Legal" ascii wide
        $dept4 = "Executive" ascii wide

    condition:
        filesize < 500KB and
        (
            // WinRAR + archiving commands + exfiltration
            (any of ($rar*) and 2 of ($cmd*) and any of ($exfil*)) or
            // Multi-phase compression pattern
            (any of ($rar*) and 2 of ($phase*)) or
            // Department targeting with archive
            (any of ($rar*) and 3 of ($dept*))
        )
}


// ============================================================================
// RULE 5: Corporate Data Collection Script
// Detects scripts that create/collect corporate-like data
// ============================================================================

rule Corporate_Data_Collection_Script
{
    meta:
        description = "Detects scripts creating or collecting corporate-like data"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1005, T1083"
        confidence = "medium"
        severity = "medium"

    strings:
        // Corporate department names
        $dept1 = "Finance" ascii wide
        $dept2 = "HR" ascii wide
        $dept3 = "Legal" ascii wide
        $dept4 = "IT" ascii wide
        $dept5 = "Sales" ascii wide
        $dept6 = "Executive" ascii wide

        // Sensitive data indicators
        $data1 = "CONFIDENTIAL" ascii wide nocase
        $data2 = "RESTRICTED" ascii wide nocase
        $data3 = "Salary" ascii wide nocase
        $data4 = "SSN" ascii wide nocase
        $data5 = "Credentials" ascii wide nocase
        $data6 = "Password" ascii wide nocase

        // Directory creation patterns
        $dir1 = "New-Item.*Directory" ascii wide
        $dir2 = "mkdir" ascii wide nocase
        $dir3 = "Documents" ascii wide
        $dir4 = "Desktop" ascii wide

        // File generation patterns
        $gen1 = "Set-Content" ascii wide
        $gen2 = "Add-Content" ascii wide
        $gen3 = "Out-File" ascii wide

        // Corporate file naming
        $name1 = "_Report_" ascii wide
        $name2 = "_Contract_" ascii wide
        $name3 = "_Database_" ascii wide
        $name4 = "_Backup_" ascii wide

    condition:
        filesize < 500KB and
        (
            // Multiple departments + directory creation
            (4 of ($dept*) and any of ($dir*)) or
            // Sensitive data + file generation
            (3 of ($data*) and any of ($gen*)) or
            // Corporate naming + data indicators
            (2 of ($name*) and 2 of ($data*))
        )
}


// ============================================================================
// RULE 6: PowerShell Execution Bypass Script
// Detects PowerShell scripts with execution policy bypass
// ============================================================================

rule PowerShell_Execution_Bypass_Ransomware
{
    meta:
        description = "Detects PowerShell scripts with execution bypass and ransomware behaviors"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1059.001"
        confidence = "high"
        severity = "high"

    strings:
        // Execution policy bypass
        $bypass1 = "ExecutionPolicy Bypass" ascii wide nocase
        $bypass2 = "-ep bypass" ascii wide nocase
        $bypass3 = "-exec bypass" ascii wide nocase
        $bypass4 = "Set-ExecutionPolicy.*Bypass" ascii wide nocase

        // Admin check
        $admin1 = "WindowsBuiltInRole" ascii wide
        $admin2 = "Administrator" ascii wide
        $admin3 = "RunAsAdministrator" ascii wide

        // Ransomware indicators
        $ransom1 = "encrypt" ascii wide nocase
        $ransom2 = "ransom" ascii wide nocase
        $ransom3 = ".safepay" ascii wide
        $ransom4 = "readme_" ascii wide nocase

        // Mass file operations
        $mass1 = "Get-ChildItem.*-Recurse" ascii wide
        $mass2 = "Remove-Item.*-Force" ascii wide
        $mass3 = "foreach.*file" ascii wide nocase

    condition:
        filesize < 500KB and
        (
            // Bypass + admin + ransomware
            (any of ($bypass*) and any of ($admin*) and any of ($ransom*)) or
            // Bypass + mass file ops + ransomware
            (any of ($bypass*) and any of ($mass*) and any of ($ransom*))
        )
}


// ============================================================================
// RULE 7: Simulated Sensitive Data Content
// Detects files containing simulated sensitive corporate data
// ============================================================================

rule Simulated_Sensitive_Data
{
    meta:
        description = "Detects files containing simulated sensitive corporate data patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1005"
        confidence = "medium"
        severity = "low"
        filetype = "document"

    strings:
        // Financial data patterns
        $fin1 = "FINANCIAL REPORT - CONFIDENTIAL" ascii wide
        $fin2 = "REVENUE ANALYSIS" ascii wide
        $fin3 = "NET PROFIT MARGIN" ascii wide
        $fin4 = "EBITDA" ascii wide

        // HR data patterns
        $hr1 = "HUMAN RESOURCES DATABASE" ascii wide
        $hr2 = "SALARY INFORMATION" ascii wide
        $hr3 = "SSN Database Location" ascii wide
        $hr4 = "Background Check Results" ascii wide

        // IT credentials patterns
        $it1 = "CRITICAL SYSTEM CREDENTIALS" ascii wide
        $it2 = "Domain Admin:" ascii wide
        $it3 = "SQL Server SA:" ascii wide
        $it4 = "AWS Root:" ascii wide

        // Legal document patterns
        $legal1 = "ATTORNEY-CLIENT PRIVILEGE" ascii wide
        $legal2 = "ACTIVE LITIGATION" ascii wide
        $legal3 = "INTELLECTUAL PROPERTY" ascii wide

        // Executive data patterns
        $exec1 = "BOARD EYES ONLY" ascii wide
        $exec2 = "EXECUTIVE COMPENSATION" ascii wide
        $exec3 = "MATERIAL NON-PUBLIC INFORMATION" ascii wide

    condition:
        filesize < 100KB and
        (
            // Financial data
            (2 of ($fin*)) or
            // HR data
            (2 of ($hr*)) or
            // IT credentials
            (2 of ($it*)) or
            // Legal or executive
            (2 of ($legal*) or 2 of ($exec*))
        )
}


// ============================================================================
// RULE 8: SafePay Encrypted File Detection
// Detects files encrypted by SafePay ransomware
// ============================================================================

rule SafePay_Encrypted_File
{
    meta:
        description = "Detects files encrypted by SafePay ransomware (Base64 encoded)"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1486"
        confidence = "medium"
        severity = "high"
        filetype = "encrypted"

    strings:
        // Base64 character patterns (encrypted content)
        // Long sequences of Base64 characters indicate encoding
        $b64_pattern1 = /[A-Za-z0-9+\/]{100,}/ ascii
        $b64_pattern2 = /[A-Za-z0-9+\/]{50,}={1,2}/ ascii  // With padding

        // Lack of normal document markers
        $not_docx = { 50 4B 03 04 }  // ZIP/DOCX header
        $not_pdf = "%PDF" ascii
        $not_xlsx = "xl/" ascii

    condition:
        // File with .safepay extension check would be done at scanning time
        filesize < 50MB and
        filesize > 100 and
        any of ($b64_pattern*) and
        not any of ($not_*)
}


// ============================================================================
// RULE 9: Archive Creation for Exfiltration
// Detects RAR archives with exfiltration naming patterns
// ============================================================================

rule Exfiltration_Archive_Naming
{
    meta:
        description = "Detects RAR archives with suspicious exfiltration naming patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1560.001"
        confidence = "medium"
        severity = "high"

    strings:
        // RAR header
        $rar_header = { 52 61 72 21 1A 07 }  // Rar!

        // Suspicious naming within archive
        $name1 = "EXFIL" ascii wide nocase
        $name2 = "exfiltration" ascii wide nocase
        $name3 = "_Master_" ascii wide
        $name4 = "_Archive_" ascii wide
        $name5 = "_Data_" ascii wide

        // Department names in archive
        $dept1 = "Finance" ascii wide
        $dept2 = "HR" ascii wide
        $dept3 = "Legal" ascii wide
        $dept4 = "Executive" ascii wide

        // Date patterns in filename
        $date = /20[0-9]{2}[01][0-9][0-3][0-9]/ ascii

    condition:
        $rar_header at 0 and
        filesize < 500MB and
        (
            (any of ($name*) and $date) or
            (2 of ($dept*) and $date)
        )
}


// ============================================================================
// RULE 10: Go Binary with Embedded Ransomware Components
// Detects Go-compiled binaries with embedded ransomware scripts
// ============================================================================

rule Go_Ransomware_Dropper
{
    meta:
        description = "Detects Go-compiled binaries with embedded ransomware components"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "109266e2-2310-40ea-9f63-b97e4b7fda61"
        mitre_attack = "T1486, T1059.001"
        confidence = "high"
        severity = "critical"

    strings:
        // Go runtime markers
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii

        // Embedded script markers (go:embed)
        $embed1 = "safepay" ascii wide nocase
        $embed2 = "ransomware" ascii wide nocase
        $embed3 = ".ps1" ascii wide

        // WinRAR embedding
        $winrar1 = "WinRAR.exe" ascii wide
        $winrar2 = "Rar!" ascii  // RAR signature in embedded binary

        // Status file paths
        $status1 = "status.txt" ascii wide
        $status2 = "C:\\F0\\" ascii wide

        // Prelude library markers
        $prelude1 = "preludeorg" ascii
        $prelude2 = "Endpoint.Quarantined" ascii
        $prelude3 = "Endpoint.Stop" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 50MB and
        (
            // Go binary with ransomware strings
            (2 of ($go*) and 2 of ($embed*)) or
            // Go binary with WinRAR embedding
            (2 of ($go*) and any of ($winrar*) and any of ($status*)) or
            // F0RT1KA test binary
            (2 of ($go*) and any of ($prelude*) and any of ($embed*))
        )
}
