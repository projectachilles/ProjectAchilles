#!/usr/bin/env bash
# Phase 6: dns_wait — print A records, wait for propagation.

phase_dns_wait() {
    local spa agent backend_ip
    spa=$(state_get "$TENANT" ".fqdn_spa")
    agent=$(state_get "$TENANT" ".fqdn_agent")
    backend_ip=$(state_get "$TENANT" ".backend_droplet.public_ip")

    [[ -n "$spa" && -n "$agent" && -n "$backend_ip" ]] || fail "Missing DNS state values"

    cat <<EOF >&2

${C_BOLD}╭───────────────────────────────────────────────────────────────╮${C_RESET}
${C_BOLD}│  DNS RECORDS REQUIRED                                         │${C_RESET}
${C_BOLD}│                                                               │${C_RESET}
${C_BOLD}│  Add at your DNS provider (Cloudflare, Route53, …):           │${C_RESET}
${C_BOLD}│                                                               │${C_RESET}
${C_BOLD}│   ${C_GREEN}${spa}${C_RESET}${C_BOLD}   A   ${C_CYAN}${backend_ip}${C_RESET}${C_BOLD}   TTL 300       │${C_RESET}
${C_BOLD}│   ${C_GREEN}${agent}${C_RESET}${C_BOLD}   A   ${C_CYAN}${backend_ip}${C_RESET}${C_BOLD}   TTL 300       │${C_RESET}
${C_BOLD}│                                                               │${C_RESET}
${C_BOLD}│  Both records point to the backend droplet IP.                │${C_RESET}
${C_BOLD}│  Caddy on the backend routes by Host header.                  │${C_RESET}
${C_BOLD}│  ES (10.x.x.x) is private — no DNS record.                    │${C_RESET}
${C_BOLD}╰───────────────────────────────────────────────────────────────╯${C_RESET}

EOF
    log_info "Polling 1.1.1.1 and 8.8.8.8 every 5s, up to 15 min..."
    log_info "(Caddy needs both records resolved before ACME can issue TLS certs.)"

    if ! dns_wait_pair "$spa" "$agent" "$backend_ip" 900; then
        fail "DNS did not propagate within 15 min. Re-run --resume after records settle."
    fi
}
