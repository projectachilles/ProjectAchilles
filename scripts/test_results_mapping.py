"""Drift guard: the Python results mapping must contain every canonical f0rtika field."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from upload_to_elasticsearch import get_results_index_mapping

CANONICAL_F0RTIKA = {
    "test_uuid", "test_name", "is_protected", "error_name", "category", "subcategory",
    "severity", "techniques", "tactics", "target", "complexity", "threat_actor", "tags",
    "score", "bundle_id", "bundle_name", "control_id", "control_validator",
    "is_bundle_control", "defender_detected", "defender_stage_detected", "tenant_label",
}

def test_mapping_has_all_canonical_fields():
    props = get_results_index_mapping()["mappings"]["properties"]["f0rtika"]["properties"]
    missing = CANONICAL_F0RTIKA - set(props.keys())
    assert not missing, f"results mapping missing canonical fields: {sorted(missing)}"

if __name__ == "__main__":
    test_mapping_has_all_canonical_fields()
    print("OK: results mapping contains all canonical f0rtika fields")
