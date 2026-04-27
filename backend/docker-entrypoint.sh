#!/bin/sh
# ProjectAchilles backend container entrypoint.
#
# When the operator passes explicit Elasticsearch credentials via env vars
# (CLOUD_ID, API_KEY, USERNAME, or PASSWORD non-empty), wipe any stale
# ~/.projectachilles/analytics.json from a prior session — the backend
# SettingsService prefers the file over env vars when configured:true,
# so without this reset the env vars would be silently ignored.
#
# Plain ELASTICSEARCH_NODE alone (the docker-compose default of
# http://elasticsearch:9200 with no auth) does NOT trigger the wipe —
# users on the bundled --profile elasticsearch path can still configure
# via the UI without losing their settings on each restart.

set -e

ANALYTICS_JSON="/root/.projectachilles/analytics.json"

if [ -f "$ANALYTICS_JSON" ] && {
    [ -n "${ELASTICSEARCH_CLOUD_ID:-}" ] ||
    [ -n "${ELASTICSEARCH_API_KEY:-}" ] ||
    [ -n "${ELASTICSEARCH_USERNAME:-}" ] ||
    [ -n "${ELASTICSEARCH_PASSWORD:-}" ]
}; then
    echo "[entrypoint] Explicit ES env vars detected — wiping stale $ANALYTICS_JSON so env config wins."
    rm -f "$ANALYTICS_JSON"
fi

exec "$@"
