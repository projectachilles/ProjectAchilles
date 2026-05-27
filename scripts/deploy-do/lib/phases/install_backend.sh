#!/usr/bin/env bash
# Phase 7: install_backend — rsync the repo to the backend droplet and
# run 10-backend-install.sh.

phase_install_backend() {
    local be_pub ssh_key spa agent clerk_pk clerk_sk es_priv es_api acme_email
    be_pub=$(state_get   "$TENANT" ".backend_droplet.public_ip")
    ssh_key=$(state_get  "$TENANT" ".ssh_key_path")
    spa=$(state_get      "$TENANT" ".fqdn_spa")
    agent=$(state_get    "$TENANT" ".fqdn_agent")
    clerk_pk=$(state_get "$TENANT" ".clerk_pk")
    clerk_sk=$(state_get "$TENANT" ".clerk_sk")
    es_priv=$(state_get  "$TENANT" ".es_droplet.private_ip")
    es_api=$(state_get   "$TENANT" ".es_api_key")
    acme_email=$(state_get "$TENANT" ".acme_email")

    for v in be_pub ssh_key spa agent clerk_pk clerk_sk es_priv es_api acme_email; do
        [[ -n "${!v}" ]] || fail "Missing state value: $v"
    done

    # ── Rsync local repo to droplet ────────────────────────────────────────
    log_info "Rsyncing ProjectAchilles to backend droplet"
    log_info "Excludes: node_modules, dist, .env, agents.db, .vite, build artifacts"

    local rsync_excludes=(
        --exclude=node_modules/
        --exclude=dist/
        --exclude=build/
        --exclude=.vite/
        --exclude=.next/
        --exclude=.env
        --exclude=.env.local
        --exclude=agents.db
        --exclude=agents.db-shm
        --exclude=agents.db-wal
        --exclude='*.log'
        --exclude=.DS_Store
        --exclude=coverage/
        --exclude=__pycache__/
        --exclude='*.pyc'
        --exclude=scripts/deploy-do/  # don't bundle the deployer inside the deployed repo
    )

    # Ensure target dir exists
    ssh_run "$be_pub" "$ssh_key" root "mkdir -p /home/achilles/ProjectAchilles && chown -R achilles:achilles /home/achilles/ProjectAchilles"

    # Build rsync's -e ssh string from the SSH_OPTS array (IFS-safe).
    ssh_opts_populate "$ssh_key"
    local rsync_ssh="ssh"
    local o
    for o in "${SSH_OPTS[@]}"; do
        rsync_ssh+=" $(printf '%q' "$o")"
    done

    rsync -az \
        -e "$rsync_ssh" \
        "${rsync_excludes[@]}" \
        "$REPO_ROOT/" \
        "root@${be_pub}:/home/achilles/ProjectAchilles/"

    log_success "Repo synced"

    # Always re-sync remote scripts (in case edited between phases).
    log_info "Syncing remote scripts to backend droplet"
    rsync_dir "$be_pub" "$ssh_key" "$SCRIPT_DIR/remote/" "/root/deploy-do-remote/"

    # ── Run backend install ───────────────────────────────────────────────
    log_info "Running 10-backend-install.sh on backend droplet (this takes 5-10 min)"
    ssh_run "$be_pub" "$ssh_key" root \
        "SPA_FQDN='$spa' \
         AGENT_FQDN='$agent' \
         CORS_ORIGIN='https://$spa' \
         CLERK_PUBLISHABLE_KEY='$clerk_pk' \
         CLERK_SECRET_KEY='$clerk_sk' \
         ES_PRIVATE_IP='$es_priv' \
         ES_API_KEY='$es_api' \
         ACME_EMAIL='$acme_email' \
         bash /root/deploy-do-remote/10-backend-install.sh"

    log_success "Backend installed and running."
}
