#!/usr/bin/env bash
# Clerk key validation + interactive prompt.
# Adapted from scripts/start.sh:798-1085 to operate without backend/.env files
# (this runs on the operator's laptop, the keys ship to the droplet later).
#
# On successful prompt, exports CLERK_PK and CLERK_SK.

CLERK_PK=""
CLERK_SK=""
CLERK_KEY_ENV=""   # "test" or "live" — set by clerk_validate_format

# Validate Clerk key format. Returns 0 if valid, 1 if invalid.
# Sets CLERK_KEY_ENV to "test" or "live" on success.
clerk_validate_format() {
    local key="$1" type="$2"   # type: "pk" or "sk"
    if [[ "$key" =~ ^${type}_(test|live)_.+ ]]; then
        CLERK_KEY_ENV="${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

# Extract the Clerk Frontend API domain from a publishable key.
# pk_test_<base64-encoded-domain>$ → domain string
clerk_extract_domain() {
    local pk="$1"
    local payload="${pk#pk_test_}"
    payload="${payload#pk_live_}"
    local domain
    domain=$(echo "$payload" | base64 -d 2>/dev/null | tr -d '$\n\r ')
    echo "$domain"
}

# Test connectivity to a Clerk app via its JWKS endpoint.
# Returns 0 if reachable, 1 if not.
clerk_validate_connectivity() {
    local pk="$1"
    local domain
    domain=$(clerk_extract_domain "$pk")

    if [[ -z "$domain" ]]; then
        log_warn "Could not decode Clerk domain from publishable key"
        return 1
    fi

    local url="https://${domain}/.well-known/jwks.json"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")

    if [[ "$http_code" == "200" ]]; then
        return 0
    else
        log_warn "Could not reach Clerk app at $domain (HTTP $http_code)"
        return 1
    fi
}

# Interactive prompt: ask for pk + sk, validate, sanity-check connectivity.
# Sets CLERK_PK + CLERK_SK on success.
clerk_prompt_keys() {
    local pk_input sk_input pk_env sk_env

    echo
    log_info "Get your Clerk keys from: https://dashboard.clerk.com"
    log_info "For a public demo, use ${C_BOLD}pk_live_ / sk_live_${C_RESET} keys."
    log_info "For dev only, ${C_BOLD}pk_test_ / sk_test_${C_RESET} keys work but expect cross-subdomain quirks."

    while true; do
        echo
        read -rp "  Clerk Publishable Key: " pk_input
        [[ -z "$pk_input" ]] && { log_warn "Key cannot be empty"; continue; }

        if ! clerk_validate_format "$pk_input" "pk"; then
            log_warn "Invalid format — must start with pk_test_ or pk_live_"
            continue
        fi
        pk_env="$CLERK_KEY_ENV"
        log_success "Format valid ($pk_env environment)"
        break
    done

    while true; do
        echo
        read -rsp "  Clerk Secret Key (hidden): " sk_input
        echo
        [[ -z "$sk_input" ]] && { log_warn "Key cannot be empty"; continue; }

        if ! clerk_validate_format "$sk_input" "sk"; then
            log_warn "Invalid format — must start with sk_test_ or sk_live_"
            continue
        fi
        sk_env="$CLERK_KEY_ENV"
        log_success "${sk_input:0:12}... confirmed ($sk_env environment)"

        if [[ "$pk_env" != "$sk_env" ]]; then
            log_warn "Mismatch: publishable key is $pk_env but secret key is $sk_env"
            log_warn "Keys should be from the same Clerk environment"
            confirm "Use them anyway?" || continue
        fi
        break
    done

    # Special warning for dev keys on a public demo
    if [[ "$pk_env" == "test" ]]; then
        log_warn "Using pk_test_/sk_test_ keys on a public demo."
        log_warn "Cross-subdomain Clerk handshake may misbehave (see bancocaribe history)."
        log_warn "For production-quality demos, consider creating a Clerk live app + DNS."
        confirm "Continue with dev keys?" || { clerk_prompt_keys; return; }
    fi

    # Connectivity probe
    log_info "Validating keys with Clerk JWKS endpoint..."
    if clerk_validate_connectivity "$pk_input"; then
        log_success "Clerk app is reachable"
    else
        if ! confirm "Keys could not be verified. Use them anyway?"; then
            log_info "Retrying..."
            clerk_prompt_keys
            return
        fi
    fi

    CLERK_PK="$pk_input"
    CLERK_SK="$sk_input"
}
