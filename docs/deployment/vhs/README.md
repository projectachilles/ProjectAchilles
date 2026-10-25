# On-prem installer screenshots (VHS)

The eight `wiki/static/img/screenshots/onprem-*.png` images used by
`wiki/docs/deployment/server-installer.md` are recorded from the real
`achilles-installer` wizard with [Charm VHS](https://github.com/charmbracelet/vhs).
Nothing is mocked and the installer code has no demo mode: the wizard runs as
root in a throwaway Ubuntu 24.04 container that plays the server.

| File | Purpose |
|------|---------|
| `onprem-wizard.tape` | Walks all ten screens and saves the eight screenshots. |
| `sandbox.sh` | Starts the wizard in the container (called by the tape). |

## What the sandbox does

`sandbox.sh` copies `git archive HEAD` plus `installer/dist/achilles-installer-linux-amd64`
into a fresh container, extracts it to `/opt/projectachilles` and runs
`./achilles-installer install` there. The container:

- runs on a Docker network `pa-vhs` (`10.0.5.0/24`) with the fixed IP `10.0.5.20`
  and `--add-host achilles.corp.example.com:10.0.5.20`, so the DNS check on the
  Network screen passes;
- sets `ACHILLES_RENDER_ONLY=1`, so the Install step writes the rendered files
  (settings, env files, Caddy snippets, a throwaway CA under
  `/etc/projectachilles/ca`, bootstrap scripts) and stops before Docker, the
  firewall and the renewal timer. That is why the Install screenshot shows those
  phases as skipped;
- has no Docker and no `timedatectl`, so Preflight shows those two checks as WARN;
- is removed (`--rm`) when the wizard exits, together with the temporary copy of
  the repository.

The container gets `HEAD` only, so commit anything the screenshots should show
before recording.

## Values typed into the wizard

Placeholders only. Never record real keys.

| Field | Value |
|-------|-------|
| Interface | `eth0` (10.0.5.20) |
| Hostname | `achilles.corp.example.com` |
| LAN subnets | `10.0.5.0/24` (pre-filled) |
| Certificates | ProjectAchilles CA, zone `corp.example.com`, no IP |
| Clerk publishable key | `pk_test_Y2xlcmsuZXhhbXBsZS5jb20k` (base64 of `clerk.example.com$`) |
| Clerk secret key | `sk_test_xxx` (masked on screen) |
| Analytics | Self-hosted Elasticsearch, no demo data |
| Organisation | `Example Corp`, default test library |

The CA fingerprint on the Done screen belongs to the throwaway CA, so it changes
on every run.

## Regenerate

Requirements on the recording machine: Docker, `vhs` (v0.12+, with `ttyd` and
`ffmpeg`), Go (for the installer build) and the JetBrainsMono Nerd Font (or edit
`Set FontFamily` in the tape).

From the repository root:

```bash
# 1. Build the installer (installer/dist/ is gitignored).
make -C installer build

# 2. One-time: the sandbox image and network.
docker build -t pa-vhs-host:local - <<'EOF'
FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates openssl git && rm -rf /var/lib/apt/lists/*
EOF
docker network create --subnet 10.0.5.0/24 --gateway 10.0.5.1 pa-vhs

# 3. Record. SANDBOX_DNS is optional: set it when containers on a
#    user-defined network can't resolve names (Preflight then shows the
#    registry/GitHub/Clerk checks as WARN).
SANDBOX_DNS=1.1.1.1 vhs docs/deployment/vhs/onprem-wizard.tape

# 4. Shrink the PNGs (256-colour palette, visually identical).
for f in wiki/static/img/screenshots/onprem-*.png; do
  ffmpeg -loglevel error -y -i "$f" \
    -vf "split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none" \
    -pred mixed /tmp/onprem-q.png && mv /tmp/onprem-q.png "$f"
done
```

Then open every PNG and check it before committing: the secret key must show
only as `*` / `••••`, and nothing but the placeholder values above may appear.

Clean up afterwards with `docker network rm pa-vhs` and
`docker image rm pa-vhs-host:local`.
