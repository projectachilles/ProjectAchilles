#!/usr/bin/env python3
"""
Generate synthetic test execution data for Elasticsearch.
Includes all enriched fields: category, subcategory, severity, tactics,
threat_actor, tags, complexity, target, score.

Usage:
    python generate_synthetic_data.py --count 1000 --output synthetic_data.ndjson
    python generate_synthetic_data.py --count 5000 --days 90 --output synthetic_data.ndjson

Then upload to Elasticsearch:
    curl -X POST "https://your-es-host:9200/achilles-results-*/_bulk" \
         -H "Content-Type: application/x-ndjson" \
         --data-binary @synthetic_data.ndjson
"""

import json
import random
import uuid
import argparse
from datetime import datetime, timedelta

# Namespace UUID for deterministic test_uuid generation (uuid5)
TEST_UUID_NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

# =============================================================================
# Reference Data
# =============================================================================

ORGANIZATIONS = [
    {"uuid": "09b59276-9efb-4d3d-bbdd-4b4663ef0c42", "name": "SB"},
    {"uuid": "b2f8dccb-6d23-492e-aa87-a0a8a6103189", "name": "TPSGL"},
    {"uuid": "9634119d-fa6b-42b8-9b9b-90ad8f22e482", "name": "RGA"},
]

HOSTNAMES = [
    "WKS-001", "WKS-002", "WKS-003", "WKS-042", "WKS-089", "WKS-100",
    "SRV-001", "SRV-002", "SRV-DC01", "SRV-DB01", "SRV-WEB01",
    "DC-01", "DC-02", "EXCH-01", "FILE-01", "PRINT-01",
    "LAPTOP-ADMIN", "LAPTOP-DEV01", "LAPTOP-HR01",
]

# Test definitions with realistic ATT&CK mappings
TESTS = [
    {
        "name": "Credential Dumping via LSASS",
        "techniques": ["T1003.001", "T1003.002"],
        "tactics": ["Credential Access"],
        "category": "intel-driven",
        "subcategory": "credential-theft",
        "severity": "critical",
        "complexity": "high",
        "target": "Windows 10, Windows 11, Windows Server 2019",
        "tags": ["windows", "memory", "credentials", "lsass"],
        "threat_actors": ["APT29", "APT28", "Lazarus Group"],
        "base_score": 9.0,
    },
    {
        "name": "Registry Persistence",
        "techniques": ["T1547.001"],
        "tactics": ["Persistence", "Privilege Escalation"],
        "category": "mitre-top10",
        "subcategory": "persistence",
        "severity": "high",
        "complexity": "low",
        "target": "Windows 10, Windows 11",
        "tags": ["windows", "registry", "persistence", "autorun"],
        "threat_actors": ["Lazarus Group", "FIN7", "APT32"],
        "base_score": 7.5,
    },
    {
        "name": "PowerShell Execution",
        "techniques": ["T1059.001"],
        "tactics": ["Execution"],
        "category": "cyber-hygiene",
        "subcategory": "script-execution",
        "severity": "medium",
        "complexity": "low",
        "target": "Windows 10, Windows 11, Windows Server",
        "tags": ["windows", "powershell", "scripting"],
        "threat_actors": ["APT29", "FIN7", "Wizard Spider"],
        "base_score": 6.0,
    },
    {
        "name": "Lateral Movement via PsExec",
        "techniques": ["T1569.002", "T1021.002"],
        "tactics": ["Lateral Movement", "Execution"],
        "category": "phase-aligned",
        "subcategory": "lateral-movement",
        "severity": "critical",
        "complexity": "medium",
        "target": "Windows Server 2016, Windows Server 2019",
        "tags": ["windows", "psexec", "lateral", "smb"],
        "threat_actors": ["APT28", "Sandworm", "FIN7"],
        "base_score": 8.5,
    },
    {
        "name": "Scheduled Task Creation",
        "techniques": ["T1053.005"],
        "tactics": ["Persistence", "Execution"],
        "category": "mitre-top10",
        "subcategory": "persistence",
        "severity": "high",
        "complexity": "low",
        "target": "Windows 10, Windows 11",
        "tags": ["windows", "scheduled-task", "persistence"],
        "threat_actors": ["APT29", "Lazarus Group"],
        "base_score": 7.0,
    },
    {
        "name": "WMI Execution",
        "techniques": ["T1047"],
        "tactics": ["Execution"],
        "category": "cyber-hygiene",
        "subcategory": "script-execution",
        "severity": "medium",
        "complexity": "medium",
        "target": "Windows 10, Windows Server",
        "tags": ["windows", "wmi", "remote-execution"],
        "threat_actors": ["APT32", "Turla", "APT29"],
        "base_score": 6.5,
    },
    {
        "name": "Kerberoasting",
        "techniques": ["T1558.003"],
        "tactics": ["Credential Access"],
        "category": "intel-driven",
        "subcategory": "credential-theft",
        "severity": "critical",
        "complexity": "medium",
        "target": "Active Directory",
        "tags": ["windows", "kerberos", "credentials", "active-directory"],
        "threat_actors": ["APT29", "FIN7", "Wizard Spider"],
        "base_score": 8.0,
    },
    {
        "name": "DCSync Attack",
        "techniques": ["T1003.006"],
        "tactics": ["Credential Access"],
        "category": "intel-driven",
        "subcategory": "credential-theft",
        "severity": "critical",
        "complexity": "high",
        "target": "Domain Controller",
        "tags": ["windows", "dcsync", "credentials", "domain-admin"],
        "threat_actors": ["APT29", "APT28", "Sandworm"],
        "base_score": 9.5,
    },
    {
        "name": "Pass-the-Hash",
        "techniques": ["T1550.002"],
        "tactics": ["Defense Evasion", "Lateral Movement"],
        "category": "phase-aligned",
        "subcategory": "lateral-movement",
        "severity": "high",
        "complexity": "medium",
        "target": "Windows 10, Windows Server",
        "tags": ["windows", "pth", "ntlm", "lateral"],
        "threat_actors": ["APT28", "APT29", "Lazarus Group"],
        "base_score": 8.0,
    },
    {
        "name": "Process Injection",
        "techniques": ["T1055.001", "T1055.002"],
        "tactics": ["Defense Evasion", "Privilege Escalation"],
        "category": "mitre-top10",
        "subcategory": "evasion",
        "severity": "high",
        "complexity": "high",
        "target": "Windows 10, Windows 11",
        "tags": ["windows", "injection", "evasion", "memory"],
        "threat_actors": ["APT32", "Turla", "Lazarus Group"],
        "base_score": 7.5,
    },
    {
        "name": "BITS Job Persistence",
        "techniques": ["T1197"],
        "tactics": ["Persistence", "Defense Evasion"],
        "category": "cyber-hygiene",
        "subcategory": "persistence",
        "severity": "medium",
        "complexity": "low",
        "target": "Windows 10, Windows 11",
        "tags": ["windows", "bits", "persistence", "download"],
        "threat_actors": ["APT29", "Leviathan"],
        "base_score": 5.5,
    },
    {
        "name": "DLL Side-Loading",
        "techniques": ["T1574.002"],
        "tactics": ["Persistence", "Defense Evasion", "Privilege Escalation"],
        "category": "intel-driven",
        "subcategory": "evasion",
        "severity": "high",
        "complexity": "medium",
        "target": "Windows 10, Windows 11",
        "tags": ["windows", "dll", "sideloading", "evasion"],
        "threat_actors": ["APT41", "Mustang Panda", "APT32"],
        "base_score": 7.0,
    },
    {
        "name": "Golden Ticket Attack",
        "techniques": ["T1558.001"],
        "tactics": ["Credential Access"],
        "category": "intel-driven",
        "subcategory": "credential-theft",
        "severity": "critical",
        "complexity": "high",
        "target": "Active Directory",
        "tags": ["windows", "kerberos", "golden-ticket", "domain"],
        "threat_actors": ["APT29", "Sandworm"],
        "base_score": 9.5,
    },
    {
        "name": "Service Installation",
        "techniques": ["T1543.003"],
        "tactics": ["Persistence", "Privilege Escalation"],
        "category": "mitre-top10",
        "subcategory": "persistence",
        "severity": "high",
        "complexity": "medium",
        "target": "Windows Server",
        "tags": ["windows", "service", "persistence", "privilege-escalation"],
        "threat_actors": ["FIN7", "Wizard Spider", "APT28"],
        "base_score": 7.5,
    },
    {
        "name": "AMSI Bypass",
        "techniques": ["T1562.001"],
        "tactics": ["Defense Evasion"],
        "category": "cyber-hygiene",
        "subcategory": "evasion",
        "severity": "medium",
        "complexity": "medium",
        "target": "Windows 10, Windows 11",
        "tags": ["windows", "amsi", "bypass", "evasion"],
        "threat_actors": ["FIN7", "Wizard Spider"],
        "base_score": 6.0,
    },
    {
        "name": "Token Impersonation",
        "techniques": ["T1134.001"],
        "tactics": ["Defense Evasion", "Privilege Escalation"],
        "category": "phase-aligned",
        "subcategory": "privilege-escalation",
        "severity": "high",
        "complexity": "medium",
        "target": "Windows 10, Windows Server",
        "tags": ["windows", "token", "impersonation", "privilege"],
        "threat_actors": ["APT28", "APT32"],
        "base_score": 7.0,
    },
    {
        "name": "COM Object Hijacking",
        "techniques": ["T1546.015"],
        "tactics": ["Persistence", "Privilege Escalation"],
        "category": "intel-driven",
        "subcategory": "persistence",
        "severity": "medium",
        "complexity": "high",
        "target": "Windows 10, Windows 11",
        "tags": ["windows", "com", "hijack", "persistence"],
        "threat_actors": ["APT29", "Turla"],
        "base_score": 6.5,
    },
    {
        "name": "Network Share Discovery",
        "techniques": ["T1135"],
        "tactics": ["Discovery"],
        "category": "cyber-hygiene",
        "subcategory": "discovery",
        "severity": "low",
        "complexity": "low",
        "target": "Windows, Linux",
        "tags": ["network", "discovery", "shares", "reconnaissance"],
        "threat_actors": ["APT28", "APT29", "FIN7"],
        "base_score": 4.0,
    },
    {
        "name": "Remote Desktop Protocol",
        "techniques": ["T1021.001"],
        "tactics": ["Lateral Movement"],
        "category": "phase-aligned",
        "subcategory": "lateral-movement",
        "severity": "medium",
        "complexity": "low",
        "target": "Windows 10, Windows Server",
        "tags": ["windows", "rdp", "lateral", "remote"],
        "threat_actors": ["Lazarus Group", "FIN7", "APT32"],
        "base_score": 5.5,
    },
    {
        "name": "Archive Collected Data",
        "techniques": ["T1560.001"],
        "tactics": ["Collection"],
        "category": "phase-aligned",
        "subcategory": "collection",
        "severity": "info",
        "complexity": "low",
        "target": "Windows, Linux",
        "tags": ["collection", "archive", "exfiltration-prep"],
        "threat_actors": ["APT29", "APT28", "Turla"],
        "base_score": 3.5,
    },
]

# Error codes matching the analytics dashboard's ERROR_CODE_MAP
# (backend/src/services/analytics/elasticsearch.ts)
#
# Conclusive outcomes (drive Defense Score):
#   101 = Unprotected (attack succeeded)
#   105 = FileQuarantinedOnExtraction (protected)
#   126 = ExecutionPrevented (protected)
#   127 = QuarantinedOnExecution (protected)
#
# Inconclusive / error (drive Error Rate):
#   0   = NormalExit (inconclusive)
#   259 = StillActive / timeout (inconclusive)
#   999 = UnexpectedTestError (error)
# =============================================================================
# Bundle Test Definitions (CIS, multi-stage)
# =============================================================================

CIS_WINDOWS_CONTROLS = [
    {"id": "CH-DEF-001", "name": "Ensure Windows Defender Real-Time Protection is Enabled", "validator": "validator-defender", "techniques": ["T1562.001"], "tactics": ["Defense Evasion"]},
    {"id": "CH-DEF-002", "name": "Ensure Windows Defender Cloud Protection is Enabled", "validator": "validator-defender", "techniques": ["T1562.001"], "tactics": ["Defense Evasion"]},
    {"id": "CH-DEF-003", "name": "Ensure Windows Defender PUA Protection is Enabled", "validator": "validator-defender", "techniques": ["T1562.001"], "tactics": ["Defense Evasion"]},
    {"id": "CH-FW-001", "name": "Ensure Windows Firewall Domain Profile is Enabled", "validator": "validator-firewall", "techniques": ["T1562.004"], "tactics": ["Defense Evasion"]},
    {"id": "CH-FW-002", "name": "Ensure Windows Firewall Private Profile is Enabled", "validator": "validator-firewall", "techniques": ["T1562.004"], "tactics": ["Defense Evasion"]},
    {"id": "CH-FW-003", "name": "Ensure Windows Firewall Public Profile is Enabled", "validator": "validator-firewall", "techniques": ["T1562.004"], "tactics": ["Defense Evasion"]},
    {"id": "CH-UAC-001", "name": "Ensure UAC is Enabled", "validator": "validator-uac", "techniques": ["T1548.002"], "tactics": ["Privilege Escalation", "Defense Evasion"]},
    {"id": "CH-UAC-002", "name": "Ensure UAC Prompt for Elevation on Secure Desktop", "validator": "validator-uac", "techniques": ["T1548.002"], "tactics": ["Privilege Escalation"]},
    {"id": "CH-PWD-001", "name": "Ensure Minimum Password Length is 14 Characters", "validator": "validator-password-policy", "techniques": ["T1110.001"], "tactics": ["Credential Access"]},
    {"id": "CH-PWD-002", "name": "Ensure Password Complexity Requirements are Met", "validator": "validator-password-policy", "techniques": ["T1110.001"], "tactics": ["Credential Access"]},
    {"id": "CH-PWD-003", "name": "Ensure Account Lockout Threshold is 5 or Fewer", "validator": "validator-password-policy", "techniques": ["T1110.001"], "tactics": ["Credential Access"]},
    {"id": "CH-AUD-001", "name": "Ensure Audit Policy for Logon Events is Configured", "validator": "validator-audit", "techniques": ["T1562.002"], "tactics": ["Defense Evasion"]},
    {"id": "CH-AUD-002", "name": "Ensure Audit Policy for Object Access is Configured", "validator": "validator-audit", "techniques": ["T1562.002"], "tactics": ["Defense Evasion"]},
    {"id": "CH-NET-001", "name": "Ensure SMBv1 Protocol is Disabled", "validator": "validator-network", "techniques": ["T1210"], "tactics": ["Lateral Movement"]},
    {"id": "CH-NET-002", "name": "Ensure Remote Desktop is Restricted", "validator": "validator-network", "techniques": ["T1021.001"], "tactics": ["Lateral Movement"]},
    {"id": "CH-LSA-001", "name": "Ensure LSA Protection is Enabled", "validator": "validator-lsa", "techniques": ["T1003.001"], "tactics": ["Credential Access"]},
    {"id": "CH-LSA-002", "name": "Ensure Credential Guard is Enabled", "validator": "validator-lsa", "techniques": ["T1003.001"], "tactics": ["Credential Access"]},
    {"id": "CH-IEP-001", "name": "Ensure BitLocker Drive Encryption is Enabled", "validator": "validator-encryption", "techniques": ["T1005"], "tactics": ["Collection"]},
    {"id": "CH-IEP-002", "name": "Ensure Secure Boot is Enabled", "validator": "validator-encryption", "techniques": ["T1542.003"], "tactics": ["Persistence", "Defense Evasion"]},
    {"id": "CH-IEP-003", "name": "Ensure Windows Update is Configured for Auto-Install", "validator": "validator-updates", "techniques": ["T1190"], "tactics": ["Initial Access"]},
]

CIS_LINUX_CONTROLS = [
    {"id": "CH-SSH-001", "name": "Ensure SSH Root Login is Disabled", "validator": "validator-ssh", "techniques": ["T1021.004"], "tactics": ["Lateral Movement"]},
    {"id": "CH-SSH-002", "name": "Ensure SSH Protocol is Version 2", "validator": "validator-ssh", "techniques": ["T1021.004"], "tactics": ["Lateral Movement"]},
    {"id": "CH-SSH-003", "name": "Ensure SSH MaxAuthTries is 4 or Less", "validator": "validator-ssh", "techniques": ["T1110.001"], "tactics": ["Credential Access"]},
    {"id": "CH-FW-001", "name": "Ensure UFW/iptables is Active", "validator": "validator-firewall", "techniques": ["T1562.004"], "tactics": ["Defense Evasion"]},
    {"id": "CH-FW-002", "name": "Ensure Default Deny Firewall Policy", "validator": "validator-firewall", "techniques": ["T1562.004"], "tactics": ["Defense Evasion"]},
    {"id": "CH-FS-001", "name": "Ensure /tmp is a Separate Partition", "validator": "validator-filesystem", "techniques": ["T1036"], "tactics": ["Defense Evasion"]},
    {"id": "CH-FS-002", "name": "Ensure noexec on /tmp", "validator": "validator-filesystem", "techniques": ["T1059"], "tactics": ["Execution"]},
    {"id": "CH-AUD-001", "name": "Ensure auditd is Installed and Running", "validator": "validator-audit", "techniques": ["T1562.002"], "tactics": ["Defense Evasion"]},
    {"id": "CH-AUD-002", "name": "Ensure Audit Logs are Not Automatically Deleted", "validator": "validator-audit", "techniques": ["T1070.002"], "tactics": ["Defense Evasion"]},
    {"id": "CH-PWD-001", "name": "Ensure Password Minimum Length is 14", "validator": "validator-password-policy", "techniques": ["T1110.001"], "tactics": ["Credential Access"]},
    {"id": "CH-SUID-001", "name": "Ensure No World-Writable SUID Programs", "validator": "validator-permissions", "techniques": ["T1548.001"], "tactics": ["Privilege Escalation"]},
    {"id": "CH-SUID-002", "name": "Ensure No Unowned Files or Directories", "validator": "validator-permissions", "techniques": ["T1222.002"], "tactics": ["Defense Evasion"]},
    {"id": "CH-SVC-001", "name": "Ensure Unnecessary Services are Disabled", "validator": "validator-services", "techniques": ["T1543.002"], "tactics": ["Persistence"]},
    {"id": "CH-CRON-001", "name": "Ensure Cron Daemon is Enabled and Running", "validator": "validator-cron", "techniques": ["T1053.003"], "tactics": ["Persistence", "Execution"]},
]

MULTISTAGE_TESTS = [
    {
        "name": "DPRK BlueNoroff Financial Sector Attack Chain",
        "category": "intel-driven",
        "threat_actor": "Lazarus Group",
        "stages": [
            {"id": "T1566.001", "name": "Spearphishing Attachment Delivery", "validator": "stage1-initial-access", "techniques": ["T1566.001"], "tactics": ["Initial Access"]},
            {"id": "T1059.001", "name": "PowerShell Payload Execution", "validator": "stage2-execution", "techniques": ["T1059.001"], "tactics": ["Execution"]},
            {"id": "T1055.001", "name": "Process Injection for Evasion", "validator": "stage3-defense-evasion", "techniques": ["T1055.001"], "tactics": ["Defense Evasion"]},
            {"id": "T1003.001", "name": "LSASS Credential Dump", "validator": "stage4-credential-access", "techniques": ["T1003.001"], "tactics": ["Credential Access"]},
            {"id": "T1041", "name": "C2 Data Exfiltration", "validator": "stage5-exfiltration", "techniques": ["T1041"], "tactics": ["Exfiltration"]},
        ],
    },
    {
        "name": "ESXi Hypervisor Ransomware Kill Chain (RansomHub/Akira)",
        "category": "intel-driven",
        "threat_actor": "RansomHub",
        "stages": [
            {"id": "T1190", "name": "Exploit Public-Facing Application", "validator": "stage1-exploit", "techniques": ["T1190"], "tactics": ["Initial Access"]},
            {"id": "T1021.004", "name": "SSH Lateral Movement", "validator": "stage2-lateral", "techniques": ["T1021.004"], "tactics": ["Lateral Movement"]},
            {"id": "T1562.001", "name": "Disable ESXi Firewall", "validator": "stage3-defense-evasion", "techniques": ["T1562.001"], "tactics": ["Defense Evasion"]},
            {"id": "T1486", "name": "VM Encryption (Ransomware)", "validator": "stage4-impact", "techniques": ["T1486"], "tactics": ["Impact"]},
        ],
    },
]

BUNDLE_TESTS = [
    {
        "name": "CIS Windows Endpoint Level 1 Hardening Bundle",
        "category": "cyber-hygiene",
        "controls": CIS_WINDOWS_CONTROLS,
        "protection_rate": 0.55,
    },
    {
        "name": "CIS Linux Endpoint Level 1 Hardening Bundle",
        "category": "cyber-hygiene",
        "controls": CIS_LINUX_CONTROLS,
        "protection_rate": 0.60,
    },
]

ERROR_TYPES = [
    # --- Conclusive: unprotected ---
    {"code": 101, "name": "Unprotected"},
    # --- Conclusive: protected ---
    {"code": 105, "name": "FileQuarantinedOnExtraction"},
    {"code": 126, "name": "ExecutionPrevented"},
    {"code": 127, "name": "QuarantinedOnExecution"},
    # --- Inconclusive / error ---
    {"code": 0,   "name": "NormalExit"},
    {"code": 259, "name": "StillActive"},
    {"code": 999, "name": "UnexpectedTestError"},
]

PROTECTED_CODES = [105, 126, 127]
UNPROTECTED_CODES = [101]
INCONCLUSIVE_CODES = [0, 259, 999]

# =============================================================================
# Data Generation Functions
# =============================================================================

def generate_timestamp(days_back=30):
    """Generate a random timestamp within the last N days."""
    now = datetime.utcnow()
    random_offset = timedelta(
        days=random.randint(0, days_back),
        hours=random.randint(0, 23),
        minutes=random.randint(0, 59),
        seconds=random.randint(0, 59)
    )
    return (now - random_offset).isoformat() + "Z"


def determine_protection_status(test, org_index):
    """
    Determine if the test was blocked or bypassed.
    Uses weighted randomness based on severity and organization.
    Higher severity = lower protection rate (more realistic).
    """
    # Base protection rates by severity
    severity_rates = {
        "critical": 0.45,  # 45% blocked
        "high": 0.60,      # 60% blocked
        "medium": 0.75,    # 75% blocked
        "low": 0.85,       # 85% blocked
        "info": 0.95,      # 95% blocked
    }

    # Org modifiers (some orgs have better security)
    org_modifiers = [0.05, 0.0, -0.05]  # SB better, TPSGL baseline, RGA worse

    base_rate = severity_rates.get(test["severity"], 0.70)
    modified_rate = base_rate + org_modifiers[org_index]

    return random.random() < modified_rate


def select_error_type(is_protected):
    """Select an appropriate error type based on protection status.

    ~90% of results are conclusive (drive the defense score),
    ~10% are inconclusive/error (drive the error rate).
    """
    _by_code = {e["code"]: e for e in ERROR_TYPES}

    # 10% chance of an inconclusive / error result regardless of protection
    if random.random() < 0.10:
        code = random.choices(INCONCLUSIVE_CODES, weights=[0.5, 0.3, 0.2])[0]
        return _by_code[code]

    if is_protected:
        # Protected — pick among the three protection codes
        code = random.choices(PROTECTED_CODES, weights=[0.25, 0.45, 0.30])[0]
        return _by_code[code]
    else:
        # Unprotected — attack succeeded
        return _by_code[101]


def generate_execution(test, org, hostname, timestamp):
    """Generate a single test execution document."""
    org_index = ORGANIZATIONS.index(org)
    is_protected = determine_protection_status(test, org_index)
    error = select_error_type(is_protected)

    # Calculate score with some variance
    score = test["base_score"] + random.uniform(-0.5, 0.5)
    score = max(1.0, min(10.0, score))  # Clamp to 1-10

    # Select a random threat actor from the test's associated actors
    threat_actor = random.choice(test["threat_actors"]) if test["threat_actors"] else None

    # is_protected should agree with the error code, not the random roll
    actually_protected = error["code"] in PROTECTED_CODES

    return {
        "routing": {
            "event_time": timestamp,
            "oid": org["uuid"],
            "hostname": hostname,
        },
        "f0rtika": {
            "test_uuid": str(uuid.uuid5(TEST_UUID_NAMESPACE, test["name"])),
            "test_name": test["name"],
            "is_protected": actually_protected,
            "techniques": test["techniques"],
            "error_name": error["name"],
            # Enriched fields
            "category": test["category"],
            "subcategory": test["subcategory"],
            "severity": test["severity"],
            "tactics": test["tactics"],
            "target": test["target"],
            "complexity": test["complexity"],
            "threat_actor": threat_actor,
            "tags": test["tags"],
            "score": round(score, 1),
        },
        "event": {
            "ERROR": error["code"],
        }
    }


def generate_bundle_execution(bundle, org, hostname, timestamp, index_name):
    """Generate bundle control documents for a CIS bundle or multi-stage test."""
    lines = []
    bundle_id = str(uuid.uuid4())
    controls = bundle.get("controls") or bundle.get("stages", [])
    category = bundle["category"]
    protection_rate = bundle.get("protection_rate", 0.30)
    threat_actor = bundle.get("threat_actor")

    for ctrl in controls:
        # For cyber-hygiene bundles: weighted by protection_rate
        # For multi-stage: stage 0 (skipped) exit_code=0, rest weighted
        is_stage = "stages" in bundle
        if is_stage and ctrl == controls[0]:
            # First stage of multi-stage is often skipped (exit_code=0)
            error_code = 0 if random.random() < 0.7 else 101
        else:
            is_protected = random.random() < protection_rate
            error_code = random.choice(PROTECTED_CODES) if is_protected else 101

        actually_protected = error_code in PROTECTED_CODES

        doc = {
            "routing": {
                "event_time": timestamp,
                "oid": org["uuid"],
                "hostname": hostname,
            },
            "f0rtika": {
                "test_uuid": f"{bundle_id}::{ctrl['id']}",
                "test_name": ctrl["name"],
                "is_protected": actually_protected,
                "error_name": next((e["name"] for e in ERROR_TYPES if e["code"] == error_code), "Unknown"),
                "category": category,
                "severity": "medium" if category == "cyber-hygiene" else "high",
                "techniques": ctrl.get("techniques", []),
                "tactics": ctrl.get("tactics", []),
                "threat_actor": threat_actor or random.choice(["APT29", "APT28", "Lazarus Group"]),
                "bundle_id": bundle_id,
                "bundle_name": bundle["name"],
                "control_id": ctrl["id"],
                "control_validator": ctrl.get("validator", ""),
                "is_bundle_control": True,
            },
            "event": {
                "ERROR": error_code,
            },
        }

        action = {"index": {"_index": index_name}}
        lines.append(json.dumps(action))
        lines.append(json.dumps(doc))

    return lines


def generate_bulk_data(count, index_name="achilles-results-synthetic", days_back=30):
    """Generate NDJSON bulk data for Elasticsearch.

    In addition to standalone test results, generates ~20% of the count as
    bundle control documents (CIS bundles and multi-stage attack chains).
    """
    lines = []

    # Generate bundle executions (~20% of requested count)
    all_bundles = BUNDLE_TESTS + MULTISTAGE_TESTS
    bundle_count = max(4, count // 50)  # ~2% as bundle executions, each with many controls
    doc_count = 0

    for i in range(bundle_count):
        bundle = random.choice(all_bundles)
        org = random.choice(ORGANIZATIONS)
        hostname = random.choice(HOSTNAMES)
        timestamp = generate_timestamp(days_back=days_back)
        bundle_lines = generate_bundle_execution(bundle, org, hostname, timestamp, index_name)
        lines.extend(bundle_lines)
        doc_count += len(bundle_lines) // 2  # 2 lines per doc (action + doc)

    print(f"Generated {doc_count} bundle control documents from {bundle_count} bundle executions")

    # Generate standalone test results for the remaining count
    standalone_count = max(0, count - doc_count)
    for i in range(standalone_count):
        test = random.choice(TESTS)
        org = random.choice(ORGANIZATIONS)
        hostname = random.choice(HOSTNAMES)
        timestamp = generate_timestamp(days_back=days_back)

        doc = generate_execution(test, org, hostname, timestamp)

        action = {"index": {"_index": index_name}}
        lines.append(json.dumps(action))
        lines.append(json.dumps(doc))

        if (i + 1) % 1000 == 0:
            print(f"Generated {doc_count + i + 1}/{count} documents...")

    return "\n".join(lines) + "\n"


def generate_json_array(count, days_back=30):
    """Generate a JSON array of documents (for easier inspection)."""
    docs = []

    for i in range(count):
        test = random.choice(TESTS)
        org = random.choice(ORGANIZATIONS)
        hostname = random.choice(HOSTNAMES)
        timestamp = generate_timestamp(days_back=days_back)

        doc = generate_execution(test, org, hostname, timestamp)
        docs.append(doc)

        if (i + 1) % 1000 == 0:
            print(f"Generated {i + 1}/{count} documents...")

    return docs


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate synthetic test execution data for Elasticsearch"
    )
    parser.add_argument(
        "--count", "-c",
        type=int,
        default=1000,
        help="Number of documents to generate (default: 1000)"
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="synthetic_data.ndjson",
        help="Output file path (default: synthetic_data.ndjson)"
    )
    parser.add_argument(
        "--index", "-i",
        type=str,
        default="achilles-results-synthetic",
        help="Elasticsearch index name (default: achilles-results-synthetic)"
    )
    parser.add_argument(
        "--format", "-f",
        choices=["ndjson", "json"],
        default="ndjson",
        help="Output format: ndjson (bulk) or json (array)"
    )
    parser.add_argument(
        "--days", "-d",
        type=int,
        default=30,
        help="Number of days back to spread timestamps (default: 30)"
    )

    args = parser.parse_args()

    print(f"Generating {args.count} synthetic documents...")
    print(f"Index: {args.index}")
    print(f"Format: {args.format}")
    print(f"Days back: {args.days}")
    print()

    if args.format == "ndjson":
        data = generate_bulk_data(args.count, args.index, days_back=args.days)
    else:
        docs = generate_json_array(args.count, days_back=args.days)
        data = json.dumps(docs, indent=2)

    with open(args.output, "w") as f:
        f.write(data)

    print()
    print(f"Data written to: {args.output}")
    print()

    if args.format == "ndjson":
        print("To upload to Elasticsearch, run:")
        print()
        print("  # For Elastic Cloud:")
        print(f"  curl -X POST 'https://<your-cloud-id>.es.us-east-1.aws.elastic.cloud:443/{args.index}/_bulk' \\")
        print("       -H 'Authorization: ApiKey <your-api-key>' \\")
        print("       -H 'Content-Type: application/x-ndjson' \\")
        print(f"       --data-binary @{args.output}")
        print()
        print("  # For self-hosted:")
        print(f"  curl -X POST 'http://localhost:9200/{args.index}/_bulk' \\")
        print("       -H 'Content-Type: application/x-ndjson' \\")
        print(f"       --data-binary @{args.output}")
        print()
        print("  # Or use the upload script:")
        print(f"  python upload_to_elasticsearch.py --file {args.output}")


if __name__ == "__main__":
    main()
