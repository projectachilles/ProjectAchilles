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


def generate_bulk_data(count, index_name="achilles-results-synthetic", days_back=30):
    """Generate NDJSON bulk data for Elasticsearch."""
    lines = []

    for i in range(count):
        # Select random components
        test = random.choice(TESTS)
        org = random.choice(ORGANIZATIONS)
        hostname = random.choice(HOSTNAMES)
        timestamp = generate_timestamp(days_back=days_back)

        # Generate the execution document
        doc = generate_execution(test, org, hostname, timestamp)

        # Create bulk action and document lines
        action = {"index": {"_index": index_name}}
        lines.append(json.dumps(action))
        lines.append(json.dumps(doc))

        if (i + 1) % 1000 == 0:
            print(f"Generated {i + 1}/{count} documents...")

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
