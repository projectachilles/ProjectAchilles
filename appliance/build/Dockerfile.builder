FROM ubuntu:24.04

ARG PACKER_VERSION=1.11.2

ENV DEBIAN_FRONTEND=noninteractive \
    LIBGUESTFS_BACKEND=direct

# linux-image-generic is required: supermin builds the libguestfs appliance
# from the installed kernel.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      qemu-system-x86 qemu-utils ovmf libguestfs-tools linux-image-generic \
      zip unzip curl git ca-certificates openssh-client sshpass jq python3 \
      xorriso \
 && rm -rf /var/lib/apt/lists/* \
 && chmod 0644 /boot/vmlinuz-*

RUN set -eux; \
    base="https://releases.hashicorp.com/packer/${PACKER_VERSION}"; \
    cd /tmp; \
    curl -fsSLO "${base}/packer_${PACKER_VERSION}_linux_amd64.zip"; \
    curl -fsSLO "${base}/packer_${PACKER_VERSION}_SHA256SUMS"; \
    sha256sum -c --ignore-missing "packer_${PACKER_VERSION}_SHA256SUMS" \
      | tee /tmp/packer.sums; \
    grep -q "packer_${PACKER_VERSION}_linux_amd64.zip: OK" /tmp/packer.sums; \
    unzip -o "packer_${PACKER_VERSION}_linux_amd64.zip" packer -d /usr/local/bin; \
    rm -f /tmp/packer*; \
    packer version

# Bake the Packer plugins in, so a build never downloads them: `packer init`
# installs exactly the required_plugins versions of the template (checksums
# verified by Packer) into PACKER_PLUGIN_PATH.
ENV PACKER_PLUGIN_PATH=/opt/packer/plugins \
    CHECKPOINT_DISABLE=1
# Only the plugin pin is copied, so template edits keep this layer cached.
COPY plugins.pkr.hcl /tmp/packer-init/
RUN set -eux; \
    mkdir -p "$PACKER_PLUGIN_PATH"; \
    for i in 1 2 3 4 5; do \
      packer init /tmp/packer-init && break; \
      [ "$i" -lt 5 ] && sleep 10; \
    done; \
    rm -rf /tmp/packer-init; \
    packer plugins installed | grep -q 'packer-plugin-qemu_v'
