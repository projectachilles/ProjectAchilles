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


def create_index_mapping(es_client, index_name):
    """Create index with mappings matching ES dynamic mapping behaviour.

    String fields use text + keyword sub-field so the analytics service
    can query ``f0rtika.test_name.keyword`` for exact-match aggregations
    — the same layout ES would create automatically for real agent data.
    """
    kw_field = {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 256}}}

    mapping = {
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
                        "test_uuid": kw_field,
                        "test_name": kw_field,
                        "is_protected": {"type": "boolean"},
                        "techniques": kw_field,
                        "error_name": kw_field,
                        "category": kw_field,
                        "subcategory": kw_field,
                        "severity": kw_field,
                        "tactics": kw_field,
                        "target": kw_field,
                        "complexity": kw_field,
                        "threat_actor": kw_field,
                        "tags": kw_field,
                        "score": {"type": "float"}
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

    try:
        if not es_client.indices.exists(index=index_name):
            es_client.indices.create(index=index_name, body=mapping)
            print(f"Created index '{index_name}' with mappings")
        else:
            print(f"Index '{index_name}' already exists")
    except Exception as e:
        print(f"Warning: Could not create index mapping: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Upload NDJSON bulk data to Elasticsearch"
    )
    parser.add_argument(
        "--file", "-f",
        type=str,
        required=True,
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
        help="Create index with mappings before uploading"
    )
    parser.add_argument(
        "--index",
        type=str,
        default="achilles-results-synthetic",
        help="Index name (default: achilles-results-synthetic)"
    )

    args = parser.parse_args()

    # Validate file exists
    if not Path(args.file).exists():
        print(f"Error: File not found: {args.file}")
        sys.exit(1)

    # Determine connection method
    if args.cloud_id and args.api_key:
        print(f"Connecting to Elastic Cloud...")
        if HAS_ES_CLIENT:
            es = Elasticsearch(
                cloud_id=args.cloud_id,
                api_key=args.api_key
            )
            if args.create_index:
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

            if args.create_index:
                create_index_mapping(es, args.index)
            upload_with_es_client(args.file, es, args.chunk_size)

        elif HAS_REQUESTS:
            auth_header = None
            if args.api_key:
                auth_header = f"ApiKey {args.api_key}"
            elif args.username and args.password:
                import base64
                credentials = base64.b64encode(f"{args.username}:{args.password}".encode()).decode()
                auth_header = f"Basic {credentials}"

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
