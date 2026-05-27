#!/usr/bin/env bash
# Idempotent doctl wrappers. All resources tagged `pa-<tenant>` for cleanup.

# pa_tag <tenant>  — primary tenant tag
pa_tag() { echo "pa-$1"; }

# ── VPC ───────────────────────────────────────────────────────────────────────
# doctl_ensure_vpc <tenant> <region>  — print VPC ID, creating if missing
doctl_ensure_vpc() {
    local tenant="$1"
    local region="$2"
    local name="pa-${tenant}-vpc"
    local id

    id=$(doctl vpcs list --format ID,Name --no-header 2>/dev/null \
        | awk -v n="$name" '$2==n {print $1; exit}')

    if [[ -z "$id" ]]; then
        log_info "Creating VPC '$name' in $region"
        # NOTE: `doctl vpcs create` (unlike `compute droplet/firewall create`)
        # does NOT accept --format/--no-header. Use --output json + jq.
        # Response is a single-element array of VPC objects.
        local resp
        resp=$(doctl vpcs create \
            --name "$name" \
            --region "$region" \
            --description "ProjectAchilles tenant $tenant" \
            --output json 2>&1) || { log_error "VPC create failed: $resp"; fail "VPC create"; }
        id=$(echo "$resp" | jq -r '.[0].id // empty' 2>/dev/null)
        [[ -n "$id" ]] || { log_error "VPC create returned no ID: $resp"; fail "VPC parse"; }
        sleep 2
    else
        log_info "Reusing VPC '$name' (id=$id)"
    fi
    echo "$id"
}

# ── Droplet ───────────────────────────────────────────────────────────────────
# doctl_droplet_by_name <name>  — print droplet ID or empty
doctl_droplet_by_name() {
    local name="$1"
    doctl compute droplet list --format ID,Name --no-header 2>/dev/null \
        | awk -v n="$name" '$2==n {print $1; exit}'
}

# doctl_droplet_create <name> <size> <region> <vpc_id> <ssh_key_id> <tags-comma> [snapshots:true|false]
doctl_droplet_create() {
    local name="$1" size="$2" region="$3" vpc_id="$4" ssh_key_id="$5" tags="$6"
    local snapshots="${7:-true}"

    local existing
    existing=$(doctl_droplet_by_name "$name")
    if [[ -n "$existing" ]]; then
        log_info "Reusing droplet '$name' (id=$existing)"
        echo "$existing"
        return 0
    fi

    local backups_flag=""
    [[ "$snapshots" == "true" ]] && backups_flag="--enable-backups"

    log_info "Creating droplet '$name' ($size in $region)"
    local id
    id=$(doctl compute droplet create "$name" \
        --image ubuntu-24-04-x64 \
        --size "$size" \
        --region "$region" \
        --vpc-uuid "$vpc_id" \
        --ssh-keys "$ssh_key_id" \
        --tag-names "$tags" \
        $backups_flag \
        --enable-monitoring \
        --enable-ipv6 \
        --wait \
        --format ID --no-header 2>/dev/null) || fail "Droplet create failed: $name"

    [[ -n "$id" ]] || fail "Droplet create returned no ID for $name"
    echo "$id"
}

# doctl_droplet_public_ip <id>
doctl_droplet_public_ip() {
    doctl compute droplet get "$1" --format PublicIPv4 --no-header 2>/dev/null
}

# doctl_droplet_private_ip <id>
doctl_droplet_private_ip() {
    doctl compute droplet get "$1" --format PrivateIPv4 --no-header 2>/dev/null
}

# ── Firewall ──────────────────────────────────────────────────────────────────
# doctl_ensure_firewall_backend <tenant>
# Backend droplet: SSH/HTTP/HTTPS from anywhere; deny all else inbound.
doctl_ensure_firewall_backend() {
    local tenant="$1"
    local droplet_id="$2"
    local name="pa-${tenant}-fw-backend"
    local id

    id=$(doctl compute firewall list --format ID,Name --no-header 2>/dev/null \
        | awk -v n="$name" '$2==n {print $1; exit}')

    local inbound_rules='
protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0
protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0
protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0
'
    local outbound_rules='
protocol:icmp,address:0.0.0.0/0,address:::/0
protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0
protocol:udp,ports:all,address:0.0.0.0/0,address:::/0
'

    if [[ -z "$id" ]]; then
        log_info "Creating backend firewall '$name'"
        id=$(doctl compute firewall create \
            --name "$name" \
            --inbound-rules "$(echo "$inbound_rules" | grep -v '^$' | paste -sd ' ')" \
            --outbound-rules "$(echo "$outbound_rules" | grep -v '^$' | paste -sd ' ')" \
            --droplet-ids "$droplet_id" \
            --tag-names "$(pa_tag "$tenant"),pa-${tenant}-backend" \
            --format ID --no-header 2>/dev/null) || fail "Firewall create failed"
    else
        log_info "Reusing firewall '$name' (id=$id)"
        doctl compute firewall add-droplets "$id" --droplet-ids "$droplet_id" >/dev/null 2>&1 || true
    fi
    echo "$id"
}

# doctl_ensure_firewall_es <tenant> <es_droplet_id> <backend_private_ip>
# ES droplet: SSH from anywhere (operator), 9200 from backend VPC IP only.
doctl_ensure_firewall_es() {
    local tenant="$1"
    local es_droplet_id="$2"
    local backend_private_ip="$3"
    local name="pa-${tenant}-fw-es"
    local id

    id=$(doctl compute firewall list --format ID,Name --no-header 2>/dev/null \
        | awk -v n="$name" '$2==n {print $1; exit}')

    local inbound_rules="protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:9200,address:${backend_private_ip}/32 protocol:tcp,ports:9300,address:${backend_private_ip}/32"
    local outbound_rules='protocol:icmp,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0'

    if [[ -z "$id" ]]; then
        log_info "Creating ES firewall '$name'  (9200 allowed from $backend_private_ip only)"
        id=$(doctl compute firewall create \
            --name "$name" \
            --inbound-rules "$inbound_rules" \
            --outbound-rules "$outbound_rules" \
            --droplet-ids "$es_droplet_id" \
            --tag-names "$(pa_tag "$tenant"),pa-${tenant}-es" \
            --format ID --no-header 2>/dev/null) || fail "ES firewall create failed"
    else
        log_info "Reusing ES firewall '$name' (id=$id)"
        doctl compute firewall add-droplets "$id" --droplet-ids "$es_droplet_id" >/dev/null 2>&1 || true
    fi
    echo "$id"
}

# ── Project (groups all tenant resources under one DO project) ───────────────
# doctl_ensure_project <tenant>  — print project ID
doctl_ensure_project() {
    local tenant="$1"
    local name="ProjectAchilles - $tenant"
    local id

    id=$(doctl projects list --format ID,Name --no-header 2>/dev/null \
        | awk -F'  +' -v n="$name" '$2==n {print $1; exit}')

    if [[ -z "$id" ]]; then
        log_info "Creating DO project '$name'"
        id=$(doctl projects create \
            --name "$name" \
            --purpose "Service or API" \
            --environment "Production" \
            --description "ProjectAchilles demo deployment for tenant $tenant" \
            --format ID --no-header 2>/dev/null) || {
                log_warn "Project create failed; continuing without project grouping."
                echo ""
                return 0
            }
    else
        log_info "Reusing DO project '$name' (id=$id)"
    fi
    echo "$id"
}

# doctl_project_assign <project_id> <droplet_id> [droplet_id ...]
doctl_project_assign() {
    local project_id="$1"; shift
    [[ -z "$project_id" ]] && return 0
    local urn
    for droplet_id in "$@"; do
        urn="do:droplet:$droplet_id"
        doctl projects resources assign "$project_id" --resource="$urn" >/dev/null 2>&1 || true
    done
}
