/*
============================================================================
DEFENSE GUIDANCE: YARA Detection Rules
============================================================================
Test ID: 09efee46-f098-4948-8e35-dded024cd1e7
Test Name: Sliver C2 Client Detection
MITRE ATT&CK: T1219 - Remote Access Software
Created: 2025-12-07
Author: F0RT1KA Defense Guidance Builder
============================================================================

TECHNIQUE-FOCUSED DETECTION PRINCIPLE:
These YARA rules detect Sliver C2 framework and similar remote access tools,
NOT the F0RT1KA testing framework specifically. They will catch real-world
attackers deploying Sliver or similar C2 frameworks.

============================================================================
*/


// ============================================================================
// RULE 1: Generic Sliver C2 Client Detection
// Detects Sliver C2 implants based on common strings and patterns
// ============================================================================

rule Sliver_C2_Client_Generic
{
    meta:
        description = "Detects Sliver C2 framework client/implant binaries"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "high"
        severity = "critical"
        reference = "https://github.com/BishopFox/sliver"

    strings:
        // Sliver-specific strings
        $sliver1 = "sliver" ascii wide nocase
        $sliver2 = "SliverClient" ascii wide
        $sliver3 = "SliverServer" ascii wide
        $sliver4 = "sliver-client" ascii wide
        $sliver5 = "BishopFox" ascii wide

        // Sliver command strings
        $cmd1 = "generate" ascii wide
        $cmd2 = "implants" ascii wide
        $cmd3 = "sessions" ascii wide
        $cmd4 = "beacons" ascii wide
        $cmd5 = "operators" ascii wide

        // Sliver transport-related strings
        $transport1 = "--mtls" ascii wide
        $transport2 = "--wg" ascii wide
        $transport3 = "--http" ascii wide
        $transport4 = "--https" ascii wide
        $transport5 = "--dns" ascii wide
        $transport6 = "--named-pipe" ascii wide

        // Sliver beacon configuration
        $beacon1 = "BeaconInterval" ascii wide
        $beacon2 = "BeaconJitter" ascii wide
        $beacon3 = "BeaconCallback" ascii wide

        // Go build artifacts often present in Sliver
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii

    condition:
        uint16(0) == 0x5A4D and  // PE file
        filesize < 100MB and
        (
            // Direct Sliver identification
            (2 of ($sliver*)) or
            // Sliver transport arguments
            (3 of ($transport*)) or
            // Sliver commands with Go indicators
            (2 of ($cmd*) and 2 of ($go*)) or
            // Beacon configuration strings
            (2 of ($beacon*))
        )
}


// ============================================================================
// RULE 2: Sliver Implant String Patterns
// Detects Sliver implants based on embedded string patterns
// ============================================================================

rule Sliver_Implant_Strings
{
    meta:
        description = "Detects Sliver C2 implant based on unique string patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "high"
        severity = "critical"

    strings:
        // Sliver protobuf messages
        $proto1 = "sliverpb" ascii
        $proto2 = "clientpb" ascii
        $proto3 = "commonpb" ascii

        // Sliver networking
        $net1 = "StartMTLSListener" ascii
        $net2 = "StartHTTPListener" ascii
        $net3 = "StartHTTPSListener" ascii
        $net4 = "StartDNSListener" ascii
        $net5 = "StartWGListener" ascii
        $net6 = "WireGuardConfig" ascii

        // Sliver implant functions
        $impl1 = "SpawnDll" ascii wide
        $impl2 = "ExecuteAssembly" ascii wide
        $impl3 = "MigrateProcess" ascii wide
        $impl4 = "ProcessDump" ascii wide
        $impl5 = "Screenshot" ascii wide
        $impl6 = "Keylogger" ascii wide

        // Sliver staging
        $stage1 = "ImplantConfig" ascii
        $stage2 = "ImplantBuild" ascii
        $stage3 = "SliverImplant" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Protobuf message definitions
            (2 of ($proto*)) or
            // Network listener functions
            (2 of ($net*)) or
            // Implant functionality
            (3 of ($impl*)) or
            // Staging artifacts
            (2 of ($stage*))
        )
}


// ============================================================================
// RULE 3: Go-Compiled C2 Framework Detection
// Detects Go-compiled binaries with C2 framework characteristics
// ============================================================================

rule Go_C2_Framework_Generic
{
    meta:
        description = "Detects Go-compiled binaries with C2 framework characteristics"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "medium"
        severity = "high"

    strings:
        // Go runtime markers
        $go1 = "runtime.gopanic" ascii
        $go2 = "runtime.goexit" ascii
        $go3 = "go.buildid" ascii
        $go4 = "runtime.mstart" ascii

        // Go standard library paths
        $golib1 = "golang.org/x/sys/windows" ascii
        $golib2 = "golang.org/x/net" ascii
        $golib3 = "golang.org/x/crypto" ascii

        // C2-related function patterns
        $c2func1 = "Beacon" ascii wide
        $c2func2 = "Implant" ascii wide
        $c2func3 = "Payload" ascii wide
        $c2func4 = "Stager" ascii wide
        $c2func5 = "Shellcode" ascii wide
        $c2func6 = "Inject" ascii wide

        // Network-related patterns
        $net1 = "Connect" ascii
        $net2 = "Dial" ascii
        $net3 = "Listen" ascii
        $net4 = "HTTPClient" ascii

        // Encryption patterns common in C2
        $crypto1 = "AES" ascii
        $crypto2 = "ChaCha" ascii
        $crypto3 = "XOR" ascii
        $crypto4 = "Base64" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Go binary with C2 functions
            (2 of ($go*) and 2 of ($c2func*)) or
            // Go binary with network + crypto
            (2 of ($go*) and 2 of ($net*) and 2 of ($crypto*)) or
            // Go libraries with C2 functions
            (2 of ($golib*) and 2 of ($c2func*))
        )
}


// ============================================================================
// RULE 4: C2 Framework Network Communication Strings
// Detects binaries with common C2 network communication patterns
// ============================================================================

rule C2_Framework_Network_Strings
{
    meta:
        description = "Detects binaries with common C2 network communication strings"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "medium"
        severity = "high"

    strings:
        // HTTP C2 patterns
        $http1 = "User-Agent:" ascii wide
        $http2 = "Content-Type: application/octet-stream" ascii wide
        $http3 = "X-Session-Token" ascii wide
        $http4 = "X-Request-Id" ascii wide

        // Common C2 endpoints
        $endpoint1 = "/api/v1/" ascii wide
        $endpoint2 = "/beacon" ascii wide
        $endpoint3 = "/implant" ascii wide
        $endpoint4 = "/upload" ascii wide
        $endpoint5 = "/download" ascii wide
        $endpoint6 = "/register" ascii wide
        $endpoint7 = "/checkin" ascii wide
        $endpoint8 = "/task" ascii wide

        // TLS/SSL patterns
        $tls1 = "TLSNextProto" ascii
        $tls2 = "InsecureSkipVerify" ascii
        $tls3 = "ClientCertificate" ascii

        // DNS C2 patterns
        $dns1 = "TXT record" ascii wide nocase
        $dns2 = "CNAME" ascii wide
        $dns3 = "A record" ascii wide nocase

        // WireGuard patterns
        $wg1 = "WireGuard" ascii wide
        $wg2 = "wg0" ascii
        $wg3 = "AllowedIPs" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // HTTP C2 indicators
            (2 of ($http*) and 3 of ($endpoint*)) or
            // TLS indicators with endpoints
            (2 of ($tls*) and 2 of ($endpoint*)) or
            // DNS tunneling indicators
            (2 of ($dns*) and 2 of ($endpoint*)) or
            // WireGuard C2
            (2 of ($wg*))
        )
}


// ============================================================================
// RULE 5: Sliver PDB and Build Artifacts
// Detects Sliver binaries based on build artifacts and PDB paths
// ============================================================================

rule Sliver_PDB_Artifact
{
    meta:
        description = "Detects Sliver C2 based on PDB paths and build artifacts"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "high"
        severity = "critical"

    strings:
        // Sliver PDB and source paths
        $pdb1 = "sliver.pdb" ascii nocase
        $pdb2 = "sliver-client.pdb" ascii nocase
        $pdb3 = "implant.pdb" ascii nocase

        // Sliver source code paths
        $src1 = "/sliver/" ascii
        $src2 = "\\sliver\\" ascii
        $src3 = "/implant/" ascii
        $src4 = "BishopFox/sliver" ascii

        // Sliver module paths
        $mod1 = "github.com/bishopfox/sliver" ascii nocase
        $mod2 = "sliver/implant" ascii
        $mod3 = "sliver/protobuf" ascii
        $mod4 = "sliver/server" ascii

        // Build configuration artifacts
        $build1 = "SLIVER_BUILD" ascii
        $build2 = "IMPLANT_BUILD_ID" ascii
        $build3 = "CONFIG_HASH" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            any of ($pdb*) or
            (2 of ($src*)) or
            any of ($mod*) or
            (2 of ($build*))
        )
}


// ============================================================================
// RULE 6: Sliver Shellcode and Injection Patterns
// Detects Sliver shellcode injection capabilities
// ============================================================================

rule Sliver_Shellcode_Injection
{
    meta:
        description = "Detects Sliver shellcode and process injection patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "medium"
        severity = "high"

    strings:
        // Windows API injection functions
        $api1 = "VirtualAllocEx" ascii wide
        $api2 = "WriteProcessMemory" ascii wide
        $api3 = "CreateRemoteThread" ascii wide
        $api4 = "NtCreateThreadEx" ascii wide
        $api5 = "RtlCreateUserThread" ascii wide
        $api6 = "QueueUserAPC" ascii wide

        // Shellcode markers
        $shell1 = { FC 48 83 E4 F0 }  // x64 shellcode prologue
        $shell2 = { 60 89 E5 31 C0 }  // x86 shellcode prologue
        $shell3 = "donut" ascii nocase  // Donut shellcode generator

        // Injection technique strings
        $inject1 = "ProcessInjection" ascii wide
        $inject2 = "InjectDll" ascii wide
        $inject3 = "RemoteThread" ascii wide
        $inject4 = "APCInjection" ascii wide
        $inject5 = "ProcessHollowing" ascii wide

        // Sliver-specific injection
        $sliver_inject1 = "SpawnDll" ascii
        $sliver_inject2 = "MigrateProcess" ascii
        $sliver_inject3 = "ExecuteAssembly" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // API calls with injection technique strings
            (3 of ($api*) and 2 of ($inject*)) or
            // Shellcode markers with injection
            (any of ($shell*) and 2 of ($api*)) or
            // Sliver-specific injection
            (2 of ($sliver_inject*))
        )
}


// ============================================================================
// RULE 7: Sliver Persistence Mechanisms
// Detects Sliver persistence-related patterns
// ============================================================================

rule Sliver_Persistence_Patterns
{
    meta:
        description = "Detects Sliver C2 persistence mechanism patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "medium"
        severity = "high"

    strings:
        // Registry persistence paths
        $reg1 = "Software\\Microsoft\\Windows\\CurrentVersion\\Run" ascii wide nocase
        $reg2 = "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce" ascii wide nocase
        $reg3 = "HKLM\\SYSTEM\\CurrentControlSet\\Services" ascii wide nocase

        // Service creation
        $svc1 = "CreateServiceW" ascii
        $svc2 = "CreateServiceA" ascii
        $svc3 = "StartService" ascii
        $svc4 = "sc.exe" ascii wide

        // Scheduled task
        $task1 = "schtasks" ascii wide nocase
        $task2 = "TaskScheduler" ascii wide
        $task3 = "ITaskService" ascii wide

        // Sliver persistence functions
        $sliver_persist1 = "BackdoorService" ascii
        $sliver_persist2 = "PersistTask" ascii
        $sliver_persist3 = "InstallPersistence" ascii

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Registry persistence with service
            (2 of ($reg*) and 2 of ($svc*)) or
            // Scheduled task patterns
            (2 of ($task*)) or
            // Sliver persistence
            any of ($sliver_persist*)
        )
}


// ============================================================================
// RULE 8: Generic Remote Access Tool Detection
// Detects generic remote access tool patterns
// ============================================================================

rule Generic_RAT_Detection
{
    meta:
        description = "Detects generic Remote Access Tool (RAT) patterns"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "medium"
        severity = "high"

    strings:
        // RAT command patterns
        $rat1 = "getinfo" ascii wide nocase
        $rat2 = "getuid" ascii wide nocase
        $rat3 = "getsystem" ascii wide nocase
        $rat4 = "upload" ascii wide nocase
        $rat5 = "download" ascii wide nocase
        $rat6 = "shell" ascii wide nocase
        $rat7 = "execute" ascii wide nocase
        $rat8 = "screenshot" ascii wide nocase
        $rat9 = "keylogger" ascii wide nocase
        $rat10 = "webcam" ascii wide nocase

        // C2 communication patterns
        $c2comm1 = "heartbeat" ascii wide nocase
        $c2comm2 = "checkin" ascii wide nocase
        $c2comm3 = "callback" ascii wide nocase
        $c2comm4 = "register" ascii wide nocase
        $c2comm5 = "tasking" ascii wide nocase

        // Evasion techniques
        $evasion1 = "antidebug" ascii wide nocase
        $evasion2 = "antivm" ascii wide nocase
        $evasion3 = "sandbox" ascii wide nocase
        $evasion4 = "evasion" ascii wide nocase

    condition:
        uint16(0) == 0x5A4D and
        filesize < 50MB and
        (
            // RAT commands with C2 communication
            (4 of ($rat*) and 2 of ($c2comm*)) or
            // Evasion with RAT commands
            (2 of ($evasion*) and 3 of ($rat*))
        )
}


// ============================================================================
// RULE 9: Suspicious Help Flag Binary
// Detects binaries that respond to --help with C2 characteristics
// Used specifically for this test scenario
// ============================================================================

rule Suspicious_Help_Flag_Binary
{
    meta:
        description = "Detects suspicious binaries with help flag that may be C2 tools"
        author = "F0RT1KA Defense Guidance Builder"
        date = "2025-12-07"
        test_id = "09efee46-f098-4948-8e35-dded024cd1e7"
        mitre_attack = "T1219"
        confidence = "medium"
        severity = "medium"

    strings:
        // Help/usage patterns
        $help1 = "--help" ascii wide
        $help2 = "-h" ascii wide
        $help3 = "Usage:" ascii wide
        $help4 = "Options:" ascii wide

        // Suspicious option names
        $opt1 = "--beacon" ascii wide
        $opt2 = "--implant" ascii wide
        $opt3 = "--c2" ascii wide
        $opt4 = "--lhost" ascii wide
        $opt5 = "--lport" ascii wide
        $opt6 = "--payload" ascii wide
        $opt7 = "--generate" ascii wide
        $opt8 = "--operator" ascii wide

        // Network configuration
        $net1 = "--mtls" ascii wide
        $net2 = "--http" ascii wide
        $net3 = "--dns" ascii wide
        $net4 = "--wg" ascii wide

    condition:
        uint16(0) == 0x5A4D and
        filesize < 100MB and
        (
            // Help flags with suspicious options
            (2 of ($help*) and 3 of ($opt*)) or
            // Help flags with network config
            (2 of ($help*) and 2 of ($net*))
        )
}
