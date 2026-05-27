#!/usr/bin/env bash
# Smoke tests run after the deploy completes.
# Each function returns 0 on pass, 1 on fail; prints diagnostic on fail.

# validate_spa <spa_fqdn>
validate_spa() {
    local spa="$1"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${spa}/" || echo "000")
    if [[ "$code" != "200" ]]; then
        log_error "SPA root HTTP $code (expected 200)"
        return 1
    fi
    if ! curl -fsS --max-time 10 "https://${spa}/" | grep -q -i 'projectachilles\|<div id="root">\|<div id="app">' ; then
        log_error "SPA root does not look like the ProjectAchilles index.html"
        return 1
    fi
    log_success "SPA root OK"
}

# validate_env_config <spa_fqdn> <expected_agent_fqdn>
validate_env_config() {
    local spa="$1"
    local agent="$2"
    local body
    body=$(curl -fsS --max-time 10 "https://${spa}/env-config.js" 2>/dev/null || echo "")
    if [[ -z "$body" ]]; then
        log_error "env-config.js not served"
        return 1
    fi
    if ! echo "$body" | grep -q "https://${agent}"; then
        log_error "env-config.js missing expected agent URL ($agent). Body was:"
        echo "$body" | head -10 >&2
        return 1
    fi
    log_success "env-config.js correctly points to $agent"
}

# validate_backend_health <agent_fqdn>
validate_backend_health() {
    local agent="$1"
    local body
    body=$(curl -fsS --max-time 10 "https://${agent}/api/health" 2>/dev/null || echo "")
    if [[ -z "$body" ]]; then
        log_error "/api/health not responding"
        return 1
    fi
    if ! echo "$body" | grep -q '"status":"ok"\|"healthy":true\|"ok":true' ; then
        log_warn "/api/health responded but content unexpected: $body"
        # Don't fail — health route shape may differ across versions.
    fi
    log_success "Backend /api/health reachable"
}

# validate_es_cluster <backend_host> <ssh_key> <es_private_ip> <es_api_key>
validate_es_cluster() {
    local be_host="$1" ssh_key="$2" es_priv="$3" es_key="$4"
    local out
    out=$(ssh_run "$be_host" "$ssh_key" achilles \
        "curl -fsS -H 'Authorization: ApiKey ${es_key}' http://${es_priv}:9200/_cluster/health" \
        2>/dev/null || echo "")
    if [[ -z "$out" ]]; then
        log_error "ES /_cluster/health unreachable from backend droplet"
        return 1
    fi
    if ! echo "$out" | grep -qE '"status":"(green|yellow)"' ; then
        log_error "ES cluster not green/yellow: $out"
        return 1
    fi
    log_success "ES cluster reachable from backend, status OK"
}

# validate_es_write <backend_host> <ssh_key> <es_private_ip> <es_api_key>
# Probes a write to `achilles-results` (no wildcard).
# This is the explicit regression test for bancocaribe ES wildcard bug.
validate_es_write() {
    local be_host="$1" ssh_key="$2" es_priv="$3" es_key="$4"
    local out
    out=$(ssh_run "$be_host" "$ssh_key" achilles \
        "curl -fsS -X POST -H 'Authorization: ApiKey ${es_key}' \
              -H 'Content-Type: application/json' \
              'http://${es_priv}:9200/achilles-results/_doc?refresh=true' \
              -d '{\"probe\":true,\"@timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}' " \
        2>/dev/null || echo "")
    if ! echo "$out" | grep -q '"result":"created"' ; then
        log_error "ES write probe failed (bancocaribe wildcard bug regression?):"
        echo "$out" >&2
        return 1
    fi
    # Cleanup the probe doc
    ssh_run "$be_host" "$ssh_key" achilles \
        "curl -fsS -X POST -H 'Authorization: ApiKey ${es_key}' \
              'http://${es_priv}:9200/achilles-results/_delete_by_query?refresh=true' \
              -H 'Content-Type: application/json' \
              -d '{\"query\":{\"term\":{\"probe\":true}}}' " >/dev/null 2>&1 || true
    log_success "ES write probe OK"
}

# validate_clerk_jwks <clerk_pk>
validate_clerk_jwks() {
    local pk="$1"
    local domain
    domain=$(clerk_extract_domain "$pk")
    [[ -n "$domain" ]] || { log_warn "Could not extract Clerk domain (skipping)"; return 0; }
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://${domain}/.well-known/jwks.json" || echo "000")
    if [[ "$code" != "200" ]]; then
        log_warn "Clerk JWKS at $domain returned HTTP $code"
        return 1
    fi
    log_success "Clerk JWKS reachable ($domain)"
}
