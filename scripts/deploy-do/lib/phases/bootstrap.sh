#!/usr/bin/env bash
# Phase 4: bootstrap — rsync remote scripts + run 00-bootstrap.sh on BOTH droplets.
# Runs serially (not parallel) for now — simpler debugging; both droplets are
# small enough that this completes in ~2-3 minutes.

phase_bootstrap() {
    local be_pub be_priv es_pub es_priv ssh_key ts_key pubkey
    be_pub=$(state_get "$TENANT" ".backend_droplet.public_ip")
    be_priv=$(state_get "$TENANT" ".backend_droplet.private_ip")
    es_pub=$(state_get "$TENANT" ".es_droplet.public_ip")
    es_priv=$(state_get "$TENANT" ".es_droplet.private_ip")
    ssh_key=$(state_get "$TENANT" ".ssh_key_path")
    ts_key=$(state_get "$TENANT" ".tailscale_auth_key")
    pubkey=$(state_get "$TENANT" ".ssh_pubkey")

    [[ -n "$be_pub" && -n "$es_pub" && -n "$ssh_key" && -n "$ts_key" ]] \
        || fail "Missing state values for bootstrap"

    # Wait for SSH on both
    ssh_clear_known_host "$be_pub"
    ssh_clear_known_host "$es_pub"
    ssh_wait_ready "$be_pub" "$ssh_key"
    ssh_wait_ready "$es_pub" "$ssh_key"

    local remote_dir="$SCRIPT_DIR/remote/"

    # ── Backend bootstrap ─────────────────────────────────────────────────
    log_info "Copying bootstrap script to backend droplet"
    rsync_dir "$be_pub" "$ssh_key" "$remote_dir" "/root/deploy-do-remote/"

    log_info "Running 00-bootstrap.sh on backend"
    local be_out
    be_out=$(ssh_run "$be_pub" "$ssh_key" root \
        "TS_AUTH_KEY='$ts_key' SSH_PUBKEY='$pubkey' HOSTNAME_LABEL='pa-${TENANT}-backend' ROLE='backend' bash /root/deploy-do-remote/00-bootstrap.sh")
    local be_ts_ip
    be_ts_ip=$(echo "$be_out" | grep '^TAILNET_IP=' | tail -1 | cut -d= -f2 || true)
    state_set "$TENANT" ".backend_droplet.tailnet_ip" "$be_ts_ip"
    log_success "Backend bootstrap complete (tailnet_ip=$be_ts_ip)"

    # ── ES bootstrap ──────────────────────────────────────────────────────
    log_info "Copying bootstrap script to ES droplet"
    rsync_dir "$es_pub" "$ssh_key" "$remote_dir" "/root/deploy-do-remote/"

    log_info "Running 00-bootstrap.sh on ES"
    local es_out
    es_out=$(ssh_run "$es_pub" "$ssh_key" root \
        "TS_AUTH_KEY='$ts_key' SSH_PUBKEY='$pubkey' HOSTNAME_LABEL='pa-${TENANT}-es' ROLE='es' BACKEND_PRIV_IP='$be_priv' bash /root/deploy-do-remote/00-bootstrap.sh")
    local es_ts_ip
    es_ts_ip=$(echo "$es_out" | grep '^TAILNET_IP=' | tail -1 | cut -d= -f2 || true)
    state_set "$TENANT" ".es_droplet.tailnet_ip" "$es_ts_ip"
    log_success "ES bootstrap complete (tailnet_ip=$es_ts_ip)"
}
