#!/usr/bin/env python3
"""
Upload NDJSON bulk data to Elasticsearch.
Supports both Elastic Cloud and self-hosted instances.

Usage:
    # Using environment variables
    export ES_CLOUD_ID="your-cloud-id"
    export ES_API_KEY="your-api-key"
    python upload_to_elasticsearch.py --file synthetic_data.ndjson

    # Using command line arguments
    python upload_to_elasticsearch.py --file synthetic_data.ndjson --cloud-id "..." --api-key "..."

    # For self-hosted
    python upload_to_elasticsearch.py --file synthetic_data.ndjson --host "http://localhost:9200"

    # Create all indices (results, defender, risk-acceptance) without uploading data
    python upload_to_elasticsearch.py --init-indices --host "http://localhost:9200"

    # Create results index with data upload
    python upload_to_elasticsearch.py --file data.ndjson --create-index --host "http://localhost:9200"
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    from elasticsearch import Elasticsearch, helpers
    HAS_ES_CLIENT = True
except ImportError:
    HAS_ES_CLIENT = False

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


def upload_with_es_client(file_path, es_client, chunk_size=500):
    """Upload using the official Elasticsearch Python client."""
    print("Using Elasticsearch Python client...")

    # Read and parse NDJSON
    actions = []
    with open(file_path, 'r') as f:
        lines = f.readlines()

    # NDJSON bulk format: action line, then document line
    for i in range(0, len(lines) - 1, 2):
        action_line = lines[i].strip()
        doc_line = lines[i + 1].strip()

        if not action_line or not doc_line:
            continue

        action = json.loads(action_line)
        doc = json.loads(doc_line)

        # Extract index name from action
        index_name = action.get('index', {}).get('_index', 'achilles-results-synthetic')

        actions.append({
            '_index': index_name,
            '_source': doc
        })

    print(f"Parsed {len(actions)} documents from {file_path}")
    print(f"Uploading in chunks of {chunk_size}...")

    # Use bulk helper for efficient uploading
    success_count = 0
    error_count = 0

    for ok, result in helpers.streaming_bulk(
        es_client,
        actions,
        chunk_size=chunk_size,
        raise_on_error=False
    ):
        if ok:
            success_count += 1
        else:
            error_count += 1
            if error_count <= 5:  # Only show first 5 errors
                print(f"Error: {result}")

        if (success_count + error_count) % 1000 == 0:
            print(f"Progress: {success_count + error_count}/{len(actions)}")

    print()
    print(f"Upload complete!")
    print(f"  Successful: {success_count}")
    print(f"  Errors: {error_count}")

    return success_count, error_count


def upload_with_requests(file_path, host, auth_header=None, chunk_size=5000):
    """Upload using raw HTTP requests (fallback method)."""
    print("Using HTTP requests...")

    # Read file content
    with open(file_path, 'r') as f:
        content = f.read()

    lines = content.strip().split('\n')
    total_docs = len(lines) // 2

    print(f"Total documents: {total_docs}")
    print(f"Uploading in chunks of {chunk_size} documents...")

    headers = {'Content-Type': 'application/x-ndjson'}
    if auth_header:
        headers['Authorization'] = auth_header

    success_count = 0
    error_count = 0

    # Process in chunks
    for chunk_start in range(0, len(lines), chunk_size * 2):
        chunk_end = min(chunk_start + chunk_size * 2, len(lines))
        chunk_lines = lines[chunk_start:chunk_end]

        # Ensure we have complete pairs
        if len(chunk_lines) % 2 != 0:
            chunk_lines = chunk_lines[:-1]

        if not chunk_lines:
            continue

        chunk_data = '\n'.join(chunk_lines) + '\n'

        # Extract index from first action
        first_action = json.loads(chunk_lines[0])
        index_name = first_action.get('index', {}).get('_index', 'achilles-results-synthetic')

        url = f"{host.rstrip('/')}/{index_name}/_bulk"

        try:
            response = requests.post(url, headers=headers, data=chunk_data)
            result = response.json()

            if response.status_code == 200:
                items = result.get('items', [])
                for item in items:
                    if item.get('index', {}).get('status', 500) < 300:
                        success_count += 1
                    else:
                        error_count += 1
            else:
                print(f"HTTP Error {response.status_code}: {response.text[:200]}")
                error_count += len(chunk_lines) // 2

        except Exception as e:
            print(f"Request error: {e}")
            error_count += len(chunk_lines) // 2

        docs_processed = (chunk_start // 2) + (len(chunk_lines) // 2)
        print(f"Progress: {docs_processed}/{total_docs}")

    print()
    print(f"Upload complete!")
    print(f"  Successful: {success_count}")
    print(f"  Errors: {error_count}")

    return success_count, error_count


def get_results_index_mapping():
    """Return the results index mapping matching the TypeScript source of truth.

    Source: backend/src/services/analytics/index-management.service.ts
    All string fields use pure keyword type (no text + keyword sub-field).
    """
    kw = {"type": "keyword"}

    return {
        "mappings": {
            "properties": {
                "routing": {
                    "properties": {
                        "event_time": {"type": "date"},
                        "oid": {"type": "keyword"},
                        "hostname": {"type": "keyword"}
                    }
                },
                "f0rtika": {
                    "properties": {
                        "test_uuid": kw,
                        "test_name": kw,
                        "is_protected": {"type": "boolean"},
                        "error_name": kw,
                        "category": kw,
                        "subcategory": kw,
                        "severity": kw,
                        "techniques": kw,
                        "tactics": kw,
                        "target": kw,
                        "complexity": kw,
                        "threat_actor": kw,
                        "tags": kw,
                        "score": {"type": "float"},
                        "bundle_id": kw,
                        "bundle_name": kw,
                        "control_id": kw,
                        "control_validator": kw,
                        "is_bundle_control": {"type": "boolean"},
                        "tenant_label": kw
                    }
                },
                "event": {
                    "properties": {
                        "ERROR": {"type": "integer"}
                    }
                }
            }
        }
    }


def get_defender_index_mapping():
    """Return the defender index mapping matching the TypeScript source of truth.

    Source: backend/src/services/defender/index-management.ts
    Single index with doc_type discriminator for secure_score, control_profile, alert.
    """
    return {
        "mappings": {
            "properties": {
                "doc_type": {"type": "keyword"},
                "timestamp": {"type": "date"},
                "tenant_id": {"type": "keyword"},

                # Secure Score fields
                "current_score": {"type": "float"},
                "max_score": {"type": "float"},
                "score_percentage": {"type": "float"},
                "control_scores": {
                    "type": "nested",
                    "properties": {
                        "name": {"type": "keyword"},
                        "category": {"type": "keyword"},
                        "score": {"type": "float"}
                    }
                },
                "average_comparative_score": {"type": "float"},

                # Control Profile fields
                "control_name": {"type": "keyword"},
                "control_category": {"type": "keyword"},
                "title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                "implementation_cost": {"type": "keyword"},
                "user_impact": {"type": "keyword"},
                "rank": {"type": "integer"},
                "threats": {"type": "keyword"},
                "deprecated": {"type": "boolean"},
                "remediation_summary": {"type": "text"},
                "action_url": {"type": "keyword"},
                "tier": {"type": "keyword"},

                # Alert fields
                "alert_id": {"type": "keyword"},
                "alert_title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                "description": {"type": "text"},
                "severity": {"type": "keyword"},
                "status": {"type": "keyword"},
                "category": {"type": "keyword"},
                "service_source": {"type": "keyword"},
                "mitre_techniques": {"type": "keyword"},
                "created_at": {"type": "date"},
                "updated_at": {"type": "date"},
                "resolved_at": {"type": "date"},
                "recommended_actions": {"type": "text"},
                "evidence_hostnames": {"type": "keyword"},
                "evidence_filenames": {"type": "keyword"}
            }
        }
    }


def get_risk_acceptance_mapping():
    """Return the risk acceptance index mapping matching the TypeScript source of truth.

    Source: backend/src/services/risk-acceptance/index-management.ts
    Immutable audit trail for risk acceptance records.
    """
    return {
        "mappings": {
            "properties": {
                "acceptance_id": {"type": "keyword"},
                "test_name": {"type": "keyword"},
                "control_id": {"type": "keyword"},
                "hostname": {"type": "keyword"},
                "scope": {"type": "keyword"},
                "justification": {"type": "text"},
                "accepted_by": {"type": "keyword"},
                "accepted_by_name": {"type": "keyword"},
                "accepted_at": {"type": "date"},
                "status": {"type": "keyword"},
                "revoked_at": {"type": "date"},
                "revoked_by": {"type": "keyword"},
                "revoked_by_name": {"type": "keyword"},
                "revocation_reason": {"type": "text"}
            }
        }
    }


def create_index_with_requests(session, host, index_name, mapping, api_key=None):
    """Create an ES index using raw HTTP PUT (requests fallback).

    Handles 400 'resource_already_exists_exception' as a no-op.
    Returns (created: bool, message: str).
    """
    url = f"{host.rstrip('/')}/{index_name}"
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = f"ApiKey {api_key}"

    try:
        response = session.put(url, headers=headers, json=mapping)
        if response.status_code == 200:
            return True, f"Created index '{index_name}' with mappings"
        elif response.status_code == 400:
            # Index already exists
            return False, f"Index '{index_name}' already exists"
        else:
            return False, f"Failed to create index '{index_name}': HTTP {response.status_code} — {response.text[:200]}"
    except Exception as e:
        return False, f"Failed to create index '{index_name}': {e}"


def create_index_mapping(es_client, index_name):
    """Create results index with mappings using the ES Python client."""
    mapping = get_results_index_mapping()

    try:
        if not es_client.indices.exists(index=index_name):
            es_client.indices.create(index=index_name, body=mapping)
            print(f"Created index '{index_name}' with mappings")
        else:
            print(f"Index '{index_name}' already exists")
    except Exception as e:
        print(f"Warning: Could not create index mapping: {e}")


def create_defender_index_mapping(es_client_or_session, index_name="achilles-defender", host=None, api_key=None):
    """Create the Defender index with mappings.

    Supports both the elasticsearch Python client and the requests fallback.
    When host is provided, uses requests; otherwise assumes es_client_or_session
    is an Elasticsearch client instance.
    """
    mapping = get_defender_index_mapping()

    if host is not None:
        # requests fallback
        created, msg = create_index_with_requests(es_client_or_session, host, index_name, mapping, api_key)
        print(msg)
        return created
    else:
        # ES Python client
        try:
            if not es_client_or_session.indices.exists(index=index_name):
                es_client_or_session.indices.create(index=index_name, body=mapping)
                print(f"Created index '{index_name}' with mappings")
                return True
            else:
                print(f"Index '{index_name}' already exists")
                return False
        except Exception as e:
            print(f"Warning: Could not create defender index mapping: {e}")
            return False


def create_risk_acceptance_mapping(es_client_or_session, index_name="achilles-risk-acceptances", host=None, api_key=None):
    """Create the risk acceptance index with mappings.

    Supports both the elasticsearch Python client and the requests fallback.
    When host is provided, uses requests; otherwise assumes es_client_or_session
    is an Elasticsearch client instance.
    """
    mapping = get_risk_acceptance_mapping()

    if host is not None:
        # requests fallback
        created, msg = create_index_with_requests(es_client_or_session, host, index_name, mapping, api_key)
        print(msg)
        return created
    else:
        # ES Python client
        try:
            if not es_client_or_session.indices.exists(index=index_name):
                es_client_or_session.indices.create(index=index_name, body=mapping)
                print(f"Created index '{index_name}' with mappings")
                return True
            else:
                print(f"Index '{index_name}' already exists")
                return False
        except Exception as e:
            print(f"Warning: Could not create risk acceptance index mapping: {e}")
            return False


def _init_all_indices_es(es_client, results_index):
    """Create all three index types using the ES Python client."""
    print("--- Initializing results index ---")
    create_index_mapping(es_client, results_index)
    print("--- Initializing defender index ---")
    create_defender_index_mapping(es_client)
    print("--- Initializing risk acceptance index ---")
    create_risk_acceptance_mapping(es_client)


def _init_all_indices_requests(session, host, results_index, api_key=None):
    """Create all three index types using the requests fallback."""
    print("--- Initializing results index ---")
    mapping = get_results_index_mapping()
    _, msg = create_index_with_requests(session, host, results_index, mapping, api_key)
    print(msg)
    print("--- Initializing defender index ---")
    create_defender_index_mapping(session, host=host, api_key=api_key)
    print("--- Initializing risk acceptance index ---")
    create_risk_acceptance_mapping(session, host=host, api_key=api_key)


def main():
    parser = argparse.ArgumentParser(
        description="Upload NDJSON bulk data to Elasticsearch"
    )
    parser.add_argument(
        "--file", "-f",
        type=str,
        default=None,
        help="Path to NDJSON file"
    )
    parser.add_argument(
        "--cloud-id",
        type=str,
        default=os.environ.get('ES_CLOUD_ID'),
        help="Elastic Cloud ID (or set ES_CLOUD_ID env var)"
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default=os.environ.get('ES_API_KEY'),
        help="Elasticsearch API key (or set ES_API_KEY env var)"
    )
    parser.add_argument(
        "--host",
        type=str,
        default=os.environ.get('ES_HOST'),
        help="Elasticsearch host URL for self-hosted (or set ES_HOST env var)"
    )
    parser.add_argument(
        "--username",
        type=str,
        default=os.environ.get('ES_USERNAME'),
        help="Elasticsearch username (or set ES_USERNAME env var)"
    )
    parser.add_argument(
        "--password",
        type=str,
        default=os.environ.get('ES_PASSWORD'),
        help="Elasticsearch password (or set ES_PASSWORD env var)"
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=500,
        help="Number of documents per bulk request (default: 500)"
    )
    parser.add_argument(
        "--create-index",
        action="store_true",
        help="Create results index with mappings before uploading"
    )
    parser.add_argument(
        "--init-indices",
        action="store_true",
        help="Create all index types (results, defender, risk-acceptance) and exit. Does not require --file."
    )
    parser.add_argument(
        "--index",
        type=str,
        default="achilles-results-synthetic",
        help="Index name for results (default: achilles-results-synthetic)"
    )

    args = parser.parse_args()

    # --init-indices does not require --file; all other modes do
    if not args.init_indices and not args.file:
        parser.error("--file is required unless --init-indices is used")

    # Validate file exists (only when a file is specified)
    if args.file and not Path(args.file).exists():
        print(f"Error: File not found: {args.file}")
        sys.exit(1)

    # --- Helper to build a requests session with auth ---
    def _make_requests_session():
        session = requests.Session()
        if args.api_key:
            session.headers['Authorization'] = f"ApiKey {args.api_key}"
        elif args.username and args.password:
            import base64
            credentials = base64.b64encode(f"{args.username}:{args.password}".encode()).decode()
            session.headers['Authorization'] = f"Basic {credentials}"
        return session

    # Determine connection method
    if args.cloud_id and args.api_key:
        print(f"Connecting to Elastic Cloud...")
        if HAS_ES_CLIENT:
            es = Elasticsearch(
                cloud_id=args.cloud_id,
                api_key=args.api_key
            )
            if args.init_indices:
                _init_all_indices_es(es, args.index)
                if not args.file:
                    return
            elif args.create_index:
                create_index_mapping(es, args.index)
            upload_with_es_client(args.file, es, args.chunk_size)
        else:
            print("Error: elasticsearch-py not installed. Install with: pip install elasticsearch")
            sys.exit(1)

    elif args.host:
        print(f"Connecting to {args.host}...")
        if HAS_ES_CLIENT:
            if args.username and args.password:
                es = Elasticsearch(
                    args.host,
                    basic_auth=(args.username, args.password)
                )
            elif args.api_key:
                es = Elasticsearch(args.host, api_key=args.api_key)
            else:
                es = Elasticsearch(args.host)

            if args.init_indices:
                _init_all_indices_es(es, args.index)
                if not args.file:
                    return
            elif args.create_index:
                create_index_mapping(es, args.index)
            upload_with_es_client(args.file, es, args.chunk_size)

        elif HAS_REQUESTS:
            session = _make_requests_session()
            auth_header = session.headers.get('Authorization')

            if args.init_indices:
                _init_all_indices_requests(session, args.host, args.index, args.api_key)
                if not args.file:
                    return
            elif args.create_index:
                mapping = get_results_index_mapping()
                _, msg = create_index_with_requests(session, args.host, args.index, mapping, args.api_key)
                print(msg)

            upload_with_requests(args.file, args.host, auth_header, args.chunk_size)
        else:
            print("Error: Neither elasticsearch-py nor requests is installed.")
            print("Install with: pip install elasticsearch")
            print("         or: pip install requests")
            sys.exit(1)

    else:
        print("Error: No connection details provided.")
        print()
        print("For Elastic Cloud, provide --cloud-id and --api-key")
        print("For self-hosted, provide --host")
        print()
        print("You can also set environment variables:")
        print("  ES_CLOUD_ID, ES_API_KEY, ES_HOST, ES_USERNAME, ES_PASSWORD")
        sys.exit(1)


if __name__ == "__main__":
    main()
