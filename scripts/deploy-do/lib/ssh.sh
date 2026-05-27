#!/usr/bin/env bash
# SSH wrappers with boot-wait retry, known_hosts management, and scp helpers.

# ssh_opts <key-path>  — emit common ssh options (host-key auto-accept on first contact)
ssh_opts() {
    local key="$1"
    cat <<EOF
-o IdentityFile=$key
-o IdentitiesOnly=yes
-o StrictHostKeyChecking=accept-new
-o UserKnownHostsFile=$HOME/.ssh/known_hosts
-o ServerAliveInterval=30
-o ServerAliveCountMax=4
-o ConnectTimeout=10
EOF
}

# ssh_wait_ready <host> <key>  — poll until SSH accepts a connection (max ~3 min)
ssh_wait_ready() {
    local host="$1"
    local key="$2"
    local elapsed=0
    local timeout=180
    local interval=5
    local opts
    opts=$(ssh_opts "$key" | xargs)

    log_info "Waiting for SSH on $host ..."
    while (( elapsed < timeout )); do
        # shellcheck disable=SC2086
        if ssh -n -q $opts -o BatchMode=yes "root@${host}" "true" 2>/dev/null; then
            log_success "SSH ready on $host (after ${elapsed}s)"
            return 0
        fi
        sleep "$interval"
        elapsed=$(( elapsed + interval ))
    done
    fail "SSH did not become ready on $host within ${timeout}s"
}

# ssh_run <host> <key> <user> <command...>
# Runs a command via ssh; stdin pass-through.
ssh_run() {
    local host="$1" key="$2" user="$3"; shift 3
    local opts
    opts=$(ssh_opts "$key" | xargs)
    # shellcheck disable=SC2086
    ssh $opts "${user}@${host}" "$@"
}

# scp_file <host> <key> <local-path> <remote-path> [user=root]
scp_file() {
    local host="$1" key="$2" local_path="$3" remote_path="$4"
    local user="${5:-root}"
    local opts
    opts=$(ssh_opts "$key" | xargs)
    # shellcheck disable=SC2086
    scp $opts "$local_path" "${user}@${host}:${remote_path}"
}

# rsync_dir <host> <key> <local-dir> <remote-dir> [user=root]
rsync_dir() {
    local host="$1" key="$2" local_dir="$3" remote_dir="$4"
    local user="${5:-root}"
    rsync -az --delete \
        -e "ssh $(ssh_opts "$key" | xargs)" \
        "$local_dir" "${user}@${host}:${remote_dir}"
}

# ssh_clear_known_host <host>  — remove stale host key (idempotent reprovision)
ssh_clear_known_host() {
    local host="$1"
    ssh-keygen -R "$host" >/dev/null 2>&1 || true
}
