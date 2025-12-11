/*
    ============================================================================
    DEFENSE GUIDANCE: YARA Detection Rules
    ============================================================================
    Test ID: c1f0fe6f-6907-4f95-820d-47e0a39abe54
    Test Name: TrollDisappearKey AMSI Bypass Detection
    MITRE ATT&CK: T1562.001 - Impair Defenses: Disable or Modify Tools
    Created: 2025-12-07
    Author: F0RT1KA Defense Guidance Builder
    ============================================================================

    USAGE:
      File scanning:   yara -r c1f0fe6f-6907-4f95-820d-47e0a39abe54_rules.yar /path/to/scan
      Process memory:  yara -p <pid> c1f0fe6f-6907-4f95-820d-47e0a39abe54_rules.yar
      Validate rules:  yara -C c1f0fe6f-6907-4f95-820d-47e0a39abe54_rules.yar

    ============================================================================
*/


/*
    ============================================================================
    YARA Rule: TrollDisappearKey AMSI Bypass Tool
    Purpose: Detect TrollDisappearKey compiled .NET assembly
    Confidence: HIGH
    ============================================================================
*/

rule TrollDisappearKey_AMSI_Bypass
{
    meta:
        description = "Detects TrollDisappearKey AMSI bypass tool"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c1f0fe6f-6907-4f95-820d-47e0a39abe54"
        mitre_attack = "T1562.001"
        confidence = "high"
        reference = "https://github.com/cybersectroll/TrollDisappearKey"
        hash = ""

    strings:
        // Class and method names
        $class_name = "TrollDisappearKey" ascii wide nocase
        $method_disappear = "DisappearKey" ascii wide
        $method_detour = "RegOpenKeyWDetour" ascii wide

        // Registry key manipulation strings
        $reg_amsi_providers = "Software\\Microsoft\\AMSI\\Providers" ascii wide
        $reg_amsi_providers_space = "Software\\Microsoft\\AMSI\\Providers " ascii wide  // trailing space

        // API hooking indicators
        $api_regopenkey = "RegOpenKeyExW" ascii wide
        $api_kernelbase = "KERNELBASE.dll" ascii wide nocase
        $api_getmodulehandle = "GetModuleHandle" ascii wide
        $api_getprocaddress = "GetProcAddress" ascii wide
        $api_virtualprotect = "VirtualProtect" ascii wide

        // Hook installation byte pattern (mov rax, <addr>; push rax; ret)
        $hook_bytes = { 48 B8 ?? ?? ?? ?? ?? ?? ?? ?? 50 C3 }

        // .NET reflection strings
        $reflection_assembly = "Assembly.Load" ascii wide
        $reflection_entrypoint = "assembly.EntryPoint" ascii wide
        $webclient = "WebClient" ascii wide
        $downloaddata = "DownloadData" ascii wide

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 5MB and
        (
            // Primary indicators - class/method names
            (2 of ($class_name, $method_disappear, $method_detour)) or
            // AMSI registry manipulation with trailing space
            ($reg_amsi_providers and $reg_amsi_providers_space) or
            // API hooking pattern for RegOpenKeyExW
            (all of ($api_regopenkey, $api_kernelbase, $api_virtualprotect)) or
            // Combined hook installation with registry manipulation
            ($hook_bytes and $reg_amsi_providers)
        )
}


/*
    ============================================================================
    YARA Rule: Generic AMSI Bypass Tool Detection
    Purpose: Detect common AMSI bypass patterns across multiple tools
    Confidence: MEDIUM-HIGH
    ============================================================================
*/

rule Generic_AMSI_Bypass_Tool
{
    meta:
        description = "Detects generic AMSI bypass techniques"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c1f0fe6f-6907-4f95-820d-47e0a39abe54"
        mitre_attack = "T1562.001"
        confidence = "medium"

    strings:
        // AMSI DLL and function names
        $amsi_dll = "amsi.dll" ascii wide nocase
        $amsi_scan_buffer = "AmsiScanBuffer" ascii wide
        $amsi_scan_string = "AmsiScanString" ascii wide
        $amsi_initialize = "AmsiInitialize" ascii wide
        $amsi_context = "amsiContext" ascii wide nocase

        // AMSI bypass technique indicators
        $bypass_patch = { B8 57 00 07 80 }  // mov eax, 0x80070057 (return AMSI_RESULT_NOT_DETECTED)
        $bypass_nop = { 90 90 90 90 90 }     // NOP sled
        $bypass_ret = { C3 }                  // RET instruction

        // AMSI provider registry
        $reg_providers = "AMSI\\Providers" ascii wide nocase
        $reg_microsoft_amsi = "Microsoft\\AMSI" ascii wide nocase

        // Memory patching indicators
        $virtual_protect = "VirtualProtect" ascii wide
        $write_process_memory = "WriteProcessMemory" ascii wide
        $nt_protect_virtual = "NtProtectVirtualMemory" ascii wide

        // Common bypass technique strings
        $amsi_bypass_str = "AMSI bypass" ascii wide nocase
        $disable_amsi = "disable amsi" ascii wide nocase
        $amsi_patch = "AMSI patch" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (
            // Direct AMSI function targeting
            (any of ($amsi_scan_buffer, $amsi_scan_string, $amsi_initialize) and
             any of ($virtual_protect, $write_process_memory, $nt_protect_virtual)) or
            // AMSI provider registry manipulation
            (2 of ($reg_providers, $reg_microsoft_amsi, $amsi_context)) or
            // Memory patching patterns with AMSI references
            ($amsi_dll and ($bypass_patch or $bypass_nop)) or
            // Explicit bypass strings
            any of ($amsi_bypass_str, $disable_amsi, $amsi_patch)
        )
}


/*
    ============================================================================
    YARA Rule: Seatbelt Security Enumeration Tool
    Purpose: Detect GhostPack Seatbelt security enumeration tool
    Confidence: HIGH
    ============================================================================
*/

rule Seatbelt_Security_Enumeration
{
    meta:
        description = "Detects GhostPack Seatbelt security enumeration tool"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c1f0fe6f-6907-4f95-820d-47e0a39abe54"
        mitre_attack = "T1518.001"
        confidence = "high"
        reference = "https://github.com/GhostPack/Seatbelt"

    strings:
        // Seatbelt class and namespace
        $class_seatbelt = "Seatbelt" ascii wide
        $namespace_ghostpack = "GhostPack" ascii wide

        // Seatbelt command modules
        $cmd_amsiproviders = "AMSIProviders" ascii wide
        $cmd_antivirus = "AntiVirus" ascii wide
        $cmd_applocker = "AppLocker" ascii wide
        $cmd_auditpolicy = "AuditPolicyRegistry" ascii wide
        $cmd_autoruns = "AutoRuns" ascii wide
        $cmd_credenum = "CredEnum" ascii wide
        $cmd_dotnet = "DotNet" ascii wide
        $cmd_interestingfiles = "InterestingFiles" ascii wide
        $cmd_interestingprocesses = "InterestingProcesses" ascii wide
        $cmd_laps = "LAPS" ascii wide
        $cmd_localgroups = "LocalGroups" ascii wide
        $cmd_networkshares = "NetworkShares" ascii wide
        $cmd_osinfo = "OSInfo" ascii wide
        $cmd_powershell = "PowerShell" ascii wide
        $cmd_scheduledtasks = "ScheduledTasks" ascii wide
        $cmd_services = "Services" ascii wide
        $cmd_tokengroups = "TokenGroups" ascii wide
        $cmd_windowsdefender = "WindowsDefender" ascii wide
        $cmd_windowsfirewall = "WindowsFirewall" ascii wide

        // Seatbelt usage strings
        $usage_group = "-group=" ascii wide
        $usage_full = "-full" ascii wide
        $usage_outputfile = "-outputfile=" ascii wide

        // Version/banner indicators
        $banner = "Seatbelt" ascii wide nocase
        $version = "GhostPack" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 5MB and
        (
            // Namespace/class indicators
            (all of ($class_seatbelt, $namespace_ghostpack)) or
            // Multiple command module names
            (5 of ($cmd_*)) or
            // Usage patterns with banner
            ($banner and any of ($usage_*)) or
            // High concentration of command modules
            (8 of ($cmd_*))
        )
}


/*
    ============================================================================
    YARA Rule: .NET Assembly Remote Loading Pattern
    Purpose: Detect .NET assemblies with remote loading capabilities
    Confidence: MEDIUM
    ============================================================================
*/

rule DotNet_Remote_Assembly_Loader
{
    meta:
        description = "Detects .NET assemblies with remote loading capabilities"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c1f0fe6f-6907-4f95-820d-47e0a39abe54"
        mitre_attack = "T1105"
        confidence = "medium"

    strings:
        // .NET PE characteristics
        $dotnet_header = "_CorExeMain" ascii
        $dotnet_runtime = "mscoree.dll" ascii wide nocase

        // WebClient download methods
        $webclient_class = "System.Net.WebClient" ascii wide
        $downloaddata = "DownloadData" ascii wide
        $downloadstring = "DownloadString" ascii wide
        $downloadfile = "DownloadFile" ascii wide

        // HTTP client alternatives
        $httpclient = "System.Net.Http.HttpClient" ascii wide
        $getasync = "GetAsync" ascii wide
        $getbytearray = "GetByteArrayAsync" ascii wide

        // Assembly loading
        $assembly_load = "Assembly.Load" ascii wide
        $assembly_loadfrom = "Assembly.LoadFrom" ascii wide
        $reflection_assembly = "System.Reflection.Assembly" ascii wide
        $entrypoint = "EntryPoint" ascii wide
        $invoke = "Invoke" ascii wide

        // TLS/SSL settings
        $tls12 = "SecurityProtocolType.Tls12" ascii wide
        $service_point = "ServicePointManager" ascii wide

        // GitHub/remote sources
        $github = "github.com" ascii wide nocase
        $githubusercontent = "githubusercontent" ascii wide nocase
        $raw_github = "raw.github" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 5MB and
        (any of ($dotnet_header, $dotnet_runtime)) and
        (
            // WebClient with Assembly.Load
            (any of ($webclient_class, $downloaddata, $downloadstring) and
             any of ($assembly_load, $assembly_loadfrom, $reflection_assembly)) or
            // HTTP download with reflection
            (any of ($httpclient, $getasync, $getbytearray) and
             any of ($assembly_load, $entrypoint, $invoke)) or
            // GitHub download with assembly loading
            (any of ($github, $githubusercontent, $raw_github) and
             any of ($assembly_load, $reflection_assembly))
        )
}


/*
    ============================================================================
    YARA Rule: RegOpenKeyExW Hook Pattern
    Purpose: Detect API hooking on RegOpenKeyExW (TrollDisappearKey technique)
    Confidence: MEDIUM
    ============================================================================
*/

rule RegOpenKeyExW_Hook_Pattern
{
    meta:
        description = "Detects API hooking patterns targeting RegOpenKeyExW"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c1f0fe6f-6907-4f95-820d-47e0a39abe54"
        mitre_attack = "T1055"
        confidence = "medium"

    strings:
        // Target API and DLL
        $api_name = "RegOpenKeyExW" ascii wide
        $dll_name = "KERNELBASE.dll" ascii wide nocase

        // Alternative DLL targets
        $dll_advapi = "advapi32.dll" ascii wide nocase
        $dll_ntdll = "ntdll.dll" ascii wide nocase

        // Hook installation APIs
        $get_module = "GetModuleHandle" ascii wide
        $get_proc = "GetProcAddress" ascii wide
        $virtual_protect = "VirtualProtect" ascii wide
        $virtual_alloc = "VirtualAlloc" ascii wide

        // .NET interop for API hooking
        $dllimport = "DllImport" ascii wide
        $marshal = "System.Runtime.InteropServices.Marshal" ascii wide
        $marshal_copy = "Marshal.Copy" ascii wide
        $func_ptr = "GetFunctionPointerForDelegate" ascii wide

        // Hook trampoline patterns (x64)
        $hook_mov_rax = { 48 B8 }           // mov rax, imm64
        $hook_push_ret = { 50 C3 }           // push rax; ret
        $hook_jmp = { FF 25 }                // jmp [rip+offset]

        // Original bytes preservation
        $original_bytes = "originalBytes" ascii wide nocase
        $hook_bytes = "hookBytes" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (
            // API hooking infrastructure
            ($api_name and $dll_name and
             all of ($get_module, $get_proc, $virtual_protect)) or
            // .NET marshal-based hooking
            ($marshal_copy and $func_ptr and $api_name) or
            // Hook pattern with trampoline
            ($api_name and ($hook_mov_rax or $hook_jmp) and any of ($original_bytes, $hook_bytes)) or
            // Registry API with KERNELBASE hooking
            ($api_name and any of ($dll_name, $dll_advapi) and $virtual_protect)
        )
}


/*
    ============================================================================
    YARA Rule: SharpCollection Offensive Tools
    Purpose: Detect tools from the SharpCollection repository
    Confidence: MEDIUM-HIGH
    ============================================================================
*/

rule SharpCollection_Offensive_Tool
{
    meta:
        description = "Detects offensive tools from SharpCollection repository"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c1f0fe6f-6907-4f95-820d-47e0a39abe54"
        mitre_attack = "T1105"
        confidence = "medium"
        reference = "https://github.com/Flangvik/SharpCollection"

    strings:
        // SharpCollection indicators
        $sharp_collection = "SharpCollection" ascii wide nocase
        $flangvik = "Flangvik" ascii wide nocase

        // Common SharpCollection tools
        $rubeus = "Rubeus" ascii wide
        $seatbelt = "Seatbelt" ascii wide
        $sharpwmi = "SharpWMI" ascii wide
        $sharphound = "SharpHound" ascii wide
        $sharpup = "SharpUp" ascii wide
        $sharpdpapi = "SharpDPAPI" ascii wide
        $sharpchrome = "SharpChrome" ascii wide
        $sharpview = "SharpView" ascii wide
        $safetykatz = "SafetyKatz" ascii wide
        $inveigh = "Inveigh" ascii wide

        // GhostPack namespace
        $ghostpack = "GhostPack" ascii wide

        // Common offensive tool patterns
        $kerberoast = "kerberoast" ascii wide nocase
        $asreproast = "asreproast" ascii wide nocase
        $dcsync = "dcsync" ascii wide nocase
        $mimikatz = "mimikatz" ascii wide nocase
        $sekurlsa = "sekurlsa" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 10MB and
        (
            // Repository indicators
            any of ($sharp_collection, $flangvik, $ghostpack) or
            // Multiple tool names
            (2 of ($rubeus, $seatbelt, $sharpwmi, $sharphound, $sharpup, $sharpdpapi,
                   $sharpchrome, $sharpview, $safetykatz, $inveigh)) or
            // Offensive technique indicators
            (2 of ($kerberoast, $asreproast, $dcsync, $mimikatz, $sekurlsa))
        )
}


/*
    ============================================================================
    YARA Rule: F0RT1KA AMSI Test Artifact
    Purpose: Detect F0RT1KA test artifacts related to AMSI bypass testing
    Confidence: HIGH (for test framework identification)
    ============================================================================
*/

rule F0RT1KA_AMSI_Test_Artifact
{
    meta:
        description = "Detects F0RT1KA AMSI bypass test artifacts"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "c1f0fe6f-6907-4f95-820d-47e0a39abe54"
        mitre_attack = "T1562.001"
        confidence = "high"

    strings:
        // Test UUID
        $test_uuid = "c1f0fe6f-6907-4f95-820d-47e0a39abe54" ascii wide nocase

        // F0RT1KA framework indicators
        $f0rtika = "F0RT1KA" ascii wide nocase
        $f0_path = "c:\\F0\\" ascii wide nocase

        // Test binary indicators
        $troll_exe = "troll_disappear_key.exe" ascii wide nocase
        $test_name = "TrollDisappearKey AMSI Bypass" ascii wide nocase

        // Prelude library indicators
        $prelude = "preludeorg" ascii wide nocase
        $endpoint = "Endpoint.Stop" ascii wide
        $dropper = "Dropper.Dropper" ascii wide

        // Test logging
        $quarantined = "Quarantined" ascii wide
        $execution_prevented = "ExecutionPrevented" ascii wide
        $unprotected = "Unprotected" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        (
            // Direct test UUID match
            $test_uuid or
            // Test framework with AMSI indicators
            ($f0rtika and any of ($troll_exe, $test_name)) or
            // F0 path with test patterns
            ($f0_path and any of ($quarantined, $execution_prevented, $unprotected)) or
            // Prelude test framework
            (all of ($prelude, $endpoint, $dropper))
        )
}
