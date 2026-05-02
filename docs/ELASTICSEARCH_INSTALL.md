# Elasticsearch — Install Guide

End-to-end reproduction of a production single-node Elasticsearch 8.19 deployment with Caddy as a reverse proxy on port 443, Let's Encrypt certs auto-managed by Caddy, daily snapshots to DigitalOcean Spaces, and a Kibana admin UI running locally on the developer's machine.

Companion to [ELASTICSEARCH_USER_GUIDE.md](ELASTICSEARCH_USER_GUIDE.md) for day-to-day operations.

## Architecture

```
                   ┌──────────── DO droplet (<droplet-region>) ────────────────┐
                   │  Ubuntu 24.04 · 1 vCPU · 2 GB RAM · 70 GB · 2 GB swap      │
                   │                                                             │
                   │   :443 ─→ Caddy ─→ 127.0.0.1:9200 ─→ Elasticsearch 8.19.15 │
   internet ───────┤   :22  ─→ sshd                          (heap 768m)         │
                   │                                          ↓                  │
                   │                                     transport TLS (p12)     │
                   │                                          ↓                  │
                   │                                     single-node cluster     │
                   └───────────────────────────────┬─────────────────────────────┘
                                                   │
                                                   ↓ daily SLM snapshots
                                          ┌────────────────────────────┐
                                          │ DO Spaces (<do-region>)    │
                                          │ bucket <do-bucket>         │
                                          └────────────────────────────┘

   Developer machine:
     Docker Compose ─→ Kibana 8.19.15 on http://localhost:5601 ─→ https://<hostname>
```

## Prerequisites

| | |
|---|---|
| Droplet | DigitalOcean droplet, Ubuntu 24.04 LTS, ≥ 2 GB RAM, public IPv4 |
| Domain | DNS `A` record pointing the desired hostname at the droplet IP, propagated |
| Email | Email address registered with Let's Encrypt (used for expiry alerts) |
| DO Spaces | Bucket created in DO panel + Spaces Access Key with R/W/D/L on that bucket |
| Local | Linux with Docker installed, for running Kibana |
| SSH | Private key configured for `root@<droplet-ip>` |

This guide uses these placeholders — substitute your own values:

```
<droplet-ip>            e.g. 192.0.2.10
<hostname>              e.g. es.example.com
<email>                 e.g. you@example.com
<ssh-key>               e.g. ~/.ssh/id_ed25519
<do-region>             e.g. nyc3
<do-bucket>             e.g. my-es-snapshots
<do-access-key>         from DO panel → API → Spaces Keys
<do-secret-key>         from DO panel → API → Spaces Keys (shown once)
```

---

## Step 1 — DNS

Create an `A` record for `<hostname>` → `<droplet-ip>` with a low TTL (300 s). Wait for global propagation; verify with `dig` or [DNSChecker](https://dnschecker.org/).

## Step 2 — SSH in

```bash
ssh -i <ssh-key> root@<droplet-ip>
```

All remaining "remote:" steps run as `root` on the droplet.

## Step 3 — System prep (remote)

```bash
# Hostname
hostnamectl set-hostname <hostname>
grep -q "<hostname>" /etc/hosts || echo "127.0.1.1 <hostname>" >> /etc/hosts

# 2 GB swap (ES does not love swap, but on a 2 GB box it's a safety valve)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab
sysctl -w vm.swappiness=10
echo "vm.swappiness=10" > /etc/sysctl.d/99-swap.conf

# Required for Lucene mmap
echo "vm.max_map_count=262144" > /etc/sysctl.d/99-elasticsearch.conf
sysctl -p /etc/sysctl.d/99-elasticsearch.conf

# Dependencies
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl gnupg apt-transport-https ufw ca-certificates jq s3cmd
```

## Step 4 — Install Elasticsearch (remote)

```bash
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch \
  | gpg --dearmor --yes -o /usr/share/keyrings/elasticsearch-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" \
  > /etc/apt/sources.list.d/elastic-8.x.list
apt-get update -qq
apt-get install -y elasticsearch
```

The deb postinst auto-generates a security configuration: a self-signed CA, transport TLS keys, an HTTP TLS keystore, and an `elastic` superuser password. **Capture the password from the install output** — it appears under "Security autoconfiguration information". You will reset it in Step 6 anyway, but keep this initial value handy until then.

## Step 5 — Configure Elasticsearch (remote)

### JVM heap

`/etc/elasticsearch/jvm.options.d/heap.options`:

```
-Xms768m
-Xmx768m
```

> 768 MB is the largest heap that fits comfortably alongside the JVM, ML controller, and OS on a 2 GB box. Disabling ML reclaims a bit more, but the controller process still spawns. If you upgrade to 4 GB+ RAM, raise this to ~1.5 GB.

### Cluster config

`/etc/elasticsearch/elasticsearch.yml` (replaces the auto-generated file):

```yaml
# Cluster / node identity
cluster.name: rga
node.name: rga-1

# Paths
path.data: /var/lib/elasticsearch
path.logs: /var/log/elasticsearch

# Network — bind to loopback only; Caddy reverse-proxies from 443
network.host: 127.0.0.1
network.publish_host: 127.0.0.1
http.port: 9200

# Single-node bootstrap (no cluster formation)
discovery.type: single-node

# Hardening
action.destructive_requires_name: true
xpack.ml.enabled: false

# Security
xpack.security.enabled: true
xpack.security.enrollment.enabled: true

# HTTP TLS — DISABLED. Caddy terminates TLS on 443 publicly.
# ES is bound to localhost so plaintext on the wire here is fine.
xpack.security.http.ssl:
  enabled: false

# Transport TLS — internal node-to-node, uses the keystore generated by the deb installer
xpack.security.transport.ssl:
  enabled: true
  verification_mode: certificate
  keystore.path: certs/transport.p12
  truststore.path: certs/transport.p12
```

Set ownership/permissions and start the service:

```bash
chown root:elasticsearch /etc/elasticsearch/elasticsearch.yml
chmod 660 /etc/elasticsearch/elasticsearch.yml

systemctl daemon-reload
systemctl enable --now elasticsearch
```

Verify the service is up and bound only to loopback:

```bash
systemctl is-active elasticsearch
ss -ltnp | grep -E ":9200|:9300"
# Expect both lines to show 127.0.0.1 only
```

## Step 6 — Reset built-in user passwords (remote)

```bash
# elastic superuser
elastic_pw=$(/usr/share/elasticsearch/bin/elasticsearch-reset-password \
  -u elastic -b -s --url http://127.0.0.1:9200)

# kibana_system service account (Kibana process uses this to talk to ES)
kibana_pw=$(/usr/share/elasticsearch/bin/elasticsearch-reset-password \
  -u kibana_system -b -s --url http://127.0.0.1:9200)
```

Save credentials in root-only files:

```bash
umask 077
cat > /root/elasticsearch-credentials.txt <<EOF
ELASTIC_USER=elastic
ELASTIC_PASSWORD=$elastic_pw
ENDPOINT=https://<hostname>
EOF

cat > /root/kibana-credentials.txt <<EOF
KIBANA_SYSTEM_USER=kibana_system
KIBANA_SYSTEM_PASSWORD=$kibana_pw
EOF
chmod 600 /root/elasticsearch-credentials.txt /root/kibana-credentials.txt
```

Sanity check:

```bash
curl -sS -u "elastic:$elastic_pw" http://127.0.0.1:9200/_cluster/health | jq .
# Expect: status="green", number_of_nodes=1
```

## Step 7 — Install Caddy reverse proxy (remote)

```bash
apt-get install -y -qq debian-keyring debian-archive-keyring
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sed -i "s|browse.cloudsmith.io|dl.cloudsmith.io|g; s|archive.cloudsmith.io|dl.cloudsmith.io|g" \
  /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy
```

`/etc/caddy/Caddyfile`:

```caddy
{
    email <email>
}

<hostname> {
    encode gzip zstd
    reverse_proxy 127.0.0.1:9200
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
```

> Caddy will not be able to obtain a Let's Encrypt cert until port 443 is reachable from the public internet. That happens in Step 8.

## Step 8 — Configure firewall (remote)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  comment "ssh"
ufw allow 443/tcp comment "caddy https"
ufw --force enable
ufw status verbose
```

> Port 80 is **not** opened. Caddy uses TLS-ALPN-01 (port 443) for ACME challenges. The trade-off: typing `http://<hostname>` will time out instead of redirecting to HTTPS — fine for an admin endpoint, since clients always know to use `https://`.

Wait ~10 seconds for Caddy to retry ACME. Verify externally (works from anywhere with public DNS):

```bash
curl -sS -o /dev/null -w "http=%{http_code} ssl_verify=%{ssl_verify_result}\n" \
  -u "elastic:$elastic_pw" https://<hostname>/_cluster/health
# Expect: http=200 ssl_verify=0
```

## Step 9 — Configure DO Spaces snapshot repository (remote)

In the DO control panel:

1. **Spaces Object Storage** → create bucket `<do-bucket>` in region `<do-region>`. Leave "Restrict File Listing" ON; CDN OFF.
2. **API → Spaces Keys** → generate a key with **Read/Write/Delete/List** on `<do-bucket>` (or All Buckets). Save Access Key + Secret — DO shows the secret only once.

On the droplet, store credentials in the **Elasticsearch keystore** (encrypted at rest, never appears in configs or logs):

```bash
printf '<do-access-key>' | /usr/share/elasticsearch/bin/elasticsearch-keystore add \
  --stdin --force s3.client.default.access_key
printf '<do-secret-key>' | /usr/share/elasticsearch/bin/elasticsearch-keystore add \
  --stdin --force s3.client.default.secret_key

# Reload secure settings (no restart needed for s3.client.* keys)
curl -sS -u "elastic:$elastic_pw" -X POST http://127.0.0.1:9200/_nodes/reload_secure_settings | jq .
```

Register the repository and verify it works end-to-end:

```bash
curl -sS -u "elastic:$elastic_pw" -X PUT -H 'Content-Type: application/json' \
  http://127.0.0.1:9200/_snapshot/spaces -d "{
    \"type\": \"s3\",
    \"settings\": {
      \"bucket\":   \"<do-bucket>\",
      \"region\":   \"<do-region>\",
      \"endpoint\": \"<do-region>.digitaloceanspaces.com\",
      \"protocol\": \"https\",
      \"compress\": true
    }
  }" | jq .

curl -sS -u "elastic:$elastic_pw" -X POST \
  http://127.0.0.1:9200/_snapshot/spaces/_verify | jq .
# Expect: a "nodes" object with no errors
```

Install a daily Snapshot Lifecycle Management (SLM) policy:

```bash
curl -sS -u "elastic:$elastic_pw" -X PUT -H 'Content-Type: application/json' \
  http://127.0.0.1:9200/_slm/policy/daily -d '{
    "schedule": "0 30 1 * * ?",
    "name": "<daily-snap-{now/d}>",
    "repository": "spaces",
    "config": {
      "indices": "*",
      "ignore_unavailable": true,
      "include_global_state": true,
      "partial": false
    },
    "retention": {
      "expire_after": "30d",
      "min_count": 5,
      "max_count": 50
    }
  }' | jq .
```

Trigger a one-time test snapshot to confirm:

```bash
curl -sS -u "elastic:$elastic_pw" -X POST \
  http://127.0.0.1:9200/_slm/policy/daily/_execute | jq .

# Poll until SUCCESS
curl -sS -u "elastic:$elastic_pw" \
  http://127.0.0.1:9200/_snapshot/spaces/_all \
  | jq '.snapshots | last | {snapshot, state, total_shards: .shards.total, successful_shards: .shards.successful}'
```

## Step 10 — Local Kibana (developer machine)

Local Kibana lives at `<kibana-compose-dir>/` (e.g., `~/projects/kibana/`). Files:

`compose.yaml`:

```yaml
services:
  kibana:
    image: docker.elastic.co/kibana/kibana:8.19.15
    container_name: kibana
    restart: unless-stopped
    ports:
      - "127.0.0.1:5601:5601"   # loopback only — never expose Kibana on the LAN
    environment:
      ELASTICSEARCH_HOSTS: "https://<hostname>"
      ELASTICSEARCH_USERNAME: kibana_system
      ELASTICSEARCH_PASSWORD: ${KIBANA_SYSTEM_PASSWORD}
      SERVER_HOST: "0.0.0.0"
      SERVER_NAME: rga-kibana
      SERVER_PUBLICBASEURL: "http://localhost:5601"
      NODE_OPTIONS: "--max-old-space-size=768"
      XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY: ${KIBANA_ENCRYPTION_KEY}
      XPACK_REPORTING_ENCRYPTIONKEY: ${KIBANA_ENCRYPTION_KEY}
      XPACK_SECURITY_ENCRYPTIONKEY: ${KIBANA_ENCRYPTION_KEY}
      XPACK_FLEET_ENABLED: "false"
      TELEMETRY_OPTIN: "false"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:5601/api/status || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s
```

`.env` (mode 600, gitignored):

```
KIBANA_SYSTEM_PASSWORD=<paste from /root/kibana-credentials.txt on droplet>
KIBANA_ENCRYPTION_KEY=<32+ random hex chars; openssl rand -hex 16 works>
```

`.gitignore`:

```
.env
```

Pull and start:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Wait ~30 seconds for Kibana to bootstrap, then open <http://localhost:5601> in a browser. Log in as the **`elastic` superuser** (not `kibana_system`).

### Running multiple Kibana instances on the same host (for multi-cluster ops)

If you operate more than one ES cluster and want a Kibana per cluster on the same dev box (e.g., `:5601` for one, `:5602` for another), you'll hit a session-cookie collision: HTTP cookies are scoped by hostname, **not** by port, so both Kibanas share the `localhost` cookie jar. Each Kibana issues its session cookie under the same name (`sid` by default) and overwrites the other's, producing repeated `AUTHENTICATION_ERROR` redirects when switching tabs.

Fix per-instance with `XPACK_SECURITY_COOKIENAME` — give each container a distinct cookie name and keep the rest of the multi-instance pattern straightforward:

```yaml
services:
  kibana-cluster-a:
    # ... rest of config ...
    environment:
      # ... other env ...
      XPACK_SECURITY_COOKIENAME: sid_cluster_a   # <-- unique per instance

  kibana-cluster-b:
    # ... same shape, different port + ELASTICSEARCH_HOSTS + encryption key ...
    environment:
      XPACK_SECURITY_COOKIENAME: sid_cluster_b
```

Each instance also needs its own `XPACK_*ENCRYPTIONKEY` triplet (32+ hex chars, distinct from other instances) and its own `SERVER_PUBLICBASEURL` matching its host port. After applying, **clear browser cookies for `localhost`** (the old `sid` lingers) before logging in fresh.

## Verification checklist

| Check | Command | Expected |
|---|---|---|
| ES service active | `ssh root@<droplet-ip> systemctl is-active elasticsearch` | `active` |
| ES bound only to loopback | `ssh root@<droplet-ip> ss -ltn \| grep 9200` | `127.0.0.1:9200` only |
| Caddy active | `ssh root@<droplet-ip> systemctl is-active caddy` | `active` |
| TLS chain valid externally | `curl -o /dev/null -w '%{ssl_verify_result}\n' https://<hostname>/` | `0` |
| HTTP 401 on unauth | `curl -o /dev/null -w '%{http_code}\n' https://<hostname>/` | `401` |
| Cluster green | `curl -u elastic:<pw> https://<hostname>/_cluster/health \| jq .status` | `"green"` |
| 9200 closed externally | `nc -z -w3 <droplet-ip> 9200; echo $?` | non-zero |
| 80 closed externally | `nc -z -w3 <droplet-ip> 80; echo $?` | non-zero |
| Snapshot repo verified | `curl -u elastic:<pw> -XPOST https://<hostname>/_snapshot/spaces/_verify` | nodes list, no errors |
| SLM has run | `curl -u elastic:<pw> https://<hostname>/_slm/stats \| jq .total_snapshots_taken` | `≥ 1` |
| Kibana available | `curl http://localhost:5601/api/status \| jq .status.overall.level` | `"available"` |

## What is NOT installed

- `certbot` — Caddy handles ACME natively. (The droplet still has `certbot` installed from earlier exploration but its systemd timer is disabled. Remove with `apt-get purge certbot python3-certbot` if desired.)
- Kibana on the droplet — runs on the developer machine via Docker.
- Any monitoring/alerting stack — see "Operational follow-ups" below.

## Operational follow-ups (deferred)

Items the current setup intentionally does **not** include — track separately if/when needed:

- **High availability** — single node = single point of failure. For real HA, add at least 2 more master-eligible nodes across failure domains.
- **Monitoring/alerting** — no Prometheus, Beats, or external uptime monitor. Consider DO's monitoring + a free uptime ping (UptimeRobot, Better Stack) on `https://<hostname>/` returning 401.
- **Application-level users** — every app currently authenticates as `elastic`. Create per-application users or API keys (see USER_GUIDE.md) before exposing the cluster to other services.
- **Snapshot drill** — restore from a snapshot has not been rehearsed. Do this at least once before relying on it.
