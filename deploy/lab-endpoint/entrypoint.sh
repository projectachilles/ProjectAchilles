#!/bin/sh
# Lab endpoint entrypoint.
# - With arguments, runs them (e.g. `achilles-agent --version`).
# - Otherwise: optional localhost forwarder, wait for enrollment, run the agent.
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

CONFIG=/opt/f0/achilles-agent.yaml

# The agent encrypts its key with the machine ID, and slim images have none.
# Keep one in the volume so a recreated container can still read the key.
MACHINE_ID_FILE=/opt/f0/lab-machine-id
if [ ! -s "$MACHINE_ID_FILE" ]; then
  od -An -tx1 -N16 /dev/urandom | tr -d ' \n' > "$MACHINE_ID_FILE"
  chmod 0600 "$MACHINE_ID_FILE"
fi
cp "$MACHINE_ID_FILE" /etc/machine-id

# The agent sends its key over plain HTTP only to localhost
# (agent/internal/config/config.go ValidateServerURL), so forward
# 127.0.0.1:3000 to the backend on the compose network.
if [ -n "${LAB_FORWARD_TO:-}" ]; then
  socat TCP-LISTEN:3000,bind=127.0.0.1,fork,reuseaddr "TCP:${LAB_FORWARD_TO}" &
fi

waited=30
while [ ! -f "$CONFIG" ]; do
  if [ "$waited" -ge 30 ]; then
    echo "Not enrolled yet. Create an enrollment token in ProjectAchilles, then run: docker exec achilles-lab-endpoint enroll <TOKEN>"
    waited=0
  fi
  sleep 1
  waited=$((waited + 1))
done

exec achilles-agent --run
