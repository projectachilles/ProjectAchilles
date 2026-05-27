#!/usr/bin/env bash
# DNS helpers — preflight (FQDN should NOT resolve yet) + propagation polling.
# Requires dig in PATH.

# dns_resolve <fqdn> <resolver>
# Print first A record from <resolver> (default 1.1.1.1), empty on failure.
dns_resolve() {
    local fqdn="$1"
    local resolver="${2:-1.1.1.1}"
    dig +short +time=3 +tries=1 "@${resolver}" "$fqdn" A 2>/dev/null | grep -E '^[0-9.]+$' | head -1
}

# dns_preflight_unused <fqdn>
# Warn if FQDN already resolves (we don't want to stomp on a live service).
# Returns 0 always (warning is informational); caller decides whether to abort.
dns_preflight_unused() {
    local fqdn="$1"
    local existing
    existing=$(dns_resolve "$fqdn" 1.1.1.1)
    if [[ -n "$existing" ]]; then
        log_warn "$fqdn already resolves to $existing"
        log_warn "If this points to an old/dead service it's fine, but make sure you intend to repoint it."
        return 1
    fi
    return 0
}

# dns_wait_for <fqdn> <expected_ip> <timeout_seconds>
# Poll public resolvers (1.1.1.1 + 8.8.8.8) every 5s until both return expected_ip.
# Returns 0 on match, 1 on timeout.
dns_wait_for() {
    local fqdn="$1"
    local expected_ip="$2"
    local timeout="${3:-900}"   # 15 min default
    local elapsed=0
    local interval=5

    log_info "Waiting for $fqdn → $expected_ip ..."

    while (( elapsed < timeout )); do
        local cf gg
        cf=$(dns_resolve "$fqdn" 1.1.1.1)
        gg=$(dns_resolve "$fqdn" 8.8.8.8)

        if [[ "$cf" == "$expected_ip" && "$gg" == "$expected_ip" ]]; then
            log_success "$fqdn resolved (cloudflare=$cf, google=$gg) after ${elapsed}s"
            return 0
        fi

        local status="cf=${cf:-?} g=${gg:-?}"
        printf '\r  %s[⠧]%s polling (%ds elapsed) — %s   ' "$C_DIM" "$C_RESET" "$elapsed" "$status" >&2

        sleep "$interval"
        elapsed=$(( elapsed + interval ))
    done

    echo >&2
    log_error "Timed out after ${timeout}s waiting for $fqdn → $expected_ip"
    return 1
}

# dns_wait_pair <spa_fqdn> <agent_fqdn> <expected_ip> <timeout_seconds>
# Convenience: wait for both records concurrently in a single loop.
dns_wait_pair() {
    local spa="$1"
    local agent="$2"
    local expected="$3"
    local timeout="${4:-900}"
    local elapsed=0
    local interval=5
    local spa_ok=0
    local agent_ok=0

    while (( elapsed < timeout )); do
        local spa_cf spa_gg agent_cf agent_gg
        spa_cf=$(dns_resolve "$spa" 1.1.1.1)
        spa_gg=$(dns_resolve "$spa" 8.8.8.8)
        agent_cf=$(dns_resolve "$agent" 1.1.1.1)
        agent_gg=$(dns_resolve "$agent" 8.8.8.8)

        spa_ok=0; agent_ok=0
        [[ "$spa_cf"   == "$expected" && "$spa_gg"   == "$expected" ]] && spa_ok=1
        [[ "$agent_cf" == "$expected" && "$agent_gg" == "$expected" ]] && agent_ok=1

        if (( spa_ok && agent_ok )); then
            echo >&2
            log_success "Both records resolved after ${elapsed}s"
            return 0
        fi

        local mark_spa="${C_RED}✗${C_RESET}"
        local mark_agent="${C_RED}✗${C_RESET}"
        (( spa_ok ))   && mark_spa="${C_GREEN}✓${C_RESET}"
        (( agent_ok )) && mark_agent="${C_GREEN}✓${C_RESET}"

        printf '\r  %s[⠧]%s polling (%ds elapsed) — SPA %s, AGENT %s   ' \
            "$C_DIM" "$C_RESET" "$elapsed" "$mark_spa" "$mark_agent" >&2

        sleep "$interval"
        elapsed=$(( elapsed + interval ))
    done

    echo >&2
    log_error "Timed out after ${timeout}s. Re-run with --resume after DNS settles."
    return 1
}
