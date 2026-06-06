# Deploying ProjectAchilles On-Premises

This guide deploys a **fully functional on-prem** ProjectAchilles install on a
server **you provide** (reachable over SSH), on your own network, with **working
TLS certificates** — including options that need no public internet exposure.

It shares the same automation as the public deployment
([`SELF_HOSTED_SERVER.md`](./SELF_HOSTED_SERVER.md)); read that for the
architecture diagram, configuration reference, backups, and day-2 operations.
This guide focuses on what's different on-prem: **SSH-based install**,
**certificate strategy on a private network**, and **making agents trust the
server**.

## What's different on-prem

| Concern | Public droplet | On-prem |
|---------|----------------|---------|
| Provisioning | `deploy-do.sh` creates the host | You provide the host; install via SSH |
| Reachability | Public IP, inbound 80/443 | Often internal-only, no inbound from internet |
| DNS | Public A record | Internal/split-horizon DNS to a private IP |
| TLS | Let's Encrypt HTTP-01 | Internal CA, Let's Encrypt DNS-01, or your own cert |
| Agent trust | Automatic (public CA) | May need the root CA distributed to agents |

The server should be **internet-connected** for pulling Docker images, OS
packages, and the git-synced test library. (For air-gapped installs, mirror the
images and repos internally first — not covered here.)

## Prerequisites

- A Linux server (Ubuntu 22.04/24.04 recommended) you can SSH into as root or a
  sudo user. Sizing: **≥4 GB RAM** if self-hosting Elasticsearch, ≥2 GB if using
  Elastic Cloud.
- An internal DNS name for it, e.g. `achilles.corp.example.com`, resolvable on
  your network to the server's (private) IP — via your internal DNS, split-horizon
  zone, or `/etc/hosts` on clients.
- Clerk keys; optionally Elastic Cloud and a GitHub token (private repos).
- On your workstation: `bash`, `ssh`, `rsync`, and a clone of this repo.

## Choose a certificate strategy

Set `TLS_MODE` in `deploy.config.env`. All three on-prem options produce a
**working HTTPS endpoint**; they differ in what (if anything) clients must trust.

| `TLS_MODE` | Use when | Public domain? | Inbound 80/443? | Client setup |
|------------|----------|----------------|-----------------|--------------|
| `internal` | Isolated/LAN, no public domain | No | No | Install exported root CA on browsers + agents |
| `acme-dns` | You own a public domain (even if the host is internal) | Yes | No (uses DNS TXT) | **None** — publicly trusted |
| `byo` | Your org has its own PKI / a cert already | Optional | No | None if clients already trust your CA |

> **Recommendation:** if you own a public domain, `acme-dns` is the smoothest —
> publicly-trusted certs with zero client configuration and no inbound exposure.
> Use `internal` for truly isolated networks, or `byo` to plug into an existing
> enterprise PKI.

## Step 1 — Configure

On your workstation, in the repo:

```bash
cp deploy.config.env.example deploy.config.env
$EDITOR deploy.config.env
```

Common fields:

```ini
ACHILLES_DOMAIN=achilles.corp.example.com
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
ES_MODE=self                 # or cloud
SSH_USER=root
SSH_HOST=10.0.5.20           # the server's reachable IP
REMOTE_DIR=/opt/projectachilles
```

Then add the TLS-mode-specific fields below.

### Option A — Internal CA (`TLS_MODE=internal`)

```ini
TLS_MODE=internal
```

Nothing else needed. Caddy mints a server certificate from a self-signed root CA
it generates on first run. After install, the script exports that root to
`deploy/caddy/certs/root-ca.crt` (see Step 3).

### Option B — Let's Encrypt DNS-01 (`TLS_MODE=acme-dns`)

```ini
TLS_MODE=acme-dns
ACME_EMAIL=admin@example.com
CADDY_DNS_PROVIDER=cloudflare
CADDY_DNS_MODULE=github.com/caddy-dns/cloudflare
CADDY_DNS_TOKEN=<scoped DNS API token>
```

The installer builds a custom Caddy image with the chosen DNS plugin (see
[github.com/caddy-dns](https://github.com/caddy-dns) for provider module paths)
and proves domain ownership via a DNS TXT record — so the server needs **no
inbound 80/443**. The token only needs permission to edit the DNS zone.

### Option C — Bring your own certificate (`TLS_MODE=byo`)

```ini
TLS_MODE=byo
```

Place your PEM files before deploying:

```bash
cp /path/to/fullchain.pem deploy/caddy/certs/cert.pem   # leaf + intermediates
cp /path/to/privkey.pem   deploy/caddy/certs/key.pem    # unencrypted key
```

These are mounted read-only into Caddy. Clients see no warning if they already
trust the issuing CA.

## Step 2 — Install over SSH

From your workstation:

```bash
./scripts/deploy-remote.sh
```

(or `./scripts/deploy-remote.sh user@host` to override the SSH target). This:

1. Waits for SSH, installs `rsync` if missing.
2. Rsyncs the repo to `REMOTE_DIR`.
3. Copies `deploy.config.env` (mode 600) to the server.
4. Runs `scripts/deploy-server.sh` remotely — installs Docker, generates
   secrets, renders the Caddy TLS config, builds, and starts the stack.

You can also SSH in and run `./scripts/deploy-server.sh` directly; it is hybrid
and will prompt for anything not in the config.

### Internal DNS

Make `ACHILLES_DOMAIN` resolve to the server on your network — via your internal
DNS server, a split-horizon zone, or per-client `/etc/hosts`:

```
10.0.5.20   achilles.corp.example.com
```

For `acme-dns`, the public DNS zone is used only for the certificate challenge;
day-to-day resolution can still be internal.

## Step 3 — Make agents (and browsers) trust the server

This step is only needed for `TLS_MODE=internal` (and for `byo` when the cert
comes from a CA your clients don't already trust). For `acme-dns` the cert is
publicly trusted — **skip this step**.

### Get the root CA

After an `internal` install, the script writes it to
`deploy/caddy/certs/root-ca.crt` on the server. Re-export anytime with:

```bash
docker compose -f docker-compose.server.yml exec caddy \
  cat /data/caddy/pki/authorities/local/root.crt > root-ca.crt
```

### Browsers / OS

Import `root-ca.crt` into the OS or browser trust store (e.g. Linux:
`/usr/local/share/ca-certificates/` + `update-ca-certificates`; Windows: Trusted
Root Certification Authorities; macOS: Keychain → System → Always Trust).

### Agents

The Go agent supports a custom CA via its config file
(`/opt/f0/achilles-agent.yaml` on Linux/macOS, `C:\F0\achilles-agent.yaml` on
Windows). Two-step flow:

1. Copy `root-ca.crt` to the endpoint (e.g. `/opt/f0/root-ca.crt` or
   `C:\F0\root-ca.crt`).
2. Enroll, then point the agent at the CA and reload:

```bash
# One-time enroll. Because the config (and thus ca_cert) doesn't exist yet,
# accept the self-signed cert for this initial call only:
sudo ./achilles-agent --enroll <TOKEN> --server https://achilles.corp.example.com \
  --install --allow-insecure

# Add the CA to the agent config so future calls verify the cert:
sudo sed -i 's#^skip_tls_verify:.*#skip_tls_verify: false#' /opt/f0/achilles-agent.yaml
echo 'ca_cert: /opt/f0/root-ca.crt' | sudo tee -a /opt/f0/achilles-agent.yaml

# Apply without restarting:
sudo ./achilles-agent --reload
```

After this the agent verifies the server against your internal root CA on every
heartbeat — `--allow-insecure` is no longer used.

> If your endpoints already trust the internal CA at the OS level (common in
> managed fleets), you can skip `ca_cert` entirely; the agent uses the system
> trust store.

## Verify

```bash
# On the server:
docker compose -f docker-compose.server.yml ps
curl -sk https://achilles.corp.example.com/api/health     # -k tolerates internal CA

# From a client that trusts the CA (no -k needed if trusted):
curl -s https://achilles.corp.example.com/api/health
```

Then open `https://achilles.corp.example.com/` in a browser on the network.

## Day-2, backups, troubleshooting

Identical to the public deployment — see
[`SELF_HOSTED_SERVER.md`](./SELF_HOSTED_SERVER.md#day-2-operations). On-prem
extras:

| Symptom | Check |
|---------|-------|
| Browser shows cert warning (`internal`/`byo`) | Root CA not installed in the client trust store — see Step 3. |
| Agent: `x509: certificate signed by unknown authority` | `ca_cert` not set or wrong path in the agent config; or the CA file wasn't copied to the endpoint. |
| `acme-dns` cert never issues | Wrong `CADDY_DNS_MODULE`/provider or token lacks zone-edit permission: `logs -f caddy`. |
| Can't reach the host | Confirm internal DNS resolves `ACHILLES_DOMAIN` and the server firewall allows 443 from your subnet. |
