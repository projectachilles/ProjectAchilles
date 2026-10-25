---
sidebar_position: 5
title: On-Prem Server
description: Deploy ProjectAchilles on-premises over SSH with working TLS — internal CA, Let's Encrypt DNS-01, or your own certificate.
---

# On-Prem Server Deployment

Deploy a **fully functional on-prem** ProjectAchilles install on a server **you
provide** (reachable over SSH), on your own network, with **working TLS** —
including options that need no public internet exposure.

:::tip[Windows fleet on a LAN with no public IP?]
The [Server Installer guide](./server-installer) covers the interactive `achilles-installer` wizard: a managed name-constrained CA and GPO-based trust for Windows endpoints on a LAN, or Let's Encrypt on a cloud server.
:::

This shares the same automation as the [Public Server](./public-server) install;
that page holds the architecture, backups, and day-2 reference. This page focuses
on what's different on-prem: **SSH-based install**, **certificate strategy on a
private network**, and **making agents trust the server**.

## What's different on-prem

| Concern | Public droplet | On-prem |
|---------|----------------|---------|
| Provisioning | `deploy-do.sh` creates the host | You provide the host; install via SSH |
| Reachability | Public IP, inbound 80/443 | Often internal-only, no inbound from internet |
| DNS | Public A record | Internal/split-horizon DNS to a private IP |
| TLS | Let's Encrypt HTTP-01 | Internal CA, Let's Encrypt DNS-01, or your own cert |
| Agent trust | Automatic (public CA) | May need the root CA distributed to agents |

The server should be **internet-connected** to pull Docker images, OS packages,
and the git-synced test library.

## Choose a certificate strategy

Set `TLS_MODE` in `deploy.config.env`. All three produce a working HTTPS
endpoint; they differ in what (if anything) clients must trust.

| `TLS_MODE` | Use when | Public domain? | Inbound 80/443? | Client setup |
|------------|----------|----------------|-----------------|--------------|
| `internal` | Isolated/LAN, no public domain | No | No | Install exported root CA on browsers + agents |
| `acme-dns` | You own a public domain (host may be internal) | Yes | No (DNS TXT) | **None** — publicly trusted |
| `byo` | Your org has its own PKI / a cert already | Optional | No | None if clients already trust your CA |

:::tip[Recommendation]
If you own a public domain, `acme-dns` is smoothest — publicly-trusted certs,
zero client setup, no inbound exposure. Use `internal` for truly isolated
networks (for a LAN with Windows endpoints, prefer the
[Server Installer](./server-installer) guide's name-constrained CA, `TLS_MODE=achilles-ca`),
or `byo` to plug into an existing enterprise PKI.
:::

## Step 1: Configure

On your workstation, in the repo:

```bash
cp deploy.config.env.example deploy.config.env
$EDITOR deploy.config.env
```

```ini
ACHILLES_DOMAIN=achilles.corp.example.com
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
ES_MODE=self
SSH_USER=root
SSH_HOST=10.0.5.20          # the server's reachable IP
REMOTE_DIR=/opt/projectachilles
```

Then add the TLS-mode fields:

```ini
# Option A — internal CA (nothing else needed)
TLS_MODE=internal

# Option B — Let's Encrypt DNS-01
TLS_MODE=acme-dns
ACME_EMAIL=admin@example.com
CADDY_DNS_PROVIDER=cloudflare
CADDY_DNS_MODULE=github.com/caddy-dns/cloudflare
CADDY_DNS_TOKEN=<scoped DNS API token>

# Option C — bring your own cert (place PEMs first)
TLS_MODE=byo
#   cp fullchain.pem deploy/caddy/certs/cert.pem
#   cp privkey.pem   deploy/caddy/certs/key.pem
```

See [github.com/caddy-dns](https://github.com/caddy-dns) for DNS provider module
paths. The installer builds a custom Caddy image with the plugin automatically.

## Step 2: Install over SSH

```bash
./scripts/deploy-remote.sh            # uses SSH_* from the config
# or: ./scripts/deploy-remote.sh user@host
```

This rsyncs the repo, copies your config (mode 600), and runs the installer
remotely — installing Docker, generating secrets, rendering Caddy TLS, building,
and starting the stack.

Make `ACHILLES_DOMAIN` resolve to the server on your network via internal DNS, a
split-horizon zone, or per-client `/etc/hosts`:

```
10.0.5.20   achilles.corp.example.com
```

## Step 3: Make agents (and browsers) trust the server

Only needed for `TLS_MODE=internal` (and `byo` when clients don't already trust
the issuing CA). For `acme-dns` the cert is publicly trusted — **skip this step**.

### Get the root CA

After an `internal` install, the script writes it to
`deploy/caddy/certs/root-ca.crt`. Re-export anytime:

```bash
docker compose -f docker-compose.server.yml exec caddy \
  cat /data/caddy/pki/authorities/local/root.crt > root-ca.crt
```

### Browsers / OS

Import `root-ca.crt` into the OS/browser trust store (Linux:
`/usr/local/share/ca-certificates/` + `update-ca-certificates`; Windows: Trusted
Root Certification Authorities; macOS: Keychain → System → Always Trust).

### Agents

The agent's enroll handshake verifies the server certificate against the
endpoint's **system trust store**. It has no option to skip verification:
`--allow-insecure` is not consulted during `--enroll`, and `ca_cert` doesn't
exist until enrollment writes the config. So the root CA must be trusted at the
OS level **before** enrolling:

1. Copy `root-ca.crt` to the endpoint and install it system-wide:

```bash
# Debian/Ubuntu
sudo cp root-ca.crt /usr/local/share/ca-certificates/achilles-root-ca.crt
sudo update-ca-certificates

# Fedora/RHEL
sudo cp root-ca.crt /etc/pki/ca-trust/source/anchors/achilles-root-ca.crt
sudo update-ca-trust

# macOS
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain root-ca.crt
```

```powershell
# Windows (PowerShell, admin): Local Machine > Trusted Root Certification Authorities
certutil -addstore -f Root root-ca.crt
```

2. Enroll over `https://`:

```bash
sudo ./achilles-agent --enroll <TOKEN> --server https://achilles.corp.example.com --install
```

Both the enroll handshake and the installed service then verify the server
against your internal root CA. No `ca_cert` or `--allow-insecure` is needed.

> Managed fleets that already distribute the internal CA (e.g. via GPO) can skip
> step 1. If you can't modify a Linux endpoint's trust store, set
> `SSL_CERT_FILE=/path/root-ca.crt` for the enroll command, then add
> `ca_cert: /path/root-ca.crt` to the agent config (`/opt/f0/achilles-agent.yaml`)
> and run `sudo ./achilles-agent --reload`. The enroll client reads
> `SSL_CERT_FILE`; the running service reads `ca_cert`.

## Verify

```bash
curl -sk https://achilles.corp.example.com/api/health   # -k tolerates internal CA
```

Then open `https://achilles.corp.example.com/` from a client on the network.

:::warning[Set up roles in Clerk]
Every user without a role is read-only. In the Clerk Dashboard, add the
`metadata` claim to the session token, then give your own account
`{"role": "admin"}` in its public metadata and sign in again:
[session token claim](./prerequisites#session-token-claim) and
[first admin](./prerequisites#first-admin). Invite everyone else from
**Settings → Users**.
:::

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Browser cert warning (`internal`/`byo`) | Root CA not installed in the client trust store. |
| Agent: `x509: certificate signed by unknown authority` | The root CA isn't in the endpoint's system trust store (required for `--enroll`; see Step 3), or `ca_cert` points to a wrong path. |
| Agent: `uses plaintext HTTP to a remote host` | Expected: the agent never enrolls over `http://` to a non-loopback host, and `--allow-insecure` doesn't change that. Use the `https://` URL and make sure `AGENT_SERVER_URL` in `backend/.env` is that `https://` URL. |
| `acme-dns` cert never issues | Wrong `CADDY_DNS_MODULE`/provider or token lacks zone-edit permission: `logs -f caddy`. |
| Can't reach the host | Internal DNS resolves `ACHILLES_DOMAIN`? Firewall allows 443 from your subnet? |

:::info[Full reference]
The complete guide is in
[`docs/deployment/ON_PREM_SERVER.md`](https://github.com/projectachilles/ProjectAchilles/blob/main/docs/deployment/ON_PREM_SERVER.md).
:::
