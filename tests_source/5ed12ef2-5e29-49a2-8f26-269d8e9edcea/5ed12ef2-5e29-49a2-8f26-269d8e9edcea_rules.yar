/*
    ============================================================
    F0RT1KA YARA Rules
    Multi-Stage Ransomware Killchain Simulation
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1204.002, T1134.001, T1083, T1486, T1491.001
    ============================================================
    Author: F0RT1KA Defense Guidance Builder
    Date: 2024-01-15
    ============================================================
*/


/*
    ============================================================
    Rule: F0RT1KA_Ransomware_Orchestrator
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1204.002, T1134.001, T1083, T1486, T1491.001
    Confidence: High
    Description: Detects F0RT1KA ransomware simulation main orchestrator binary
    ============================================================
*/

rule F0RT1KA_Ransomware_Orchestrator {
    meta:
        description = "Detects F0RT1KA Multi-Stage Ransomware Killchain orchestrator"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1204.002,T1134.001,T1083,T1486,T1491.001"
        confidence = "high"
        threat_type = "ransomware_simulation"

    strings:
        $uuid = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea" ascii wide
        $stage1 = "T1204.002.exe" ascii wide
        $stage2 = "T1134.001.exe" ascii wide
        $stage3 = "T1083.exe" ascii wide
        $stage4 = "T1486.exe" ascii wide
        $stage5 = "T1491.001.exe" ascii wide
        $technique1 = "User Execution - Malicious File" ascii wide
        $technique2 = "Access Token Manipulation" ascii wide
        $technique3 = "File and Directory Discovery" ascii wide
        $technique4 = "Data Encrypted for Impact" ascii wide
        $technique5 = "Defacement - Internal Defacement" ascii wide
        $f0rtika = "F0RT1KA" ascii wide nocase
        $killchain = "RANSOMWARE KILLCHAIN" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        ($uuid or $f0rtika) and
        (3 of ($stage*) or 3 of ($technique*) or $killchain)
}


/*
    ============================================================
    Rule: F0RT1KA_Ransomware_Stage_Binary
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: Various per stage
    Confidence: High
    Description: Detects individual F0RT1KA ransomware stage binaries
    ============================================================
*/

rule F0RT1KA_Ransomware_Stage_Binary {
    meta:
        description = "Detects F0RT1KA ransomware stage binaries"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1204.002,T1134.001,T1083,T1486,T1491.001"
        confidence = "high"

    strings:
        $uuid = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea" ascii wide
        $stage_marker1 = "Stage 1: T1204.002" ascii wide
        $stage_marker2 = "Stage 2: T1134.001" ascii wide
        $stage_marker3 = "Stage 3: T1083" ascii wide
        $stage_marker4 = "Stage 4: T1486" ascii wide
        $stage_marker5 = "Stage 5: T1491.001" ascii wide
        $attach_logger = "AttachLogger" ascii
        $append_log = "AppendToSharedLog" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 5MB and
        $uuid and
        (any of ($stage_marker*)) and
        ($attach_logger or $append_log)
}


/*
    ============================================================
    Rule: F0RT1KA_Ransom_Note_Text
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1491.001
    Confidence: High
    Description: Detects F0RT1KA ransom note content in files
    ============================================================
*/

rule F0RT1KA_Ransom_Note_Text {
    meta:
        description = "Detects F0RT1KA ransomware simulation ransom note content"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1491.001"
        confidence = "high"

    strings:
        $header = "YOUR FILES HAVE BEEN ENCRYPTED" ascii wide nocase
        $f0rtika_test = "F0RT1KA security test" ascii wide nocase
        $test_notice = "THIS IS A SECURITY TEST - NO ACTUAL HARM" ascii wide nocase
        $test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea" ascii wide
        $attack_chain = "T1204.002" ascii wide
        $extension = ".f0rtika" ascii wide
        $framework = "F0RT1KA SECURITY TESTING FRAMEWORK" ascii wide nocase

    condition:
        filesize < 50KB and
        $header and
        ($f0rtika_test or $test_notice or $test_id or $framework)
}


/*
    ============================================================
    Rule: F0RT1KA_Ransom_Note_HTML
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1491.001
    Confidence: High
    Description: Detects F0RT1KA HTML ransom note content
    ============================================================
*/

rule F0RT1KA_Ransom_Note_HTML {
    meta:
        description = "Detects F0RT1KA ransomware HTML ransom note"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1491.001"
        confidence = "high"

    strings:
        $html_header = "<title>RANSOMWARE SIMULATION" ascii wide nocase
        $f0rtika_test = "F0RT1KA TEST" ascii wide nocase
        $test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea" ascii wide
        $security_test = "THIS IS A SECURITY TEST" ascii wide nocase
        $css_animation = "@keyframes pulse" ascii
        $warning_class = "class=\"warning\"" ascii
        $test_notice_class = "class=\"test-notice\"" ascii

    condition:
        filesize < 50KB and
        ($html_header or $f0rtika_test) and
        ($test_id or $security_test) and
        any of ($css_animation, $warning_class, $test_notice_class)
}


/*
    ============================================================
    Rule: F0RT1KA_Encrypted_File_Marker
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1486
    Confidence: Medium
    Description: Detects files encrypted by F0RT1KA ransomware simulation
    ============================================================
*/

rule F0RT1KA_Encrypted_File_Marker {
    meta:
        description = "Detects files potentially encrypted by F0RT1KA simulation"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1486"
        confidence = "medium"
        note = "High entropy content with .f0rtika extension indicates encryption"

    strings:
        // AES-GCM encrypted files have high entropy
        // Looking for the nonce prefix pattern (12 bytes for GCM)
        // These patterns help identify encrypted data structure
        $not_plaintext1 = "DOCUMENT:" ascii
        $not_plaintext2 = "SPREADSHEET:" ascii
        $not_plaintext3 = "CODE:" ascii

    condition:
        // File should have high entropy (encrypted)
        // and NOT contain plaintext markers
        filesize > 50 and
        filesize < 10MB and
        not any of ($not_plaintext*)
        // Note: In production, combine with filename check for .f0rtika extension
}


/*
    ============================================================
    Rule: F0RT1KA_Ransomware_Component_Files
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1204.002
    Confidence: High
    Description: Detects F0RT1KA ransomware component marker files
    ============================================================
*/

rule F0RT1KA_Ransomware_Component_Files {
    meta:
        description = "Detects F0RT1KA ransomware component marker files"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1204.002"
        confidence = "high"

    strings:
        $crypto_engine = "RANSOMWARE_COMPONENT_crypto_engine" ascii
        $file_enum = "RANSOMWARE_COMPONENT_file_enum" ascii
        $ransom_core = "RANSOMWARE_COMPONENT_ransom_core" ascii

    condition:
        filesize < 1KB and
        any of them
}


/*
    ============================================================
    Rule: F0RT1KA_Master_Key_File
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1486
    Confidence: High
    Description: Detects F0RT1KA ransomware master key file
    ============================================================
*/

rule F0RT1KA_Master_Key_File {
    meta:
        description = "Detects F0RT1KA ransomware master key file"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1486"
        confidence = "high"

    strings:
        $key_marker = "RANSOMWARE_KEY:" ascii

    condition:
        filesize < 1KB and
        $key_marker
}


/*
    ============================================================
    Rule: F0RT1KA_Encryption_Summary
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1486
    Confidence: High
    Description: Detects F0RT1KA encryption summary file
    ============================================================
*/

rule F0RT1KA_Encryption_Summary {
    meta:
        description = "Detects F0RT1KA ransomware encryption summary file"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1486"
        confidence = "high"

    strings:
        $header = "RANSOMWARE SIMULATION - ENCRYPTION COMPLETE" ascii
        $files_encrypted = "Files Encrypted:" ascii
        $encryption_rate = "Encryption Rate:" ascii
        $extension = "Extension: .f0rtika" ascii

    condition:
        filesize < 5KB and
        $header and
        2 of ($files_encrypted, $encryption_rate, $extension)
}


/*
    ============================================================
    Rule: F0RT1KA_Target_List_File
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1083
    Confidence: High
    Description: Detects F0RT1KA file discovery target list
    ============================================================
*/

rule F0RT1KA_Target_List_File {
    meta:
        description = "Detects F0RT1KA ransomware target list file"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1083"
        confidence = "high"

    strings:
        $header = "RANSOMWARE_TARGETS" ascii
        $total = "Total:" ascii
        $priority = "Priority 1:" ascii

    condition:
        filesize < 10KB and
        $header and
        ($total or $priority)
}


/*
    ============================================================
    Rule: F0RT1KA_Recovery_Script
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: N/A (Recovery)
    Confidence: High
    Description: Detects F0RT1KA ransomware recovery script
    ============================================================
*/

rule F0RT1KA_Recovery_Script {
    meta:
        description = "Detects F0RT1KA ransomware recovery PowerShell script"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "N/A"
        confidence = "high"
        note = "This is a legitimate recovery script, not malicious"

    strings:
        $header = "F0RT1KA Ransomware Recovery" ascii wide nocase
        $test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea" ascii wide
        $cleanup1 = "Remove-Item" ascii wide
        $cleanup2 = "\\F0\\" ascii wide
        $f0rtika_ext = ".f0rtika" ascii wide
        $readme = "README_RANSOMWARE" ascii wide

    condition:
        filesize < 50KB and
        ($header or $test_id) and
        $cleanup1 and
        ($cleanup2 or $f0rtika_ext or $readme)
}


/*
    ============================================================
    Rule: F0RT1KA_Test_Execution_Log
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: N/A (Logging)
    Confidence: High
    Description: Detects F0RT1KA test execution log files
    ============================================================
*/

rule F0RT1KA_Test_Execution_Log {
    meta:
        description = "Detects F0RT1KA test execution log files"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "N/A"
        confidence = "high"
        note = "Informational - test logging artifact"

    strings:
        $test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea" ascii
        $test_name = "Multi-Stage Ransomware Killchain" ascii
        $json_start = "{\"test_id\":" ascii
        $stage_log = "\"stage_id\":" ascii
        $technique = "\"technique\":" ascii

    condition:
        filesize < 1MB and
        $test_id and
        ($test_name or $json_start) and
        ($stage_log or $technique)
}


/*
    ============================================================
    Rule: Generic_Ransomware_Token_Manipulation
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1134.001
    Confidence: Medium
    Description: Detects binaries with token manipulation patterns
    ============================================================
*/

rule Generic_Ransomware_Token_Manipulation {
    meta:
        description = "Detects potential token manipulation code patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1134.001"
        confidence = "medium"

    strings:
        $api1 = "OpenProcessToken" ascii wide
        $api2 = "AdjustTokenPrivileges" ascii wide
        $api3 = "DuplicateToken" ascii wide
        $api4 = "ImpersonateLoggedOnUser" ascii wide
        $api5 = "SetThreadToken" ascii wide
        $priv1 = "SeDebugPrivilege" ascii wide
        $priv2 = "SeBackupPrivilege" ascii wide
        $priv3 = "SeRestorePrivilege" ascii wide
        $priv4 = "SeTakeOwnershipPrivilege" ascii wide
        $target1 = "winlogon.exe" ascii wide nocase
        $target2 = "lsass.exe" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (2 of ($api*)) and
        (1 of ($priv*) or 1 of ($target*))
}


/*
    ============================================================
    Rule: Generic_Ransomware_File_Encryption
    Test ID: 5ed12ef2-5e29-49a2-8f26-269d8e9edcea
    MITRE ATT&CK: T1486
    Confidence: Medium
    Description: Detects binaries with file encryption patterns
    ============================================================
*/

rule Generic_Ransomware_File_Encryption {
    meta:
        description = "Detects potential ransomware file encryption patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2024-01-15"
        test_id = "5ed12ef2-5e29-49a2-8f26-269d8e9edcea"
        mitre_attack = "T1486"
        confidence = "medium"

    strings:
        // Crypto operations
        $crypto1 = "aes.NewCipher" ascii
        $crypto2 = "cipher.NewGCM" ascii
        $crypto3 = "gcm.Seal" ascii
        $crypto4 = "crypto/aes" ascii
        $crypto5 = "crypto/cipher" ascii

        // File operations
        $file1 = "ReadFile" ascii
        $file2 = "WriteFile" ascii
        $file3 = "DeleteFile" ascii

        // Extension patterns
        $ext1 = ".encrypted" ascii wide
        $ext2 = ".locked" ascii wide
        $ext3 = ".crypted" ascii wide
        $ext4 = ".f0rtika" ascii wide

        // Ransomware behavior
        $ransom1 = "MASTER_KEY" ascii wide
        $ransom2 = "encryption" ascii wide nocase
        $ransom3 = "decrypt" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (2 of ($crypto*)) and
        (2 of ($file*)) and
        (any of ($ext*) or any of ($ransom*))
}
