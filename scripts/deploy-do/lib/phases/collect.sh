#!/usr/bin/env bash
# Phase 2: collect — gather every input we need before touching DO.
# Cached in state file; re-runs skip already-collected items.

phase_collect() {
    local spa agent region clerk_pk clerk_sk ts_key be_size es_size confirm_cost

    # ── SPA FQDN ────────────────────────────────────────────────────────────
    spa=$(state_get "$TENANT" ".fqdn_spa")
    while [[ -z "$spa" ]]; do
        echo
        log_info "SPA FQDN: the customer-facing hostname (e.g. demo.acmecorp.com)"
        read -rp "  SPA FQDN: " spa
        if ! is_valid_fqdn "$spa"; then
            log_warn "Not a valid FQDN"
            spa=""
            continue
        fi
        dns_preflight_unused "$spa" || {
            confirm "Continue anyway?" || { spa=""; continue; }
        }
    done
    state_set "$TENANT" ".fqdn_spa" "$spa"
    log_success "SPA FQDN: $spa"

    # ── Agent (backend) FQDN ────────────────────────────────────────────────
    agent=$(state_get "$TENANT" ".fqdn_agent")
    while [[ -z "$agent" ]]; do
        echo
        log_info "Agent FQDN: backend hostname (convention: agent.<spa> or <tenant>.agent.<base>)"
        local suggested="agent.$spa"
        read -rp "  Agent FQDN [$suggested]: " agent
        agent="${agent:-$suggested}"
        if ! is_valid_fqdn "$agent"; then
            log_warn "Not a valid FQDN"
            agent=""
            continue
        fi
        if [[ "$agent" == "$spa" ]]; then
            log_warn "Agent FQDN must differ from SPA FQDN"
            agent=""
            continue
        fi
        dns_preflight_unused "$agent" || {
            confirm "Continue anyway?" || { agent=""; continue; }
        }
    done
    state_set "$TENANT" ".fqdn_agent" "$agent"
    log_success "Agent FQDN: $agent"

    # ── DO region ───────────────────────────────────────────────────────────
    region=$(state_get "$TENANT" ".region")
    if [[ -z "$region" ]]; then
        echo
        read -rp "  DO region [nyc3]: " region
        region="${region:-nyc3}"
    fi
    state_set "$TENANT" ".region" "$region"
    log_success "Region: $region"

    # ── Droplet sizes ───────────────────────────────────────────────────────
    be_size=$(state_get "$TENANT" ".backend_size")
    if [[ -z "$be_size" ]]; then
        echo
        log_info "Backend droplet size — 's-1vcpu-2gb' = \$12/mo, 50 GB SSD"
        read -rp "  Backend size [s-1vcpu-2gb]: " be_size
        be_size="${be_size:-s-1vcpu-2gb}"
    fi
    state_set "$TENANT" ".backend_size" "$be_size"

    es_size=$(state_get "$TENANT" ".es_size")
    if [[ -z "$es_size" ]]; then
        echo
        log_info "ES droplet size — 's-2vcpu-2gb-intel' = \$18/mo (extra vCPU helps indexing)"
        read -rp "  ES size [s-2vcpu-2gb-intel]: " es_size
        es_size="${es_size:-s-2vcpu-2gb-intel}"
    fi
    state_set "$TENANT" ".es_size" "$es_size"
    log_success "Sizes: backend=$be_size, es=$es_size"

    # ── DO snapshots (default ON) ────────────────────────────────────────────
    local snapshots
    snapshots=$(state_get "$TENANT" ".snapshots_enabled")
    if [[ -z "$snapshots" ]]; then
        echo
        log_info "DO weekly snapshots cost ~20% of droplet price (\$2.40 + \$3.60 = \$6/mo)."
        if confirm "Enable weekly snapshots?" y; then
            snapshots="true"
        else
            snapshots="false"
        fi
    fi
    state_set "$TENANT" ".snapshots_enabled" "$snapshots"

    # ── Clerk keys ──────────────────────────────────────────────────────────
    clerk_pk=$(state_get "$TENANT" ".clerk_pk")
    clerk_sk=$(state_get "$TENANT" ".clerk_sk")
    if [[ -z "$clerk_pk" || -z "$clerk_sk" ]]; then
        clerk_prompt_keys
        clerk_pk="$CLERK_PK"
        clerk_sk="$CLERK_SK"
        state_set "$TENANT" ".clerk_pk" "$clerk_pk"
        state_set "$TENANT" ".clerk_sk" "$clerk_sk"
    fi
    log_success "Clerk keys: ${clerk_pk:0:12}... / ${clerk_sk:0:12}..."

    # ── Tailscale auth key ──────────────────────────────────────────────────
    ts_key=$(state_get "$TENANT" ".tailscale_auth_key")
    while [[ -z "$ts_key" ]]; do
        echo
        log_info "Tailscale auth key — get one at:"
        log_info "  https://login.tailscale.com/admin/settings/keys"
        log_info "Recommend: reusable, ephemeral, pre-authorized, 90-day expiry."
        read -rsp "  Tailscale auth key (tskey-auth-...): " ts_key
        echo
        if [[ ! "$ts_key" =~ ^tskey-auth- ]]; then
            log_warn "Doesn't look like a Tailscale auth key (expected tskey-auth- prefix)"
            ts_key=""
            continue
        fi
    done
    state_set "$TENANT" ".tailscale_auth_key" "$ts_key"
    log_success "Tailscale key captured (${ts_key:0:18}...)"

    # ── Operator notification email for Caddy ACME ──────────────────────────
    local acme_email
    acme_email=$(state_get "$TENANT" ".acme_email")
    while [[ -z "$acme_email" ]]; do
        echo
        log_info "Email for Let's Encrypt cert notifications (expiry, problems)."
        read -rp "  ACME email: " acme_email
        [[ "$acme_email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || {
            log_warn "Not a valid email"
            acme_email=""
        }
    done
    state_set "$TENANT" ".acme_email" "$acme_email"

    # ── Cost confirmation ───────────────────────────────────────────────────
    confirm_cost=$(state_get "$TENANT" ".cost_confirmed")
    if [[ "$confirm_cost" != "true" ]]; then
        echo
        log_info "About to provision on DigitalOcean:"
        log_info "  Backend droplet ($be_size):   ~\$12/mo"
        log_info "  ES droplet ($es_size):        ~\$18/mo"
        if [[ "$snapshots" == "true" ]]; then
            log_info "  Weekly snapshots:             ~\$6/mo"
        fi
        log_info "  ${C_BOLD}Estimated total: ~\$30-36/mo${C_RESET}"
        confirm "Proceed with provisioning?" || fail "Aborted by user."
        state_set "$TENANT" ".cost_confirmed" "true"
    fi

    log_success "All inputs collected."
}
