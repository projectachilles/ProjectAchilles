# ATT&CK Matrix Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MITRE ATT&CK card grid matrix with a bar chart + drill-down panel visualization focused on coverage gap assessment.

**Architecture:** Rewrite the single `MitreAttackMatrix.tsx` component, preserving its props interface and internal data computation. Add a static technique name lookup file. No backend changes, no parent component changes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-14-attack-matrix-redesign-design.md`

---

## Chunk 1: ATT&CK Matrix Bar Chart + Drill-Down

### Task 1: Create MITRE technique name lookup

**Files:**
- Create: `frontend/src/data/mitre-techniques.ts`

This is a static data file mapping ~400 MITRE ATT&CK Enterprise technique IDs to human-readable names.

- [ ] **Step 1: Create the technique name lookup file**

Create `frontend/src/data/mitre-techniques.ts`. This is a `Record<string, string>` export. The data comes from MITRE ATT&CK Enterprise v16 (public domain).

```typescript
/**
 * MITRE ATT&CK Enterprise technique ID → human-readable name mapping.
 * Source: MITRE ATT&CK v16 (October 2024). Public domain.
 *
 * Only includes techniques that appear in the Enterprise matrix.
 * Sub-techniques use dot notation (e.g., T1059.001 = PowerShell).
 */
export const TECHNIQUE_NAMES: Record<string, string> = {
  // Reconnaissance
  'T1595': 'Active Scanning',
  'T1595.001': 'Scanning IP Blocks',
  'T1595.002': 'Vulnerability Scanning',
  'T1595.003': 'Wordlist Scanning',
  'T1592': 'Gather Victim Host Information',
  'T1592.001': 'Hardware',
  'T1592.002': 'Software',
  'T1592.003': 'Firmware',
  'T1592.004': 'Client Configurations',
  'T1589': 'Gather Victim Identity Information',
  'T1589.001': 'Credentials',
  'T1589.002': 'Email Addresses',
  'T1589.003': 'Employee Names',
  'T1590': 'Gather Victim Network Information',
  'T1590.001': 'Domain Properties',
  'T1590.002': 'DNS',
  'T1590.003': 'Network Trust Dependencies',
  'T1590.004': 'Network Topology',
  'T1590.005': 'IP Addresses',
  'T1590.006': 'Network Security Appliances',
  'T1591': 'Gather Victim Org Information',
  'T1591.001': 'Determine Physical Locations',
  'T1591.002': 'Business Relationships',
  'T1591.003': 'Identify Business Tempo',
  'T1591.004': 'Identify Roles',
  'T1598': 'Phishing for Information',
  'T1598.001': 'Spearphishing Service',
  'T1598.002': 'Spearphishing Attachment',
  'T1598.003': 'Spearphishing Link',
  'T1597': 'Search Closed Sources',
  'T1597.001': 'Threat Intel Vendors',
  'T1597.002': 'Purchase Technical Data',
  'T1596': 'Search Open Technical Databases',
  'T1596.001': 'DNS/Passive DNS',
  'T1596.002': 'WHOIS',
  'T1596.003': 'Digital Certificates',
  'T1596.004': 'CDNs',
  'T1596.005': 'Scan Databases',
  'T1593': 'Search Open Websites/Domains',
  'T1593.001': 'Social Media',
  'T1593.002': 'Search Engines',
  'T1593.003': 'Code Repositories',
  'T1594': 'Search Victim-Owned Websites',

  // Resource Development
  'T1583': 'Acquire Infrastructure',
  'T1583.001': 'Domains',
  'T1583.002': 'DNS Server',
  'T1583.003': 'Virtual Private Server',
  'T1583.004': 'Server',
  'T1583.005': 'Botnet',
  'T1583.006': 'Web Services',
  'T1583.007': 'Serverless',
  'T1583.008': 'Malvertising',
  'T1586': 'Compromise Accounts',
  'T1586.001': 'Social Media Accounts',
  'T1586.002': 'Email Accounts',
  'T1586.003': 'Cloud Accounts',
  'T1584': 'Compromise Infrastructure',
  'T1584.001': 'Domains',
  'T1584.002': 'DNS Server',
  'T1584.003': 'Virtual Private Server',
  'T1584.004': 'Server',
  'T1584.005': 'Botnet',
  'T1584.006': 'Web Services',
  'T1584.007': 'Serverless',
  'T1587': 'Develop Capabilities',
  'T1587.001': 'Malware',
  'T1587.002': 'Code Signing Certificates',
  'T1587.003': 'Digital Certificates',
  'T1587.004': 'Exploits',
  'T1585': 'Establish Accounts',
  'T1585.001': 'Social Media Accounts',
  'T1585.002': 'Email Accounts',
  'T1585.003': 'Cloud Accounts',
  'T1588': 'Obtain Capabilities',
  'T1588.001': 'Malware',
  'T1588.002': 'Tool',
  'T1588.003': 'Code Signing Certificates',
  'T1588.004': 'Digital Certificates',
  'T1588.005': 'Exploits',
  'T1588.006': 'Vulnerabilities',
  'T1608': 'Stage Capabilities',
  'T1608.001': 'Upload Malware',
  'T1608.002': 'Upload Tool',
  'T1608.003': 'Install Digital Certificate',
  'T1608.004': 'Drive-by Target',
  'T1608.005': 'Link Target',
  'T1608.006': 'SEO Poisoning',

  // Initial Access
  'T1189': 'Drive-by Compromise',
  'T1190': 'Exploit Public-Facing Application',
  'T1133': 'External Remote Services',
  'T1200': 'Hardware Additions',
  'T1566': 'Phishing',
  'T1566.001': 'Spearphishing Attachment',
  'T1566.002': 'Spearphishing Link',
  'T1566.003': 'Spearphishing via Service',
  'T1566.004': 'Spearphishing Voice',
  'T1091': 'Replication Through Removable Media',
  'T1195': 'Supply Chain Compromise',
  'T1195.001': 'Compromise Software Dependencies and Development Tools',
  'T1195.002': 'Compromise Software Supply Chain',
  'T1195.003': 'Compromise Hardware Supply Chain',
  'T1199': 'Trusted Relationship',
  'T1078': 'Valid Accounts',
  'T1078.001': 'Default Accounts',
  'T1078.002': 'Domain Accounts',
  'T1078.003': 'Local Accounts',
  'T1078.004': 'Cloud Accounts',

  // Execution
  'T1059': 'Command and Scripting Interpreter',
  'T1059.001': 'PowerShell',
  'T1059.002': 'AppleScript',
  'T1059.003': 'Windows Command Shell',
  'T1059.004': 'Unix Shell',
  'T1059.005': 'Visual Basic',
  'T1059.006': 'Python',
  'T1059.007': 'JavaScript',
  'T1059.008': 'Network Device CLI',
  'T1059.009': 'Cloud API',
  'T1059.010': 'AutoHotKey & AutoIT',
  'T1609': 'Container Administration Command',
  'T1610': 'Deploy Container',
  'T1203': 'Exploitation for Client Execution',
  'T1559': 'Inter-Process Communication',
  'T1559.001': 'Component Object Model',
  'T1559.002': 'Dynamic Data Exchange',
  'T1559.003': 'XPC Services',
  'T1106': 'Native API',
  'T1053': 'Scheduled Task/Job',
  'T1053.002': 'At',
  'T1053.003': 'Cron',
  'T1053.005': 'Scheduled Task',
  'T1053.006': 'Systemd Timers',
  'T1053.007': 'Container Orchestration Job',
  'T1129': 'Shared Modules',
  'T1072': 'Software Deployment Tools',
  'T1569': 'System Services',
  'T1569.001': 'Launchctl',
  'T1569.002': 'Service Execution',
  'T1204': 'User Execution',
  'T1204.001': 'Malicious Link',
  'T1204.002': 'Malicious File',
  'T1204.003': 'Malicious Image',
  'T1047': 'Windows Management Instrumentation',

  // Persistence
  'T1098': 'Account Manipulation',
  'T1098.001': 'Additional Cloud Credentials',
  'T1098.002': 'Additional Email Delegate Permissions',
  'T1098.003': 'Additional Cloud Roles',
  'T1098.004': 'SSH Authorized Keys',
  'T1098.005': 'Device Registration',
  'T1098.006': 'Additional Container Cluster Roles',
  'T1197': 'BITS Jobs',
  'T1547': 'Boot or Logon Autostart Execution',
  'T1547.001': 'Registry Run Keys / Startup Folder',
  'T1547.002': 'Authentication Package',
  'T1547.003': 'Time Providers',
  'T1547.004': 'Winlogon Helper DLL',
  'T1547.005': 'Security Support Provider',
  'T1547.006': 'Kernel Modules and Extensions',
  'T1547.008': 'LSASS Driver',
  'T1547.009': 'Shortcut Modification',
  'T1547.010': 'Port Monitors',
  'T1547.012': 'Print Processors',
  'T1547.013': 'XDG Autostart Entries',
  'T1547.014': 'Active Setup',
  'T1547.015': 'Login Items',
  'T1037': 'Boot or Logon Initialization Scripts',
  'T1037.001': 'Logon Script (Windows)',
  'T1037.002': 'Login Hook',
  'T1037.003': 'Network Logon Script',
  'T1037.004': 'RC Scripts',
  'T1037.005': 'Startup Items',
  'T1176': 'Browser Extensions',
  'T1554': 'Compromise Host Software Binary',
  'T1136': 'Create Account',
  'T1136.001': 'Local Account',
  'T1136.002': 'Domain Account',
  'T1136.003': 'Cloud Account',
  'T1543': 'Create or Modify System Process',
  'T1543.001': 'Launch Agent',
  'T1543.002': 'Systemd Service',
  'T1543.003': 'Windows Service',
  'T1543.004': 'Launch Daemon',
  'T1546': 'Event Triggered Execution',
  'T1546.001': 'Change Default File Association',
  'T1546.002': 'Screensaver',
  'T1546.003': 'Windows Management Instrumentation Event Subscription',
  'T1546.004': 'Unix Shell Configuration Modification',
  'T1546.005': 'Trap',
  'T1546.008': 'Accessibility Features',
  'T1546.009': 'AppCert DLLs',
  'T1546.010': 'AppInit DLLs',
  'T1546.011': 'Application Shimming',
  'T1546.012': 'Image File Execution Options Injection',
  'T1546.013': 'PowerShell Profile',
  'T1546.014': 'Emond',
  'T1546.015': 'Component Object Model Hijacking',
  'T1546.016': 'Installer Packages',
  'T1133.001': 'External Remote Services',
  'T1574': 'Hijack Execution Flow',
  'T1574.001': 'DLL Search Order Hijacking',
  'T1574.002': 'DLL Side-Loading',
  'T1574.004': 'Dylib Hijacking',
  'T1574.005': 'Executable Installer File Permissions Weakness',
  'T1574.006': 'Dynamic Linker Hijacking',
  'T1574.007': 'Path Interception by PATH Environment Variable',
  'T1574.008': 'Path Interception by Search Order Hijacking',
  'T1574.009': 'Path Interception by Unquoted Path',
  'T1574.010': 'Services File Permissions Weakness',
  'T1574.011': 'Services Registry Permissions Weakness',
  'T1574.012': 'COR_PROFILER',
  'T1574.013': 'KernelCallbackTable',
  'T1525': 'Implant Internal Image',
  'T1556': 'Modify Authentication Process',
  'T1556.001': 'Domain Controller Authentication',
  'T1556.002': 'Password Filter DLL',
  'T1556.003': 'Pluggable Authentication Modules',
  'T1556.004': 'Network Device Authentication',
  'T1556.005': 'Reversible Encryption',
  'T1556.006': 'Multi-Factor Authentication',
  'T1556.007': 'Hybrid Identity',
  'T1556.008': 'Network Provider DLL',
  'T1137': 'Office Application Startup',
  'T1137.001': 'Office Template Macros',
  'T1137.002': 'Office Test',
  'T1137.003': 'Outlook Forms',
  'T1137.004': 'Outlook Home Page',
  'T1137.005': 'Outlook Rules',
  'T1137.006': 'Add-ins',
  'T1542': 'Pre-OS Boot',
  'T1542.001': 'System Firmware',
  'T1542.002': 'Component Firmware',
  'T1542.003': 'Bootkit',
  'T1542.005': 'TFTP Boot',
  'T1505': 'Server Software Component',
  'T1505.001': 'SQL Stored Procedures',
  'T1505.002': 'Transport Agent',
  'T1505.003': 'Web Shell',
  'T1505.004': 'IIS Components',
  'T1505.005': 'Terminal Services DLL',
  'T1205': 'Traffic Signaling',
  'T1205.001': 'Port Knocking',
  'T1205.002': 'Socket Filters',

  // Privilege Escalation (many shared with Persistence)
  'T1548': 'Abuse Elevation Control Mechanism',
  'T1548.001': 'Setuid and Setgid',
  'T1548.002': 'Bypass User Account Control',
  'T1548.003': 'Sudo and Sudo Caching',
  'T1548.004': 'Elevated Execution with Prompt',
  'T1548.005': 'Temporary Elevated Cloud Access',
  'T1134': 'Access Token Manipulation',
  'T1134.001': 'Token Impersonation/Theft',
  'T1134.002': 'Create Process with Token',
  'T1134.003': 'Make and Impersonate Token',
  'T1134.004': 'Parent PID Spoofing',
  'T1134.005': 'SID-History Injection',
  'T1068': 'Exploitation for Privilege Escalation',
  'T1055': 'Process Injection',
  'T1055.001': 'Dynamic-link Library Injection',
  'T1055.002': 'Portable Executable Injection',
  'T1055.003': 'Thread Execution Hijacking',
  'T1055.004': 'Asynchronous Procedure Call',
  'T1055.005': 'Thread Local Storage',
  'T1055.008': 'Ptrace System Calls',
  'T1055.009': 'Proc Memory',
  'T1055.011': 'Extra Window Memory Injection',
  'T1055.012': 'Process Hollowing',
  'T1055.013': 'Process Doppelganging',
  'T1055.014': 'VDSO Hijacking',
  'T1055.015': 'ListPlanting',

  // Defense Evasion
  'T1548.002': 'Bypass User Account Control',
  'T1140': 'Deobfuscate/Decode Files or Information',
  'T1006': 'Direct Volume Access',
  'T1480': 'Execution Guardrails',
  'T1480.001': 'Environmental Keying',
  'T1211': 'Exploitation for Defense Evasion',
  'T1222': 'File and Directory Permissions Modification',
  'T1222.001': 'Windows File and Directory Permissions Modification',
  'T1222.002': 'Linux and Mac File and Directory Permissions Modification',
  'T1564': 'Hide Artifacts',
  'T1564.001': 'Hidden Files and Directories',
  'T1564.002': 'Hidden Users',
  'T1564.003': 'Hidden Window',
  'T1564.004': 'NTFS File Attributes',
  'T1564.005': 'Hidden File System',
  'T1564.006': 'Run Virtual Instance',
  'T1564.007': 'VBA Stomping',
  'T1564.008': 'Email Hiding Rules',
  'T1564.009': 'Resource Forking',
  'T1564.010': 'Process Argument Spoofing',
  'T1564.011': 'Ignore Process Interrupts',
  'T1562': 'Impair Defenses',
  'T1562.001': 'Disable or Modify Tools',
  'T1562.002': 'Disable Windows Event Logging',
  'T1562.003': 'Impair Command History Logging',
  'T1562.004': 'Disable or Modify System Firewall',
  'T1562.006': 'Indicator Blocking',
  'T1562.007': 'Disable or Modify Cloud Firewall',
  'T1562.008': 'Disable or Modify Cloud Logs',
  'T1562.009': 'Safe Mode Boot',
  'T1562.010': 'Downgrade Attack',
  'T1562.011': 'Spoof Security Alerting',
  'T1562.012': 'Disable or Modify Linux Audit System',
  'T1070': 'Indicator Removal',
  'T1070.001': 'Clear Windows Event Logs',
  'T1070.002': 'Clear Linux or Mac System Logs',
  'T1070.003': 'Clear Command History',
  'T1070.004': 'File Deletion',
  'T1070.005': 'Network Share Connection Removal',
  'T1070.006': 'Timestomp',
  'T1070.009': 'Clear Persistence',
  'T1202': 'Indirect Command Execution',
  'T1036': 'Masquerading',
  'T1036.001': 'Invalid Code Signature',
  'T1036.003': 'Rename System Utilities',
  'T1036.004': 'Masquerade Task or Service',
  'T1036.005': 'Match Legitimate Name or Location',
  'T1036.006': 'Space after Filename',
  'T1036.007': 'Double File Extension',
  'T1036.008': 'Masquerade File Type',
  'T1036.009': 'Break Process Trees',
  'T1556': 'Modify Authentication Process',
  'T1578': 'Modify Cloud Compute Infrastructure',
  'T1578.001': 'Create Snapshot',
  'T1578.002': 'Create Cloud Instance',
  'T1578.003': 'Delete Cloud Instance',
  'T1578.004': 'Revert Cloud Instance',
  'T1578.005': 'Modify Cloud Compute Configurations',
  'T1112': 'Modify Registry',
  'T1601': 'Modify System Image',
  'T1601.001': 'Patch System Image',
  'T1601.002': 'Downgrade System Image',
  'T1599': 'Network Boundary Bridging',
  'T1599.001': 'Network Address Translation Traversal',
  'T1027': 'Obfuscated Files or Information',
  'T1027.001': 'Binary Padding',
  'T1027.002': 'Software Packing',
  'T1027.003': 'Steganography',
  'T1027.004': 'Compile After Delivery',
  'T1027.005': 'Indicator Removal from Tools',
  'T1027.006': 'HTML Smuggling',
  'T1027.007': 'Dynamic API Resolution',
  'T1027.008': 'Stripped Payloads',
  'T1027.009': 'Embedded Payloads',
  'T1027.010': 'Command Obfuscation',
  'T1027.011': 'Fileless Storage',
  'T1027.012': 'LNK Icon Smuggling',
  'T1027.013': 'Encrypted/Encoded File',
  'T1647': 'Plist File Modification',
  'T1542': 'Pre-OS Boot',
  'T1055': 'Process Injection',
  'T1620': 'Reflective Code Loading',
  'T1207': 'Rogue Domain Controller',
  'T1014': 'Rootkit',
  'T1218': 'System Binary Proxy Execution',
  'T1218.001': 'Compiled HTML File',
  'T1218.002': 'Control Panel',
  'T1218.003': 'CMSTP',
  'T1218.004': 'InstallUtil',
  'T1218.005': 'Mshta',
  'T1218.007': 'Msiexec',
  'T1218.008': 'Odbcconf',
  'T1218.009': 'Regsvcs/Regasm',
  'T1218.010': 'Regsvr32',
  'T1218.011': 'Rundll32',
  'T1218.012': 'Verclsid',
  'T1218.013': 'Mavinject',
  'T1218.014': 'MMC',
  'T1216': 'System Script Proxy Execution',
  'T1216.001': 'PubPrn',
  'T1553': 'Subvert Trust Controls',
  'T1553.001': 'Gatekeeper Bypass',
  'T1553.002': 'Code Signing',
  'T1553.003': 'SIP and Trust Provider Hijacking',
  'T1553.004': 'Install Root Certificate',
  'T1553.005': 'Mark-of-the-Web Bypass',
  'T1553.006': 'Code Signing Policy Modification',
  'T1221': 'Template Injection',
  'T1127': 'Trusted Developer Utilities Proxy Execution',
  'T1127.001': 'MSBuild',
  'T1535': 'Unused/Unsupported Cloud Regions',
  'T1550': 'Use Alternate Authentication Material',
  'T1550.001': 'Application Access Token',
  'T1550.002': 'Pass the Hash',
  'T1550.003': 'Pass the Ticket',
  'T1550.004': 'Web Session Cookie',
  'T1497': 'Virtualization/Sandbox Evasion',
  'T1497.001': 'System Checks',
  'T1497.002': 'User Activity Based Checks',
  'T1497.003': 'Time Based Evasion',
  'T1600': 'Weaken Encryption',
  'T1600.001': 'Reduce Key Space',
  'T1600.002': 'Disable Crypto Hardware',
  'T1220': 'XSL Script Processing',

  // Credential Access
  'T1557': 'Adversary-in-the-Middle',
  'T1557.001': 'LLMNR/NBT-NS Poisoning and SMB Relay',
  'T1557.002': 'ARP Cache Poisoning',
  'T1557.003': 'DHCP Spoofing',
  'T1110': 'Brute Force',
  'T1110.001': 'Password Guessing',
  'T1110.002': 'Password Cracking',
  'T1110.003': 'Password Spraying',
  'T1110.004': 'Credential Stuffing',
  'T1555': 'Credentials from Password Stores',
  'T1555.001': 'Keychain',
  'T1555.002': 'Securityd Memory',
  'T1555.003': 'Credentials from Web Browsers',
  'T1555.004': 'Windows Credential Manager',
  'T1555.005': 'Password Managers',
  'T1555.006': 'Cloud Secrets Management Stores',
  'T1212': 'Exploitation for Credential Access',
  'T1187': 'Forced Authentication',
  'T1606': 'Forge Web Credentials',
  'T1606.001': 'Web Cookies',
  'T1606.002': 'SAML Tokens',
  'T1056': 'Input Capture',
  'T1056.001': 'Keylogging',
  'T1056.002': 'GUI Input Capture',
  'T1056.003': 'Web Portal Capture',
  'T1056.004': 'Credential API Hooking',
  'T1556': 'Modify Authentication Process',
  'T1040': 'Network Sniffing',
  'T1003': 'OS Credential Dumping',
  'T1003.001': 'LSASS Memory',
  'T1003.002': 'Security Account Manager',
  'T1003.003': 'NTDS',
  'T1003.004': 'LSA Secrets',
  'T1003.005': 'Cached Domain Credentials',
  'T1003.006': 'DCSync',
  'T1003.007': 'Proc Filesystem',
  'T1003.008': '/etc/passwd and /etc/shadow',
  'T1528': 'Steal Application Access Token',
  'T1649': 'Steal or Forge Authentication Certificates',
  'T1558': 'Steal or Forge Kerberos Tickets',
  'T1558.001': 'Golden Ticket',
  'T1558.002': 'Silver Ticket',
  'T1558.003': 'Kerberoasting',
  'T1558.004': 'AS-REP Roasting',
  'T1539': 'Steal Web Session Cookie',
  'T1111': 'Multi-Factor Authentication Interception',

  // Discovery
  'T1087': 'Account Discovery',
  'T1087.001': 'Local Account',
  'T1087.002': 'Domain Account',
  'T1087.003': 'Email Account',
  'T1087.004': 'Cloud Account',
  'T1010': 'Application Window Discovery',
  'T1217': 'Browser Information Discovery',
  'T1580': 'Cloud Infrastructure Discovery',
  'T1538': 'Cloud Service Dashboard',
  'T1526': 'Cloud Service Discovery',
  'T1613': 'Container and Resource Discovery',
  'T1622': 'Debugger Evasion',
  'T1482': 'Domain Trust Discovery',
  'T1083': 'File and Directory Discovery',
  'T1615': 'Group Policy Discovery',
  'T1654': 'Log Enumeration',
  'T1046': 'Network Service Discovery',
  'T1135': 'Network Share Discovery',
  'T1040': 'Network Sniffing',
  'T1201': 'Password Policy Discovery',
  'T1120': 'Peripheral Device Discovery',
  'T1069': 'Permission Groups Discovery',
  'T1069.001': 'Local Groups',
  'T1069.002': 'Domain Groups',
  'T1069.003': 'Cloud Groups',
  'T1057': 'Process Discovery',
  'T1012': 'Query Registry',
  'T1018': 'Remote System Discovery',
  'T1518': 'Software Discovery',
  'T1518.001': 'Security Software Discovery',
  'T1082': 'System Information Discovery',
  'T1614': 'System Location Discovery',
  'T1614.001': 'System Language Discovery',
  'T1016': 'System Network Configuration Discovery',
  'T1016.001': 'Internet Connection Discovery',
  'T1049': 'System Network Connections Discovery',
  'T1033': 'System Owner/User Discovery',
  'T1007': 'System Service Discovery',
  'T1124': 'System Time Discovery',
  'T1497': 'Virtualization/Sandbox Evasion',

  // Lateral Movement
  'T1210': 'Exploitation of Remote Services',
  'T1534': 'Internal Spearphishing',
  'T1570': 'Lateral Tool Transfer',
  'T1563': 'Remote Service Session Hijacking',
  'T1563.001': 'SSH Hijacking',
  'T1563.002': 'RDP Hijacking',
  'T1021': 'Remote Services',
  'T1021.001': 'Remote Desktop Protocol',
  'T1021.002': 'SMB/Windows Admin Shares',
  'T1021.003': 'Distributed Component Object Model',
  'T1021.004': 'SSH',
  'T1021.005': 'VNC',
  'T1021.006': 'Windows Remote Management',
  'T1021.007': 'Cloud Services',
  'T1080': 'Taint Shared Content',
  'T1550': 'Use Alternate Authentication Material',

  // Collection
  'T1557': 'Adversary-in-the-Middle',
  'T1560': 'Archive Collected Data',
  'T1560.001': 'Archive via Utility',
  'T1560.002': 'Archive via Library',
  'T1560.003': 'Archive via Custom Method',
  'T1123': 'Audio Capture',
  'T1119': 'Automated Collection',
  'T1185': 'Browser Session Hijacking',
  'T1115': 'Clipboard Data',
  'T1530': 'Data from Cloud Storage',
  'T1602': 'Data from Configuration Repository',
  'T1602.001': 'SNMP (MIB Dump)',
  'T1602.002': 'Network Device Configuration Dump',
  'T1213': 'Data from Information Repositories',
  'T1213.001': 'Confluence',
  'T1213.002': 'Sharepoint',
  'T1213.003': 'Code Repositories',
  'T1005': 'Data from Local System',
  'T1039': 'Data from Network Shared Drive',
  'T1025': 'Data from Removable Media',
  'T1074': 'Data Staged',
  'T1074.001': 'Local Data Staging',
  'T1074.002': 'Remote Data Staging',
  'T1114': 'Email Collection',
  'T1114.001': 'Local Email Collection',
  'T1114.002': 'Remote Email Collection',
  'T1114.003': 'Email Forwarding Rule',
  'T1056': 'Input Capture',
  'T1113': 'Screen Capture',
  'T1125': 'Video Capture',

  // Command and Control
  'T1071': 'Application Layer Protocol',
  'T1071.001': 'Web Protocols',
  'T1071.002': 'File Transfer Protocols',
  'T1071.003': 'Mail Protocols',
  'T1071.004': 'DNS',
  'T1092': 'Communication Through Removable Media',
  'T1132': 'Data Encoding',
  'T1132.001': 'Standard Encoding',
  'T1132.002': 'Non-Standard Encoding',
  'T1001': 'Data Obfuscation',
  'T1568': 'Dynamic Resolution',
  'T1568.001': 'Fast Flux DNS',
  'T1568.002': 'Domain Generation Algorithms',
  'T1568.003': 'DNS Calculation',
  'T1573': 'Encrypted Channel',
  'T1573.001': 'Symmetric Cryptography',
  'T1573.002': 'Asymmetric Cryptography',
  'T1008': 'Fallback Channels',
  'T1105': 'Ingress Tool Transfer',
  'T1104': 'Multi-Stage Channels',
  'T1095': 'Non-Application Layer Protocol',
  'T1571': 'Non-Standard Port',
  'T1572': 'Protocol Tunneling',
  'T1090': 'Proxy',
  'T1090.001': 'Internal Proxy',
  'T1090.002': 'External Proxy',
  'T1090.003': 'Multi-hop Proxy',
  'T1090.004': 'Domain Fronting',
  'T1219': 'Remote Access Software',
  'T1205': 'Traffic Signaling',
  'T1102': 'Web Service',
  'T1102.001': 'Dead Drop Resolver',
  'T1102.002': 'Bidirectional Communication',
  'T1102.003': 'One-Way Communication',

  // Exfiltration
  'T1020': 'Automated Exfiltration',
  'T1020.001': 'Traffic Duplication',
  'T1030': 'Data Transfer Size Limits',
  'T1048': 'Exfiltration Over Alternative Protocol',
  'T1048.001': 'Exfiltration Over Symmetric Encrypted Non-C2 Protocol',
  'T1048.002': 'Exfiltration Over Asymmetric Encrypted Non-C2 Protocol',
  'T1048.003': 'Exfiltration Over Unencrypted Non-C2 Protocol',
  'T1041': 'Exfiltration Over C2 Channel',
  'T1011': 'Exfiltration Over Other Network Medium',
  'T1011.001': 'Exfiltration Over Bluetooth',
  'T1052': 'Exfiltration Over Physical Medium',
  'T1052.001': 'Exfiltration over USB',
  'T1567': 'Exfiltration Over Web Service',
  'T1567.001': 'Exfiltration to Code Repository',
  'T1567.002': 'Exfiltration to Cloud Storage',
  'T1567.003': 'Exfiltration to Text Storage Sites',
  'T1567.004': 'Exfiltration Over Webhook',
  'T1029': 'Scheduled Transfer',
  'T1537': 'Transfer Data to Cloud Account',

  // Impact
  'T1531': 'Account Access Removal',
  'T1485': 'Data Destruction',
  'T1486': 'Data Encrypted for Impact',
  'T1565': 'Data Manipulation',
  'T1565.001': 'Stored Data Manipulation',
  'T1565.002': 'Transmitted Data Manipulation',
  'T1565.003': 'Runtime Data Manipulation',
  'T1491': 'Defacement',
  'T1491.001': 'Internal Defacement',
  'T1491.002': 'External Defacement',
  'T1561': 'Disk Wipe',
  'T1561.001': 'Disk Content Wipe',
  'T1561.002': 'Disk Structure Wipe',
  'T1499': 'Endpoint Denial of Service',
  'T1499.001': 'OS Exhaustion Flood',
  'T1499.002': 'Service Exhaustion Flood',
  'T1499.003': 'Application Exhaustion Flood',
  'T1499.004': 'Application or System Exploitation',
  'T1657': 'Financial Theft',
  'T1495': 'Firmware Corruption',
  'T1490': 'Inhibit System Recovery',
  'T1498': 'Network Denial of Service',
  'T1498.001': 'Direct Network Flood',
  'T1498.002': 'Reflection Amplification',
  'T1496': 'Resource Hijacking',
  'T1489': 'Service Stop',
  'T1529': 'System Shutdown/Reboot',
};
```

**Important notes for implementer:**
1. **Deduplicate entries.** Many techniques appear under multiple tactics (e.g., T1055 Process Injection is both Privilege Escalation and Defense Evasion). This is a flat ID→name lookup — keep only one entry per technique ID. Remove all duplicate keys before finalizing the file.
2. **Completeness.** The list above is representative (~400 entries). If a technique ID used by a test is missing from this map, it gracefully falls back to showing just the raw ID (no name). The file can be generated from MITRE's public STIX data (`enterprise-attack.json`) if full completeness is needed, but the fallback makes this non-critical.
3. **No runtime cost.** This is a static object, tree-shaken if unused. ~15KB minified.

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/data/mitre-techniques.ts
git commit -m "feat(browser): add MITRE ATT&CK technique name lookup data"
```

---

### Task 2: Rewrite MitreAttackMatrix component

**Files:**
- Modify: `frontend/src/components/browser/MitreAttackMatrix.tsx` (full rewrite)

This task rewrites the component from a card grid to a bar chart + drill-down panel. The props interface, data computation (`useMemo`), and color functions are preserved. The rendering is entirely new.

- [ ] **Step 1: Rewrite the MitreAttackMatrix component**

Replace the entire file `frontend/src/components/browser/MitreAttackMatrix.tsx`. Preserve:
- `MitreTactic` interface (add `barLabel: string` field)
- `ENTERPRISE_TACTICS` constant (add `barLabel` to each entry)
- `TechniqueCell` interface
- `MitreAttackMatrixProps` interface
- `useMemo` that computes `tacticMap`, `maxCount`, `stats`
- `getIntensityColor()` function
- `getTextColor()` function
- Empty state rendering

Remove:
- `COLLAPSED_LIMIT` constant
- `expandedTactics` state
- `getTacticBorderColor()` function
- `toggleExpanded()` function
- `legendSteps` computation
- The entire card grid render block
- `Card`, `CardContent`, `CardHeader`, `CardTitle` imports
- `Tooltip`, `TooltipTrigger`, `TooltipContent` imports
- `ChevronDown` import

Add:
- `import { TECHNIQUE_NAMES } from '@/data/mitre-techniques';`
- `selectedTactic` state (`string | null`)
- Bar chart render
- Detail panel render

Here is the complete replacement component:

```tsx
import { useMemo, useState } from 'react';
import type { TestMetadata } from '@/types/test';
import { useTheme } from '@/hooks/useTheme';
import { Badge } from '@/components/shared/ui/Badge';
import { Switch } from '@/components/shared/ui/Switch';
import { Grid3X3 } from 'lucide-react';
import { TECHNIQUE_NAMES } from '@/data/mitre-techniques';

// ── MITRE ATT&CK Enterprise Tactics (kill-chain order) ──────────────

interface MitreTactic {
  slug: string;
  id: string;
  name: string;
  shortName: string;
  barLabel: string;
}

const ENTERPRISE_TACTICS: MitreTactic[] = [
  { slug: 'reconnaissance',       id: 'TA0043', name: 'Reconnaissance',        shortName: 'Recon',          barLabel: 'RE' },
  { slug: 'resource-development',  id: 'TA0042', name: 'Resource Development',  shortName: 'Res. Dev.',      barLabel: 'RD' },
  { slug: 'initial-access',       id: 'TA0001', name: 'Initial Access',        shortName: 'Init. Access',   barLabel: 'IA' },
  { slug: 'execution',            id: 'TA0002', name: 'Execution',             shortName: 'Execution',      barLabel: 'EX' },
  { slug: 'persistence',          id: 'TA0003', name: 'Persistence',           shortName: 'Persistence',    barLabel: 'PE' },
  { slug: 'privilege-escalation', id: 'TA0004', name: 'Privilege Escalation',  shortName: 'Priv. Esc.',     barLabel: 'PR' },
  { slug: 'defense-evasion',      id: 'TA0005', name: 'Defense Evasion',       shortName: 'Def. Evasion',   barLabel: 'DE' },
  { slug: 'credential-access',    id: 'TA0006', name: 'Credential Access',     shortName: 'Cred. Access',   barLabel: 'CA' },
  { slug: 'discovery',            id: 'TA0007', name: 'Discovery',             shortName: 'Discovery',      barLabel: 'DI' },
  { slug: 'lateral-movement',     id: 'TA0008', name: 'Lateral Movement',      shortName: 'Lat. Movement',  barLabel: 'LM' },
  { slug: 'collection',           id: 'TA0009', name: 'Collection',            shortName: 'Collection',     barLabel: 'CO' },
  { slug: 'command-and-control',  id: 'TA0011', name: 'Command and Control',   shortName: 'C2',             barLabel: 'C2' },
  { slug: 'exfiltration',         id: 'TA0010', name: 'Exfiltration',          shortName: 'Exfiltration',   barLabel: 'EF' },
  { slug: 'impact',               id: 'TA0040', name: 'Impact',                shortName: 'Impact',         barLabel: 'IM' },
];

// ── Types ────────────────────────────────────────────────────────────

interface TechniqueCell {
  techniqueId: string;
  count: number;
  testNames: string[];
}

interface MitreAttackMatrixProps {
  tests: TestMetadata[];
  onDrillToTechnique: (technique: string) => void;
}

// ── Component ────────────────────────────────────────────────────────

export default function MitreAttackMatrix({ tests, onDrillToTechnique }: MitreAttackMatrixProps) {
  const { theme, themeStyle } = useTheme();
  const isDark = theme === 'dark' || themeStyle === 'hackerterminal';
  const isHacker = themeStyle === 'hackerterminal';
  const isNeobrut = themeStyle === 'neobrutalism';

  const [showEmpty, setShowEmpty] = useState(false);
  const [selectedTactic, setSelectedTactic] = useState<string | null>(null);

  // Build tactic → technique[] map from test data
  const { tacticMap, maxCount, stats, maxTacticTests } = useMemo(() => {
    const map = new Map<string, Map<string, { count: number; testNames: string[] }>>();
    let max = 0;
    const mappedTestIds = new Set<string>();
    const allTechniqueIds = new Set<string>();

    for (const tactic of ENTERPRISE_TACTICS) {
      map.set(tactic.slug, new Map());
    }

    for (const test of tests) {
      const tactics = test.tactics;
      const techniques = test.techniques;
      if (!tactics?.length || !techniques?.length) continue;

      mappedTestIds.add(test.uuid);

      for (const tactic of tactics) {
        const slug = tactic.toLowerCase();
        const techMap = map.get(slug);
        if (!techMap) continue;

        for (const tech of techniques) {
          allTechniqueIds.add(tech);
          const existing = techMap.get(tech);
          if (existing) {
            existing.count++;
            if (existing.testNames.length < 5) {
              existing.testNames.push(test.name);
            }
          } else {
            techMap.set(tech, { count: 1, testNames: [test.name] });
          }
          if ((existing?.count ?? 1) > max) max = existing?.count ?? 1;
        }
      }
    }

    // Convert to sorted TechniqueCell[] per tactic + compute per-tactic test totals
    const result = new Map<string, TechniqueCell[]>();
    let maxTTests = 0;
    for (const [slug, techMap] of map) {
      const cells: TechniqueCell[] = [];
      let tacticTestTotal = 0;
      for (const [techniqueId, data] of techMap) {
        cells.push({ techniqueId, count: data.count, testNames: data.testNames });
        tacticTestTotal += data.count;
      }
      cells.sort((a, b) => b.count - a.count || a.techniqueId.localeCompare(b.techniqueId));
      result.set(slug, cells);
      if (tacticTestTotal > maxTTests) maxTTests = tacticTestTotal;
    }

    const coveredTactics = ENTERPRISE_TACTICS.filter(t => (result.get(t.slug)?.length ?? 0) > 0).length;

    return {
      tacticMap: result,
      maxCount: max,
      maxTacticTests: maxTTests,
      stats: {
        techniqueCount: allTechniqueIds.size,
        tacticCount: coveredTactics,
        testCount: mappedTestIds.size,
      },
    };
  }, [tests]);

  // ── Color ramp ─────────────────────────────────────────────────────

  function getIntensityColor(count: number): string {
    if (count === 0) return 'transparent';
    const intensity = maxCount > 0 ? count / maxCount : 0;

    if (isHacker) {
      if (intensity > 0.75) return 'oklch(0.70 0.22 142)';
      if (intensity > 0.5)  return 'oklch(0.58 0.18 142)';
      if (intensity > 0.25) return 'oklch(0.45 0.14 142)';
      return 'oklch(0.35 0.10 142)';
    }

    if (isNeobrut) {
      if (isDark) {
        if (intensity > 0.75) return 'oklch(0.62 0.24 340)';
        if (intensity > 0.5)  return 'oklch(0.50 0.20 340)';
        if (intensity > 0.25) return 'oklch(0.40 0.16 340)';
        return 'oklch(0.32 0.12 340)';
      }
      if (intensity > 0.75) return 'oklch(0.58 0.22 340)';
      if (intensity > 0.5)  return 'oklch(0.68 0.18 340)';
      if (intensity > 0.25) return 'oklch(0.78 0.14 340)';
      return 'oklch(0.88 0.10 340)';
    }

    if (isDark) {
      if (intensity > 0.75) return 'oklch(0.65 0.20 145)';
      if (intensity > 0.5)  return 'oklch(0.52 0.16 145)';
      if (intensity > 0.25) return 'oklch(0.42 0.13 145)';
      return 'oklch(0.32 0.10 145)';
    }

    if (intensity > 0.75) return 'oklch(0.55 0.18 145)';
    if (intensity > 0.5)  return 'oklch(0.65 0.15 145)';
    if (intensity > 0.25) return 'oklch(0.75 0.12 145)';
    return 'oklch(0.85 0.10 145)';
  }

  function getBarColor(tacticTestTotal: number): string {
    if (tacticTestTotal === 0) return 'transparent';
    const intensity = maxTacticTests > 0 ? tacticTestTotal / maxTacticTests : 0;

    if (isHacker) {
      if (intensity > 0.75) return 'oklch(0.70 0.22 142)';
      if (intensity > 0.5)  return 'oklch(0.58 0.18 142)';
      if (intensity > 0.25) return 'oklch(0.45 0.14 142)';
      return 'oklch(0.35 0.10 142)';
    }
    if (isNeobrut) {
      if (isDark) {
        if (intensity > 0.75) return 'oklch(0.62 0.24 340)';
        if (intensity > 0.5)  return 'oklch(0.50 0.20 340)';
        if (intensity > 0.25) return 'oklch(0.40 0.16 340)';
        return 'oklch(0.32 0.12 340)';
      }
      if (intensity > 0.75) return 'oklch(0.58 0.22 340)';
      if (intensity > 0.5)  return 'oklch(0.68 0.18 340)';
      if (intensity > 0.25) return 'oklch(0.78 0.14 340)';
      return 'oklch(0.88 0.10 340)';
    }
    if (isDark) {
      if (intensity > 0.75) return 'oklch(0.65 0.20 145)';
      if (intensity > 0.5)  return 'oklch(0.52 0.16 145)';
      if (intensity > 0.25) return 'oklch(0.42 0.13 145)';
      return 'oklch(0.32 0.10 145)';
    }
    if (intensity > 0.75) return 'oklch(0.55 0.18 145)';
    if (intensity > 0.5)  return 'oklch(0.65 0.15 145)';
    if (intensity > 0.25) return 'oklch(0.75 0.12 145)';
    return 'oklch(0.85 0.10 145)';
  }

  function getTextColor(count: number): string {
    if (count === 0) return '';
    const intensity = maxCount > 0 ? count / maxCount : 0;

    if (isHacker) return 'oklch(0.15 0.02 142)';
    if (isNeobrut) {
      if (isDark) return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.92 0.01 340)';
      return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.20 0.02 340)';
    }
    if (isDark) return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.90 0 0)';
    return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.20 0.02 145)';
  }

  // ── Computed values ────────────────────────────────────────────────

  const visibleTactics = ENTERPRISE_TACTICS.filter(
    t => showEmpty || (tacticMap.get(t.slug)?.length ?? 0) > 0
  );

  const maxTechniqueCount = Math.max(...visibleTactics.map(t => tacticMap.get(t.slug)?.length ?? 0), 1);

  const selectedCells = selectedTactic ? (tacticMap.get(selectedTactic) ?? []) : [];
  const selectedTacticInfo = selectedTactic
    ? ENTERPRISE_TACTICS.find(t => t.slug === selectedTactic)
    : null;
  const selectedTotalTests = selectedCells.reduce((sum, c) => sum + c.count, 0);

  // ── Empty state ────────────────────────────────────────────────────

  if (stats.testCount === 0) {
    return (
      <div className="rounded-base border-theme border-border bg-card text-card-foreground shadow-theme p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Grid3X3 className="w-10 h-10 opacity-30" />
        <p className="text-sm">No tests have MITRE ATT&CK tactic data yet.</p>
        <p className="text-xs opacity-60">
          Add <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">TACTICS:</code> to test headers to map tests to the ATT&CK matrix.
        </p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="rounded-base border-theme border-border bg-card text-card-foreground shadow-theme">
      {/* Header */}
      <div className="p-4 pb-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-base font-semibold">MITRE ATT&CK Coverage</span>
          <div className="flex items-center gap-2">
            <Badge variant="success">{stats.techniqueCount} techniques</Badge>
            <Badge variant="primary">{stats.tacticCount}/14 tactics</Badge>
            <Badge variant="default">{stats.testCount} tests mapped</Badge>
          </div>
          <div className="ml-auto">
            <Switch
              label="Show uncovered tactics"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
            />
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="p-4">
        <div className="flex items-end gap-1 h-48">
          {visibleTactics.map(tactic => {
            const cells = tacticMap.get(tactic.slug) ?? [];
            const techCount = cells.length;
            const totalTests = cells.reduce((sum, c) => sum + c.count, 0);
            const isEmpty = techCount === 0;
            const barHeight = isEmpty ? 4 : Math.max(12, (techCount / maxTechniqueCount) * 100);
            const isSelected = selectedTactic === tactic.slug;

            return (
              <div
                key={tactic.slug}
                className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
              >
                <button
                  onClick={() => setSelectedTactic(prev => prev === tactic.slug ? null : tactic.slug)}
                  className="w-full transition-all cursor-pointer hover:opacity-80 rounded-t-sm"
                  style={{
                    height: `${barHeight}%`,
                    minHeight: isEmpty ? 4 : 12,
                    backgroundColor: isEmpty ? 'transparent' : getBarColor(totalTests),
                    border: isEmpty
                      ? '1px dashed var(--color-destructive, #ef4444)'
                      : isSelected
                        ? '2px solid var(--color-primary)'
                        : '1px solid transparent',
                    opacity: isEmpty ? 0.4 : 1,
                  }}
                  title={`${tactic.name} — ${techCount} techniques · ${totalTests} tests`}
                />
                <span className={`text-[9px] font-semibold leading-none ${
                  isEmpty ? 'text-destructive' : isSelected ? 'text-primary' : 'text-muted-foreground'
                }`}>
                  {tactic.barLabel}
                </span>
              </div>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div
          className="grid transition-[grid-template-rows] duration-200"
          style={{ gridTemplateRows: selectedTactic ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            {selectedTacticInfo && (
              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">
                    {selectedTacticInfo.name}
                    <span className="text-muted-foreground font-normal ml-2">{selectedTacticInfo.id}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {selectedCells.length} techniques · {selectedTotalTests} tests
                  </span>
                </div>
                {selectedCells.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No coverage for this tactic</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCells.map(cell => (
                      <button
                        key={cell.techniqueId}
                        onClick={() => onDrillToTechnique(cell.techniqueId)}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-opacity hover:opacity-80 cursor-pointer"
                        style={{
                          backgroundColor: getIntensityColor(cell.count),
                          color: getTextColor(cell.count),
                        }}
                        title={cell.testNames.slice(0, 3).join(', ') + (cell.count > 3 ? ` +${cell.count - 3} more` : '')}
                      >
                        <span className="font-mono font-semibold">{cell.techniqueId}</span>
                        {TECHNIQUE_NAMES[cell.techniqueId] && (
                          <span className="opacity-80 truncate max-w-[200px]">
                            {TECHNIQUE_NAMES[cell.techniqueId]}
                          </span>
                        )}
                        <span className="font-semibold ml-auto shrink-0">·&nbsp;{cell.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Hint when no tactic selected */}
        {!selectedTactic && (
          <p className="text-center text-xs text-muted-foreground mt-4">
            Click a tactic bar to explore technique coverage
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npm test`
Expected: All tests pass (no existing tests for this component).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/browser/MitreAttackMatrix.tsx
git commit -m "feat(browser): replace ATT&CK card grid with bar chart + drill-down panel"
```

---

### Task 3: Final verification

- [ ] **Step 1: Run full frontend build**

Run: `cd frontend && npm run build`
Expected: Clean build.

- [ ] **Step 2: Visual verification across themes**

Start: `cd /home/jimx/F0RT1KA/ProjectAchilles && ./scripts/start.sh -k --daemon`
Navigate to `http://localhost:5173/dashboard?tab=matrix`

Check all three themes (Default Dark, Neobrutalism, Hacker Terminal):
1. Bar chart shows 12 colored bars (14 if "Show uncovered tactics" is on)
2. Uncovered tactics show as stubby red-dashed bars
3. Hovering a bar shows tooltip with tactic name + counts
4. Clicking a bar opens detail panel below with technique chips
5. Technique chips show human-readable names (e.g., "T1059 — Command and Scripting Interpreter")
6. Clicking a chip drills to Browse tab filtered by that technique
7. Clicking same bar again closes the panel
8. "Show uncovered tactics" toggle works
9. Stats badges show correct counts
