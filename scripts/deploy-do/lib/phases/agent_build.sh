#!/usr/bin/env bash
# Phase 10: agent_build — install Go on the backend droplet so the in-app
# agent build flow works. The actual binary build + version registration
# is operator-triggered via Settings → Agent → Build Binary (because the
# build takes 30-60s and the operator decides which version/OS/arch).

phase_agent_build() {
    local be_pub ssh_key
    be_pub=$(state_get  "$TENANT" ".backend_droplet.public_ip")
    ssh_key=$(state_get "$TENANT" ".ssh_key_path")

    [[ -n "$be_pub" && -n "$ssh_key" ]] || fail "Missing state for agent_build"

    log_info "Syncing remote scripts to backend droplet"
    rsync_dir "$be_pub" "$ssh_key" "$SCRIPT_DIR/remote/" "/root/deploy-do-remote/"

    log_info "Installing Go on backend droplet (so Settings → Agent → Build Binary works)"
    ssh_run "$be_pub" "$ssh_key" root \
        "bash /root/deploy-do-remote/30-go-install.sh"

    # Restart the backend so its child-process spawn() picks up the new PATH.
    log_info "Restarting backend so spawn() inherits the new PATH"
    ssh_run "$be_pub" "$ssh_key" root \
        "systemctl restart projectachilles-backend && sleep 2 && systemctl is-active projectachilles-backend"

    log_success "Go installed; agent binaries can now be built via Settings → Agent → Build Binary"
    log_info "(Manual step: open the SPA → Settings → Agent and trigger a build per OS/arch you need.)"
}
