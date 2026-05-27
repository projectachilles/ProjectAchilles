#!/usr/bin/env bash
# Phase 8: caddy_tls — wait for ACME to successfully issue certs for both FQDNs.
# Caddy starts auto-issuance the moment it's reloaded with the Caddyfile (done
# in 10-backend-install.sh). This phase just verifies the cert is live.

phase_caddy_tls() {
    local be_pub ssh_key spa agent
    be_pub=$(state_get  "$TENANT" ".backend_droplet.public_ip")
    ssh_key=$(state_get "$TENANT" ".ssh_key_path")
    spa=$(state_get     "$TENANT" ".fqdn_spa")
    agent=$(state_get   "$TENANT" ".fqdn_agent")

    log_info "Waiting for Caddy auto-TLS issuance (Let's Encrypt)..."

    local elapsed=0
    local timeout=300   # 5 min
    local interval=10

    while (( elapsed < timeout )); do
        local spa_code agent_code
        spa_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://${spa}/" 2>/dev/null || echo "000")
        agent_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://${agent}/api/health" 2>/dev/null || echo "000")

        # 200 OK = both alive; 502/504 = backend issue (rare here, backend is local);
        # SSL handshake failures show as "000".
        if [[ "$spa_code" != "000" && "$agent_code" != "000" ]]; then
            log_success "TLS active — SPA HTTP $spa_code, AGENT HTTP $agent_code"
            return 0
        fi

        printf '\r  %s[⠧]%s acme wait (%ds elapsed) — SPA=%s AGENT=%s   ' \
            "$C_DIM" "$C_RESET" "$elapsed" "${spa_code}" "${agent_code}" >&2
        sleep "$interval"
        elapsed=$(( elapsed + interval ))
    done

    echo >&2
    log_warn "TLS did not complete in ${timeout}s. Inspect Caddy logs:"
    log_warn "  ssh -i $ssh_key root@$be_pub journalctl -u caddy -n 100 --no-pager"
    fail "ACME timeout"
}
