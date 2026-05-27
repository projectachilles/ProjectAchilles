#!/usr/bin/env bash
# Phase 5: install_es — install Elasticsearch 8.17 on the ES droplet and
# generate a scoped API key for the backend to use.

phase_install_es() {
    local es_pub es_priv ssh_key
    es_pub=$(state_get "$TENANT" ".es_droplet.public_ip")
    es_priv=$(state_get "$TENANT" ".es_droplet.private_ip")
    ssh_key=$(state_get "$TENANT" ".ssh_key_path")

    [[ -n "$es_pub" && -n "$es_priv" && -n "$ssh_key" ]] || fail "Missing ES state values"

    # Re-sync remote/ in case scripts were edited between phases.
    log_info "Syncing remote scripts to ES droplet"
    rsync_dir "$es_pub" "$ssh_key" "$SCRIPT_DIR/remote/" "/root/deploy-do-remote/"

    log_info "Running 20-es-install.sh on ES droplet (this takes ~3-5 minutes)"
    local es_out
    es_out=$(ssh_run "$es_pub" "$ssh_key" root \
        "PRIVATE_IP='$es_priv' bash /root/deploy-do-remote/20-es-install.sh")

    local api_key api_id api_fp elastic_pw
    api_key=$(echo "$es_out" | grep '^ES_API_KEY_BASE64='     | tail -1 | cut -d= -f2-)
    api_id=$( echo "$es_out" | grep '^ES_API_KEY_ID='         | tail -1 | cut -d= -f2-)
    api_fp=$( echo "$es_out" | grep '^ES_API_KEY_FINGERPRINT='| tail -1 | cut -d= -f2-)
    elastic_pw=$(echo "$es_out" | grep '^ELASTIC_PASSWORD='   | tail -1 | cut -d= -f2-)

    [[ -n "$api_key" ]] || { echo "$es_out" >&2; fail "ES install did not return an API key"; }

    state_set "$TENANT" ".es_api_key"            "$api_key"
    state_set "$TENANT" ".es_api_key_id"         "$api_id"
    state_set "$TENANT" ".es_api_key_fingerprint" "$api_fp"
    state_set "$TENANT" ".es_elastic_password"   "$elastic_pw"

    log_success "ES installed, API key fingerprint: $api_fp"
}
