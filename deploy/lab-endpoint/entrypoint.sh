#!/bin/sh
# Lab endpoint entrypoint.
# - With arguments, runs them (e.g. `achilles-agent --version`).
# - Otherwise: optional localhost forwarder, wait for enrollment, run the agent.
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

CONFIG=/opt/f0/achilles-agent.yaml

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
