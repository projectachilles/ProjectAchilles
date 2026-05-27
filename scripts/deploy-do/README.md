# ProjectAchilles → DigitalOcean Deployer

Provisions a two-droplet ProjectAchilles tenant on Digital Ocean:

- **Backend droplet** — Node.js backend + built SPA + Caddy (auto-TLS), public
- **ES droplet** — Elasticsearch 8.17 single-node, private VPC + Tailscale only

Cost: ~$30-36/mo total ($12 backend + $18 ES + ~$6 weekly snapshots).

## Quick start

```bash
# 1. One-time setup on your laptop
pacman -S doctl bind jq rsync          # Arch
# apt install doctl bind9-dnsutils jq  # Debian/Ubuntu

doctl auth init                         # paste your DO API token (write scope)

# 2. Generate a reusable Tailscale auth key:
#    https://login.tailscale.com/admin/settings/keys
#    → New auth key → Reusable, Ephemeral, Pre-authorized, 90d expiry
#    Copy the tskey-auth-... value.

# 3. Run the deploy
cd /path/to/ProjectAchilles
./scripts/deploy-do/deploy.sh --tenant acmecorp
```

Follow the prompts. When the script prints the DNS box, add the two A records at your DNS provider and wait — the script polls public resolvers automatically.

## Commands

```bash
./scripts/deploy-do/deploy.sh --tenant <slug>          # Start / resume a deploy
./scripts/deploy-do/deploy.sh --tenant <slug> --status # Print state file
./scripts/deploy-do/deploy.sh --tenant <slug> --reset  # Drop state (NOT droplets)
./scripts/deploy-do/deploy.sh --help                   # Help
```

## Architecture

```
                ┌─────────────────────────────────┐
                │  Caddy (auto-TLS, vhost router) │
                │  ├── <spa fqdn>     → dist/     │
                │  └── <agent fqdn>   → :3000     │
                └──────────────┬──────────────────┘
                               │
       ┌───────────────────────┼─────────────────────────┐
       │                       │                         │
┌──────▼─────┐         ┌───────▼───────┐         ┌───────▼───────┐
│  Backend   │         │  Frontend     │         │   SQLite      │
│  (systemd) │         │  dist/  files │         │   ~/.proj…/   │
│  :3000     │         │  + env-config │         │   agents.db   │
└──────┬─────┘         └───────────────┘         └───────────────┘
       │
       │  HTTPS  (private VPC)  with API key
       │
┌──────▼───────────────────┐
│  Elasticsearch 8.17      │
│  ${private_ip}:9200      │
│  ─ JVM 768 MB heap       │
│  ─ xpack.security on     │
│  ─ API key auth          │
│  ─ private VPC + tailnet │
└──────────────────────────┘
```

## Phases

| # | Phase | What runs | Idempotent |
|---|---|---|---|
| 1 | preflight | doctl auth check, SSH key gen + upload | ✓ |
| 2 | collect | All prompts (FQDNs, Clerk, Tailscale, region, sizes) | ✓ — cached in state |
| 3 | provision | `doctl`: VPC, droplets, firewalls, project | ✓ — uses name-tag lookup |
| 4 | bootstrap | UFW, fail2ban, unattended-upgrades, achilles user, Tailscale join | ✓ |
| 5 | install_es | ES 8.17 install, API key creation | ✓ — preserves /root/.es_credentials |
| 6 | dns_wait | Print A records, poll public DNS until both resolve | Resume re-enters cleanly |
| 7 | install_backend | rsync repo, npm ci, npm run build, systemd unit, Caddy install | ✓ |
| 8 | caddy_tls | Wait for ACME to issue both certs | ✓ |
| 9 | verify | Curl SPA + env-config + /api/health + ES cluster + ES write probe | ✓ |

## Bancocaribe-bug avoidance

Each issue from the bancocaribe deploy (May 2026) is structurally prevented:

| Issue | Prevention |
|---|---|
| `VITE_API_URL` shell-export trap | `npm run build` reads `.env` at build time; no `start.sh` runtime path |
| `ELASTICSEARCH_INDEX_PATTERN=achilles-results-*` rejection | Template writes `achilles-results` (no `*`); Phase 9 write probe regression-tests it |
| Vite dev server in prod | `npm run dev` never runs on the droplet |
| Inverted domain pattern | Two explicit FQDN prompts; default suggestion uses `agent.<spa>` |
| `CORS_ORIGIN` unset | Backend `.env` template requires `CORS_ORIGIN=https://<SPA_FQDN>` |
| Clerk dev keys on prod demo | `clerk_prompt_keys` warns + confirms when `pk_test_*` used |
| No UFW/fail2ban | Bootstrap installs both unconditionally |
| No snapshots | `--enable-backups` default at droplet create; opt-out at prompt |
| `--daemon` zombie PIDs | Backend runs under systemd with `Restart=on-failure` |

## State file

Per-tenant JSON at `~/.config/projectachilles-deploy/<tenant>.state.json` (mode 0600):

```json
{
  "tenant": "acmecorp",
  "fqdn_spa": "demo.acmecorp.com",
  "fqdn_agent": "agent.demo.acmecorp.com",
  "region": "nyc3",
  "phases_completed": ["preflight", "collect", "provision", ...],
  "vpc_id": "...",
  "backend_droplet": { "id": ..., "public_ip": "...", "private_ip": "...", "tailnet_ip": "..." },
  "es_droplet":      { "id": ..., "public_ip": "...", "private_ip": "...", "tailnet_ip": "..." },
  "es_api_key": "<base64>",
  "es_api_key_fingerprint": "sha256:...",
  "clerk_pk": "pk_live_...",
  "clerk_sk": "sk_live_...",
  "tailscale_auth_key": "tskey-auth-...",
  "ssh_key_path": "~/.ssh/projectachilles-deploy_ed25519",
  "do_ssh_key_id": "...",
  "snapshots_enabled": "true",
  "acme_email": "ops@example.com",
  "created_at": "...",
  "updated_at": "..."
}
```

This file contains secrets (Clerk SK, ES API key, Tailscale key). It is created mode `0600` automatically. Treat it like a credential.

## Tear-down (manual for now)

```bash
TENANT=acmecorp
# Delete droplets
doctl compute droplet delete --tag-name "pa-${TENANT}" --force
# Delete firewalls
for fw in $(doctl compute firewall list --format ID,Name --no-header | awk -v t="$TENANT" '$2 ~ ("pa-" t) {print $1}'); do
    doctl compute firewall delete --force "$fw"
done
# Delete VPC (only after droplets removed)
doctl vpcs delete "$(doctl vpcs list --format ID,Name --no-header | awk -v t="$TENANT" '$2=="pa-"t"-vpc"{print $1}')" --force
# Delete state
rm "$HOME/.config/projectachilles-deploy/${TENANT}.state.json"
```

(A `--teardown` mode is on the roadmap.)

## Security notes

- **DO API token** lives in `~/.config/doctl/config.yaml` (managed by `doctl auth init`, mode 0600)
- **Per-tenant secrets** in the state file (mode 0600) and on the droplet at `/etc/projectachilles/secrets.env` (mode 0600, owned by `achilles`)
- **Tailscale** join uses your reusable auth key; both droplets become tailnet nodes named `pa-<tenant>-backend` and `pa-<tenant>-es`
- **ES** is reachable only from the backend droplet's private VPC IP and from the tailnet — never from the public internet
- **TLS** auto-managed by Caddy (Let's Encrypt) with HSTS

## Required local tools

- `doctl` ≥ 1.100 — `pacman -S doctl` / install instructions: https://docs.digitalocean.com/reference/doctl/how-to/install/
- `dig` (from bind / dnsutils)
- `jq`
- `rsync`
- `openssh-client` (ssh, ssh-keygen, scp)
- `curl`

## Required accounts

- Digital Ocean (API token with write scope)
- Tailscale (free tier — reusable auth key)
- Clerk (existing or new app, publishable + secret keys)
- A DNS provider where you control the SPA + agent FQDNs (Cloudflare, Route53, etc.)
- Let's Encrypt has no signup; Caddy handles it
