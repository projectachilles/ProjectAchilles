#!/usr/bin/env bash
# Installs Elasticsearch 8.17 single-node on this droplet.
# Generates a scoped API key and writes it to /root/.es_credentials (mode 0600).
# Echoes the API key on a marker line for capture by the caller.
#
# Required env:
#   PRIVATE_IP   — private VPC IP this droplet should bind to

set -euo pipefail
IFS=$'\n\t'

: "${PRIVATE_IP:?PRIVATE_IP required}"

log() { printf '[es-install] %s\n' "$*" >&2; }

# ── Add Elastic apt repo ───────────────────────────────────────────────────
if [[ ! -f /usr/share/keyrings/elasticsearch-keyring.gpg ]]; then
    curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch \
        | gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg
fi
cat > /etc/apt/sources.list.d/elastic-8.x.list <<'EOF'
deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main
EOF

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
log "installing elasticsearch (8.17.x)"
apt-get install -y -qq "elasticsearch=8.17.*"

# ── elasticsearch.yml ─────────────────────────────────────────────────────
# IMPORTANT: overwriting elasticsearch.yml drops the apt package's default
# path.data and path.logs settings. Set them explicitly here, otherwise ES
# defaults to /usr/share/elasticsearch/{logs,data}/ which the elasticsearch
# user cannot write to → IOException on RollingFileAppender at startup.
cat > /etc/elasticsearch/elasticsearch.yml <<EOF
cluster.name: projectachilles
node.name: es-1
network.host: ${PRIVATE_IP}
http.port: 9200
discovery.type: single-node
path.data: /var/lib/elasticsearch
path.logs: /var/log/elasticsearch
xpack.security.enabled: true
xpack.security.enrollment.enabled: false
# HTTPS off on the binding interface — traffic is on a private VPC; API key still required.
xpack.security.http.ssl.enabled: false
xpack.security.transport.ssl.enabled: false
# Allow basic license features (free tier)
xpack.license.self_generated.type: basic
EOF

# ── JVM heap ───────────────────────────────────────────────────────────────
mkdir -p /etc/elasticsearch/jvm.options.d
cat > /etc/elasticsearch/jvm.options.d/heap.options <<'EOF'
-Xms768m
-Xmx768m
EOF

# Disable swap inside ES (avoid heap thrashing on a 2 GB host)
mkdir -p /etc/systemd/system/elasticsearch.service.d
cat > /etc/systemd/system/elasticsearch.service.d/override.conf <<'EOF'
[Service]
LimitMEMLOCK=infinity
EOF

# bootstrap.memory_lock asks JVM to mlockall; LimitMEMLOCK above enables it.
echo "bootstrap.memory_lock: true" >> /etc/elasticsearch/elasticsearch.yml

systemctl daemon-reload
systemctl enable elasticsearch >/dev/null
log "starting elasticsearch (may take 30-90s on first boot)"
systemctl restart elasticsearch

# ── Wait for ES to be up ──────────────────────────────────────────────────
# xpack.security is on, so an unauth probe returns 401 — that's still "up".
# Treat any non-000 HTTP code as success.
elapsed=0; timeout=300
while (( elapsed < timeout )); do
    code=$(curl -s --max-time 3 -o /dev/null -w '%{http_code}' "http://${PRIVATE_IP}:9200" 2>/dev/null || echo "000")
    if [[ "$code" != "000" ]]; then
        log "elasticsearch responding (HTTP $code) on ${PRIVATE_IP}:9200 after ${elapsed}s"
        break
    fi
    sleep 3
    elapsed=$(( elapsed + 3 ))
done
(( elapsed < timeout )) || { log "ES did not come up in ${timeout}s"; exit 1; }

# ── Reset elastic user password ──────────────────────────────────────────
elastic_pw=$(
    /usr/share/elasticsearch/bin/elasticsearch-reset-password \
        -u elastic --batch --silent 2>/dev/null \
        | tr -d '[:space:]'
)
[[ -n "$elastic_pw" ]] || { log "failed to reset elastic password"; exit 1; }

# ── Wait until cluster is ready for API-key creation (auth path) ─────────
elapsed=0
while (( elapsed < 60 )); do
    if curl -fsS -u "elastic:${elastic_pw}" "http://${PRIVATE_IP}:9200/_cluster/health" >/dev/null 2>&1; then
        break
    fi
    sleep 2
    elapsed=$(( elapsed + 2 ))
done

# ── Create a scoped API key ──────────────────────────────────────────────
api_response=$(curl -fsS -u "elastic:${elastic_pw}" \
    -H 'Content-Type: application/json' \
    -X POST "http://${PRIVATE_IP}:9200/_security/api_key" \
    -d '{
        "name": "projectachilles-backend",
        "role_descriptors": {
            "achilles_read_write": {
                "cluster": ["monitor"],
                "indices": [
                    {
                        "names": ["achilles-*"],
                        "privileges": ["all"]
                    }
                ]
            }
        }
    }')

api_encoded=$(echo "$api_response" | jq -r '.encoded')
api_id=$(echo "$api_response" | jq -r '.id')
api_fp=$(printf '%s' "$api_encoded" | sha256sum | awk '{print "sha256:"$1}')

[[ -n "$api_encoded" && "$api_encoded" != "null" ]] || { log "API key creation failed"; echo "$api_response" >&2; exit 1; }

# ── Persist credentials on the box (0600) ─────────────────────────────────
cat > /root/.es_credentials <<EOF
ELASTIC_PASSWORD=${elastic_pw}
ES_API_KEY=${api_encoded}
ES_API_KEY_ID=${api_id}
ES_PRIVATE_IP=${PRIVATE_IP}
EOF
chmod 600 /root/.es_credentials

log "elasticsearch ready; api key id=${api_id}"

# Marker line for caller capture (single line, easy to grep)
echo "ES_API_KEY_BASE64=${api_encoded}"
echo "ES_API_KEY_ID=${api_id}"
echo "ES_API_KEY_FINGERPRINT=${api_fp}"
echo "ELASTIC_PASSWORD=${elastic_pw}"
