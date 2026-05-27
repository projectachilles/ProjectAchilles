#!/usr/bin/env bash
# Runs on a fresh Ubuntu 24.04 droplet as root via SSH.
# Hardens the box: UFW, fail2ban, unattended-upgrades, achilles user, sshd lockdown,
# Tailscale join.
#
# Required environment (passed via `ssh ENV=VAL ... 00-bootstrap.sh`):
#   TS_AUTH_KEY     — Tailscale reusable auth key
#   SSH_PUBKEY      — operator's ed25519 public key (single line)
#   HOSTNAME_LABEL  — friendly hostname (e.g. pa-acmecorp-backend)
#   ROLE            — "backend" or "es" — controls UFW ingress rules
#   BACKEND_PRIV_IP — set when ROLE=es; 9200 will be opened only from this IP

set -euo pipefail
IFS=$'\n\t'

: "${TS_AUTH_KEY:?TS_AUTH_KEY required}"
: "${SSH_PUBKEY:?SSH_PUBKEY required}"
: "${HOSTNAME_LABEL:?HOSTNAME_LABEL required}"
: "${ROLE:?ROLE required (backend|es)}"

log() { printf '[bootstrap] %s\n' "$*" >&2; }

# ── Hostname ────────────────────────────────────────────────────────────────
hostnamectl set-hostname "$HOSTNAME_LABEL"
log "hostname → $HOSTNAME_LABEL"

# ── Base packages ───────────────────────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    ufw fail2ban unattended-upgrades \
    curl jq rsync gnupg ca-certificates \
    apt-transport-https \
    python3-systemd

# ── unattended-upgrades ─────────────────────────────────────────────────────
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
log "unattended-upgrades configured (security pocket only, no auto-reboot)"

# ── fail2ban (sshd jail) ────────────────────────────────────────────────────
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled  = true
port     = ssh
filter   = sshd
backend  = systemd
maxretry = 5
findtime = 600
bantime  = 3600
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 || true
log "fail2ban enabled"

# ── achilles user ───────────────────────────────────────────────────────────
if ! id -u achilles >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G sudo achilles
    log "created user 'achilles' (sudo)"
fi
mkdir -p /home/achilles/.ssh
echo "$SSH_PUBKEY" > /home/achilles/.ssh/authorized_keys
chmod 700 /home/achilles/.ssh
chmod 600 /home/achilles/.ssh/authorized_keys
chown -R achilles:achilles /home/achilles/.ssh
echo "achilles ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-achilles
chmod 440 /etc/sudoers.d/90-achilles

# ── sshd lockdown ───────────────────────────────────────────────────────────
sshd_conf=/etc/ssh/sshd_config.d/99-projectachilles.conf
cat > "$sshd_conf" <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
EOF
# Validate before reloading
if ! sshd -t; then
    log "sshd config invalid; aborting before reload"
    exit 1
fi
systemctl reload sshd
log "sshd locked down (root login + password auth disabled)"

# ── UFW ─────────────────────────────────────────────────────────────────────
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp

case "$ROLE" in
    backend)
        ufw allow 80/tcp
        ufw allow 443/tcp
        ;;
    es)
        : "${BACKEND_PRIV_IP:?BACKEND_PRIV_IP required for ROLE=es}"
        ufw allow from "$BACKEND_PRIV_IP" to any port 9200 proto tcp
        ufw allow from "$BACKEND_PRIV_IP" to any port 9300 proto tcp
        # Tailnet CGNAT range — allow ops access via Tailscale
        ufw allow from 100.64.0.0/10 to any port 9200 proto tcp
        ;;
    *)
        log "unknown ROLE=$ROLE"
        exit 1
        ;;
esac
ufw --force enable
log "UFW enabled (role=$ROLE)"

# ── Tailscale ───────────────────────────────────────────────────────────────
if ! command -v tailscale >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
fi
systemctl enable --now tailscaled >/dev/null 2>&1 || true

# `--reset` ensures auth-key re-run is idempotent if previous join was incomplete.
tailscale up \
    --auth-key="$TS_AUTH_KEY" \
    --hostname="$HOSTNAME_LABEL" \
    --ssh \
    --accept-routes \
    --reset \
    >/dev/null

ts_ip=$(tailscale ip -4 2>/dev/null | head -1 || echo "")
log "tailscale joined; ip=${ts_ip:-?}"
echo "TAILNET_IP=${ts_ip}"

log "bootstrap complete for $HOSTNAME_LABEL"
