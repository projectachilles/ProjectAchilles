#!/usr/bin/env bash
# Phase 9: verify — end-to-end smoke tests, print final URL on green.

phase_verify() {
    local spa agent be_pub ssh_key es_priv es_api clerk_pk
    spa=$(state_get      "$TENANT" ".fqdn_spa")
    agent=$(state_get    "$TENANT" ".fqdn_agent")
    be_pub=$(state_get   "$TENANT" ".backend_droplet.public_ip")
    ssh_key=$(state_get  "$TENANT" ".ssh_key_path")
    es_priv=$(state_get  "$TENANT" ".es_droplet.private_ip")
    es_api=$(state_get   "$TENANT" ".es_api_key")
    clerk_pk=$(state_get "$TENANT" ".clerk_pk")

    local failures=0
    validate_spa            "$spa"                                  || ((failures++))
    validate_env_config     "$spa" "$agent"                         || ((failures++))
    validate_backend_health "$agent"                                || ((failures++))
    validate_es_cluster     "$be_pub" "$ssh_key" "$es_priv" "$es_api" || ((failures++))
    validate_es_write       "$be_pub" "$ssh_key" "$es_priv" "$es_api" || ((failures++))
    validate_clerk_jwks     "$clerk_pk"                             || ((failures++))

    if (( failures > 0 )); then
        log_error "$failures check(s) failed."
        return 1
    fi

    # ── Final summary ────────────────────────────────────────────────────
    local snapshots
    snapshots=$(state_get "$TENANT" ".snapshots_enabled")
    cat <<EOF >&2

${C_GREEN}${C_BOLD}╭───────────────────────────────────────────────────────────────────╮${C_RESET}
${C_GREEN}${C_BOLD}│  ✅ ProjectAchilles is live for tenant: $(printf '%-25s' "$TENANT")│${C_RESET}
${C_GREEN}${C_BOLD}╰───────────────────────────────────────────────────────────────────╯${C_RESET}

  ${C_BOLD}SPA URL${C_RESET}     https://${spa}
  ${C_BOLD}Backend${C_RESET}     https://${agent}/api
  ${C_BOLD}ES${C_RESET}          ${es_priv}:9200 (private; reachable via Tailscale only)
  ${C_BOLD}Snapshots${C_RESET}   ${snapshots} (weekly)
  ${C_BOLD}State${C_RESET}       $(state_file_for "$TENANT")

  Next steps:
    1. Open https://${spa} and sign in with Clerk.
    2. Settings → Integrations → configure Microsoft Defender if needed.
    3. SSH access (via Tailscale): \`ssh achilles@pa-${TENANT}-backend\`
    4. View backend logs: \`ssh achilles@pa-${TENANT}-backend journalctl -u projectachilles-backend -f\`

EOF
}
