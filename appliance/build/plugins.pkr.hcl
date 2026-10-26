# Packer plugins for the appliance build (appliance.pkr.hcl, same directory).
# The qemu plugin is baked into the builder image (Dockerfile.builder copies
# this file and runs `packer init`), so a build never downloads plugins.
# 1.1.3 is the newest release Packer 1.11's `packer init` can fetch: later
# ones are published only on releases.hashicorp.com, not GitHub.

packer {
  required_plugins {
    qemu = {
      source  = "github.com/hashicorp/qemu"
      version = "= 1.1.3"
    }
  }
}

