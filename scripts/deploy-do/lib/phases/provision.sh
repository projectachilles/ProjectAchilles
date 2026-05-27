#!/usr/bin/env bash
# Phase 3: provision — create VPC + 2 droplets + firewalls + project on DO.
# Pure doctl; no SSH yet.

phase_provision() {
    local region snapshots be_size es_size ssh_key_id
    region=$(state_get "$TENANT" ".region")
    snapshots=$(state_get "$TENANT" ".snapshots_enabled")
    be_size=$(state_get "$TENANT" ".backend_size")
    es_size=$(state_get "$TENANT" ".es_size")
    ssh_key_id=$(state_get "$TENANT" ".do_ssh_key_id")

    [[ -n "$region" && -n "$be_size" && -n "$es_size" && -n "$ssh_key_id" ]] \
        || fail "Missing required state values — re-run --reset and start fresh."

    # ── VPC ─────────────────────────────────────────────────────────────────
    local vpc_id
    vpc_id=$(doctl_ensure_vpc "$TENANT" "$region")
    [[ -n "$vpc_id" ]] || fail "VPC ID empty"
    state_set "$TENANT" ".vpc_id" "$vpc_id"

    # ── Backend droplet ─────────────────────────────────────────────────────
    local be_name="pa-${TENANT}-backend"
    local es_name="pa-${TENANT}-es"
    local tags="$(pa_tag "$TENANT"),pa-${TENANT}-backend"

    local be_id
    be_id=$(doctl_droplet_create \
        "$be_name" \
        "$be_size" \
        "$region" \
        "$vpc_id" \
        "$ssh_key_id" \
        "$tags" \
        "$snapshots")
    state_set "$TENANT" ".backend_droplet.id" "$be_id"

    local be_pub be_priv
    be_pub=$(doctl_droplet_public_ip "$be_id")
    be_priv=$(doctl_droplet_private_ip "$be_id")
    [[ -n "$be_pub" && -n "$be_priv" ]] || fail "Backend IPs not yet assigned"
    state_set "$TENANT" ".backend_droplet.public_ip" "$be_pub"
    state_set "$TENANT" ".backend_droplet.private_ip" "$be_priv"
    log_success "Backend droplet: public=$be_pub, private=$be_priv"

    # ── ES droplet ─────────────────────────────────────────────────────────
    local es_tags="$(pa_tag "$TENANT"),pa-${TENANT}-es"
    local es_id
    es_id=$(doctl_droplet_create \
        "$es_name" \
        "$es_size" \
        "$region" \
        "$vpc_id" \
        "$ssh_key_id" \
        "$es_tags" \
        "$snapshots")
    state_set "$TENANT" ".es_droplet.id" "$es_id"

    local es_pub es_priv
    es_pub=$(doctl_droplet_public_ip "$es_id")
    es_priv=$(doctl_droplet_private_ip "$es_id")
    [[ -n "$es_pub" && -n "$es_priv" ]] || fail "ES IPs not yet assigned"
    state_set "$TENANT" ".es_droplet.public_ip" "$es_pub"
    state_set "$TENANT" ".es_droplet.private_ip" "$es_priv"
    log_success "ES droplet: public=$es_pub, private=$es_priv"

    # ── Firewalls ──────────────────────────────────────────────────────────
    local fw_be fw_es
    fw_be=$(doctl_ensure_firewall_backend "$TENANT" "$be_id")
    state_set "$TENANT" ".firewall_backend_id" "$fw_be"

    fw_es=$(doctl_ensure_firewall_es "$TENANT" "$es_id" "$be_priv")
    state_set "$TENANT" ".firewall_es_id" "$fw_es"
    log_success "Firewalls configured (backend=$fw_be, es=$fw_es)"

    # ── Project grouping ──────────────────────────────────────────────────
    local proj_id
    proj_id=$(doctl_ensure_project "$TENANT")
    state_set "$TENANT" ".project_id" "$proj_id"
    doctl_project_assign "$proj_id" "$be_id" "$es_id"

    log_success "Provisioning complete."
}
