#!/usr/bin/env bash
# Phase 1: preflight — verify everything the operator needs is in place.

phase_preflight() {
    # Local binaries
    require_cmd jq "pacman -S jq  /  apt install jq"
    require_cmd curl "pacman -S curl  /  apt install curl"
    require_cmd ssh "openssh"
    require_cmd ssh-keygen "openssh"
    require_cmd dig "pacman -S bind  /  apt install dnsutils"
    require_cmd rsync "pacman -S rsync  /  apt install rsync"
    require_cmd doctl \
        "https://docs.digitalocean.com/reference/doctl/how-to/install/  (Arch: pacman -S doctl)"
    log_success "All required binaries present."

    # doctl authentication
    if ! doctl account get >/dev/null 2>&1; then
        log_error "doctl is not authenticated."
        log_info "Run:  doctl auth init"
        log_info "Get a token at: https://cloud.digitalocean.com/account/api/tokens"
        log_info "(Token needs 'read' + 'write' scope.)"
        fail "doctl auth required"
    fi
    local do_user
    do_user=$(doctl account get --format Email --no-header 2>/dev/null || echo "?")
    log_success "doctl authenticated as $do_user"

    # SSH key
    local ssh_key="${PROJECTACHILLES_DEPLOY_SSH_KEY:-$HOME/.ssh/projectachilles-deploy_ed25519}"
    if [[ ! -f "$ssh_key" ]]; then
        log_info "Generating new SSH key at $ssh_key"
        ssh-keygen -t ed25519 -N "" -C "projectachilles-deploy@$(hostname)" -f "$ssh_key" >/dev/null
        chmod 600 "$ssh_key"
    fi
    state_set "$TENANT" ".ssh_key_path" "$ssh_key"

    local pubkey
    pubkey=$(cat "${ssh_key}.pub")
    state_set "$TENANT" ".ssh_pubkey" "$pubkey"

    # Upload pubkey to DO if not already present
    local key_name="projectachilles-deploy-$(hostname -s)"
    local key_id
    key_id=$(doctl compute ssh-key list --format ID,Name --no-header 2>/dev/null \
        | awk -v n="$key_name" '$2==n {print $1; exit}')

    if [[ -z "$key_id" ]]; then
        log_info "Uploading SSH key to DigitalOcean as '$key_name'"
        key_id=$(doctl compute ssh-key import "$key_name" \
            --public-key-file "${ssh_key}.pub" \
            --format ID --no-header 2>/dev/null)
        [[ -n "$key_id" ]] || fail "Failed to upload SSH key to DO"
    else
        log_info "Reusing existing DO SSH key '$key_name' (id=$key_id)"
    fi
    state_set "$TENANT" ".do_ssh_key_id" "$key_id"
    log_success "SSH key ready (DO id=$key_id, local=$ssh_key)"
}
