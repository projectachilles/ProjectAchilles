#!/usr/bin/env bash
# SSH wrappers with boot-wait retry, known_hosts management, and scp helpers.
#
# IFS-safe: uses a bash array (SSH_OPTS) instead of a space-joined string,
# because deploy.sh sets IFS=$'\n\t' (no space) — unquoted "$opts" then fails
# to word-split, and ssh receives a single mangled argument.

# Global, populated by ssh_opts_populate.
SSH_OPTS=()

# ssh_opts_populate <key-path>  — fill SSH_OPTS array for subsequent calls
ssh_opts_populate() {
    local key="$1"
    SSH_OPTS=(
        -o "IdentityFile=$key"
        -o IdentitiesOnly=yes
        -o StrictHostKeyChecking=accept-new
        -o "UserKnownHostsFile=$HOME/.ssh/known_hosts"
        -o ServerAliveInterval=30
        -o ServerAliveCountMax=4
        -o ConnectTimeout=10
    )
}

# ssh_wait_ready <host> <key>  — poll until SSH accepts a connection
# Ubuntu 24.04 first-boot SSH-ready is ~3-4 min on s-1vcpu-2gb.
# 5 min ceiling gives margin without masking real failures.
ssh_wait_ready() {
    local host="$1"
    local key="$2"
    local elapsed=0
    local timeout=300
    local interval=5
    ssh_opts_populate "$key"

    log_info "Waiting for SSH on $host ..."
    while (( elapsed < timeout )); do
        if ssh -n -q "${SSH_OPTS[@]}" -o BatchMode=yes "root@${host}" "true" 2>/dev/null; then
            log_success "SSH ready on $host (after ${elapsed}s)"
            return 0
        fi
        sleep "$interval"
        elapsed=$(( elapsed + interval ))
    done
    fail "SSH did not become ready on $host within ${timeout}s"
}

# ssh_run <host> <key> <user> <command...>
ssh_run() {
    local host="$1" key="$2" user="$3"; shift 3
    ssh_opts_populate "$key"
    ssh "${SSH_OPTS[@]}" "${user}@${host}" "$@"
}

# scp_file <host> <key> <local-path> <remote-path> [user=root]
scp_file() {
    local host="$1" key="$2" local_path="$3" remote_path="$4"
    local user="${5:-root}"
    ssh_opts_populate "$key"
    scp "${SSH_OPTS[@]}" "$local_path" "${user}@${host}:${remote_path}"
}

# rsync_dir <host> <key> <local-dir> <remote-dir> [user=root]
# rsync's -e wants a single shell string. Build it carefully from the array.
rsync_dir() {
    local host="$1" key="$2" local_dir="$3" remote_dir="$4"
    local user="${5:-root}"
    ssh_opts_populate "$key"

    # Build "ssh <opt1> <opt2> ..." as a single string, quoting each opt for the
    # subshell rsync will spawn. printf '%q' produces shell-safe escaping.
    local rsync_ssh="ssh"
    local o
    for o in "${SSH_OPTS[@]}"; do
        rsync_ssh+=" $(printf '%q' "$o")"
    done

    rsync -az --delete -e "$rsync_ssh" "$local_dir" "${user}@${host}:${remote_dir}"
}

# ssh_clear_known_host <host>  — remove stale host key (idempotent reprovision)
ssh_clear_known_host() {
    local host="$1"
    ssh-keygen -R "$host" >/dev/null 2>&1 || true
}
