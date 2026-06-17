# LAN agents against a local dev backend

> **Scope.** You already run the ProjectAchilles dev stack (`./scripts/start.sh`) on a
> workstation and want **agents on other machines on the same LAN** to enroll and
> report to it — without standing up a full on-prem server (see
> [`ON_PREM_SERVER.md`](./ON_PREM_SERVER.md) for that).
>
> The agent **refuses to enroll over plaintext HTTP to a non-loopback host** by
> design — the enroll handshake carries the enrollment token and the response carries
> the long-lived agent API key. The two recipes below give agents on the LAN a path
> that respects that guard. **Neither requires modifying the agent.**

## Why the obvious thing fails

Editing `AGENT_SERVER_URL=http://192.168.1.125:3000` in `backend/.env` does **not**
work. The rejection comes from the Go agent
(`agent/internal/config/config.go` → `ValidateServerURL`), which enforces
"encrypted-in-transit **or** loopback" at three independent points:

1. on the `--server` flag you pass to `--enroll`,
2. on the `server_url` the backend returns in the enroll response (this *is*
   `AGENT_SERVER_URL`), and
3. on every config load of the installed service.

`--allow-insecure` does **not** lift this — it only governs TLS certificate
*verification* on an `https://` URL and is never reached during enroll. There is no
flag that permits plaintext to a remote host.

So you must either (A) give the LAN endpoint a **trusted TLS cert**, or (B) make the
agent see the backend as **`localhost`** via an SSH tunnel.

---

## Option A — TLS front with mkcert + Caddy (recommended)

Terminate TLS on the LAN IP with a locally-trusted certificate and reverse-proxy to
the dev backend on loopback. Transit stays encrypted; the agent needs no changes.

```
agent machine ──https──> 192.168.1.125:8443 (Caddy, TLS) ──http──> 127.0.0.1:3000 (backend)
```

Substitute `192.168.1.125` with your workstation's LAN IP throughout.

### 1. On the dev workstation — make a trusted cert

```bash
# Install mkcert + a local CA (Arch shown; use your package manager)
sudo pacman -S mkcert nss     # Debian/Ubuntu: apt install mkcert libnss3-tools
mkcert -install               # creates + trusts a local CA on THIS machine

# Cert valid for the LAN IP (mkcert supports IP SANs)
mkcert 192.168.1.125
# -> ./192.168.1.125.pem  and  ./192.168.1.125-key.pem

mkcert -CAROOT                # prints the dir holding rootCA.pem (needed in step 4)
```

### 2. On the dev workstation — run Caddy as the TLS front

`Caddyfile`:

```caddy
192.168.1.125:8443 {
    tls /absolute/path/192.168.1.125.pem /absolute/path/192.168.1.125-key.pem
    reverse_proxy 127.0.0.1:3000
}
```

```bash
caddy run --config ./Caddyfile      # foreground; or `caddy start` to daemonize
```

> Port `8443` avoids needing root. Use `443` (and drop the port from the URLs below)
> if you can bind privileged ports. Caddy proxies websockets transparently, so
> agent endpoints under `/api/agent/*` work unchanged.

### 3. On the dev workstation — point the backend at the TLS origin

In `backend/.env`:

```dotenv
AGENT_SERVER_URL=https://192.168.1.125:8443
```

Restart the backend (`./scripts/start.sh -k --daemon`). This is the URL the backend
hands agents at enroll time; it must be the **https** origin, not `localhost`.
Also open the chosen port on the workstation's firewall for the LAN.

### 4. On each agent machine — trust the CA, then enroll

The enroll client uses the **system** trust store (it cannot be told to skip
verification), so install the mkcert root CA system-wide. Copy `rootCA.pem` from the
workstation's `mkcert -CAROOT` dir, then:

```bash
# Debian/Ubuntu
sudo cp rootCA.pem /usr/local/share/ca-certificates/achilles-mkcert.crt
sudo update-ca-certificates

# Fedora/RHEL
sudo cp rootCA.pem /etc/pki/ca-trust/source/anchors/achilles-mkcert.pem
sudo update-ca-trust

# macOS
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain rootCA.pem

# Windows (PowerShell, admin)
certutil -addstore -f Root rootCA.pem
```

Then download + enroll exactly as before, but over `https`:

```bash
curl -fSL "https://192.168.1.125:8443/api/agent/download?os=linux&arch=amd64" \
  -o achilles-agent && chmod +x achilles-agent

sudo ./achilles-agent \
  --enroll acht_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --server https://192.168.1.125:8443 \
  --install
```

Because the CA is in the system store, both the enroll handshake and the installed
service verify the cert with no `ca_cert`/`--allow-insecure` needed.

> **No-system-modification variant.** If you can't touch the agent machine's trust
> store, set `SSL_CERT_FILE=/path/rootCA.pem` for the enroll command **and** add
> `ca_cert: /path/rootCA.pem` to the agent config before the service starts (the
> running client reads `ca_cert`; the enroll client reads `SSL_CERT_FILE`). Installing
> the CA system-wide is simpler and is the recommended path.

---

## Option B — SSH tunnel per agent (no certs, no LAN cleartext)

Forward the backend to each agent machine's own `localhost`, then enroll using the
loopback exemption. Nothing crosses the LAN in cleartext — SSH encrypts it — and no
certificates are involved. The trade-off is one persistent tunnel per agent machine.

```
agent machine: localhost:3000 ──ssh tunnel──> dev workstation: 127.0.0.1:3000
```

### 1. On the dev workstation — use the default (localhost) server URL

Leave `AGENT_SERVER_URL` **unset** in `backend/.env` (or set it to
`http://localhost:3000`). The enroll response then returns `http://localhost:3000`,
which every agent accepts via the loopback exemption. Ensure SSH is reachable on the
workstation from the LAN.

> This is mutually exclusive with Option A's `AGENT_SERVER_URL=https://...`. Pick one
> mode per backend.

### 2. On each agent machine — open the tunnel

```bash
# -N: no remote command, -L: forward local 3000 -> workstation's 127.0.0.1:3000
ssh -N -L 3000:127.0.0.1:3000 youruser@192.168.1.125
```

The tunnel must stay up for as long as the agent runs. For an unattended endpoint,
make it durable with `autossh` or a systemd unit:

```ini
# /etc/systemd/system/achilles-tunnel.service
[Unit]
Description=SSH tunnel to ProjectAchilles dev backend
After=network-online.target
Wants=network-online.target

[Service]
# Key-based auth required (no interactive password under systemd)
ExecStart=/usr/bin/ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
  -L 3000:127.0.0.1:3000 youruser@192.168.1.125
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now achilles-tunnel.service
```

### 3. On each agent machine — enroll over localhost

```bash
curl -fSL "http://localhost:3000/api/agent/download?os=linux&arch=amd64" \
  -o achilles-agent && chmod +x achilles-agent

sudo ./achilles-agent \
  --enroll acht_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --server http://localhost:3000 \
  --install
```

---

## Choosing between them

| | Option A — TLS front | Option B — SSH tunnel |
|---|---|---|
| Agent code change | none | none |
| Transit security | TLS (encrypted) | SSH (encrypted) |
| Per-agent setup | install CA once | persistent tunnel + key |
| `AGENT_SERVER_URL` | `https://<ip>:8443` | unset / `http://localhost:3000` |
| Best when | several LAN agents, stable | one or two ad-hoc agents |

## Security caveats (don't skip)

- This is a **dev convenience**, not a production posture. For real deployments use
  [`ON_PREM_SERVER.md`](./ON_PREM_SERVER.md) / [`SELF_HOSTED_SERVER.md`](./SELF_HOSTED_SERVER.md),
  which wire Caddy auto-TLS, proper secrets, and CORS for you.
- mkcert's root CA can mint a cert for **any** name. Treat `rootCA-key.pem` as
  sensitive; never copy the **key** to agent machines (only `rootCA.pem`), and don't
  ship that CA beyond your dev LAN.
- The dev backend runs with relaxed errors, no rate limiting on the static layer, and
  dev-grade secrets. Keep it on a trusted segment.
- Never lower the agent's plaintext guard (e.g. by patching `ValidateServerURL`) to
  avoid this setup — that would put the enrollment token and agent API key on the
  wire in cleartext.
