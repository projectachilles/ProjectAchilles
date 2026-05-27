#!/usr/bin/env bash
# JSON state machinery for resumable deploys.
# Requires lib/common.sh sourced first, and jq in PATH.
#
# State file: $STATE_DIR/<tenant>.state.json
# Schema:
#   {
#     "tenant": "...",
#     "fqdn_spa": "...",
#     "fqdn_agent": "...",
#     "region": "...",
#     "phases_completed": ["preflight", "collect", ...],
#     "vpc_id": "...",
#     "backend_droplet": { "id": ..., "public_ip": "...", "private_ip": "...", "tailnet_ip": "..." },
#     "es_droplet": { ... },
#     "created_at": "ISO-8601",
#     "updated_at": "ISO-8601"
#   }

state_file_for() {
    local tenant="$1"
    echo "$STATE_DIR/$tenant.state.json"
}

# state_init <tenant>  — create empty state file if it doesn't exist
state_init() {
    local tenant="$1"
    local file
    file=$(state_file_for "$tenant")
    if [[ ! -f "$file" ]]; then
        local now
        now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        jq -n --arg t "$tenant" --arg n "$now" \
            '{tenant: $t, phases_completed: [], created_at: $n, updated_at: $n}' \
            > "$file"
        chmod 600 "$file"
    fi
    echo "$file"
}

# state_get <tenant> <jq-path>  — read a value via jq path
# Returns empty string if path missing.
state_get() {
    local tenant="$1"
    local path="$2"
    local file
    file=$(state_file_for "$tenant")
    if [[ ! -f "$file" ]]; then
        echo ""
        return
    fi
    jq -r "$path // \"\"" "$file" 2>/dev/null || echo ""
}

# state_set <tenant> <jq-path> <value>  — set a string value
# For complex types, use state_set_json.
state_set() {
    local tenant="$1"
    local path="$2"
    local value="$3"
    local file tmp now
    file=$(state_init "$tenant")
    tmp="${file}.tmp.$$"
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    jq --arg v "$value" --arg n "$now" "$path = \$v | .updated_at = \$n" "$file" > "$tmp"
    mv "$tmp" "$file"
    chmod 600 "$file"
}

# state_set_json <tenant> <jq-path> <json-value>  — set a JSON object/array/number
state_set_json() {
    local tenant="$1"
    local path="$2"
    local json="$3"
    local file tmp now
    file=$(state_init "$tenant")
    tmp="${file}.tmp.$$"
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    jq --argjson v "$json" --arg n "$now" "$path = \$v | .updated_at = \$n" "$file" > "$tmp"
    mv "$tmp" "$file"
    chmod 600 "$file"
}

# state_mark_phase <tenant> <phase>  — append phase to phases_completed (idempotent)
state_mark_phase() {
    local tenant="$1"
    local phase="$2"
    local file tmp now
    file=$(state_init "$tenant")
    tmp="${file}.tmp.$$"
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    # Append phase only if not already present (preserves insertion order).
    jq --arg p "$phase" --arg n "$now" \
        'if ((.phases_completed // []) | index($p)) then . else .phases_completed = ((.phases_completed // []) + [$p]) end | .updated_at = $n' \
        "$file" > "$tmp"
    mv "$tmp" "$file"
    chmod 600 "$file"
}

# state_phase_complete <tenant> <phase>  — exit 0 if phase done, 1 otherwise
state_phase_complete() {
    local tenant="$1"
    local phase="$2"
    local file
    file=$(state_file_for "$tenant")
    [[ -f "$file" ]] || return 1
    jq -e --arg p "$phase" '(.phases_completed // []) | index($p) != null' "$file" >/dev/null 2>&1
}

# state_last_phase <tenant>  — print the last completed phase (or "" if none)
state_last_phase() {
    local tenant="$1"
    local file
    file=$(state_file_for "$tenant")
    [[ -f "$file" ]] || return 0
    jq -r '(.phases_completed // []) | last // ""' "$file"
}

# state_dump <tenant>  — pretty-print the state file
state_dump() {
    local tenant="$1"
    local file
    file=$(state_file_for "$tenant")
    [[ -f "$file" ]] || { echo "(no state file)"; return; }
    jq . "$file"
}

# state_reset <tenant>  — delete the state file (use with care)
state_reset() {
    local tenant="$1"
    local file
    file=$(state_file_for "$tenant")
    [[ -f "$file" ]] && rm -f "$file"
}
