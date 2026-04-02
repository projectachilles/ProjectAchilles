#!/usr/bin/env bash
#
# check-docs-drift.sh — Detects code changes that may require documentation updates.
#
# Used as a Claude Code Stop hook. Checks uncommitted changes and the most recent
# commit for code paths that map to documentation pages in wiki/ and README.md.
# Outputs a reminder only when applicable.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0

# Gather changed files: uncommitted + last commit (if committed this session)
changed_files=$(
  {
    git diff --name-only 2>/dev/null
    git diff --cached --name-only 2>/dev/null
    # Include last commit if it was made in the last 30 minutes (likely this session)
    last_commit_age=$(( $(date +%s) - $(git log -1 --format=%ct 2>/dev/null || echo 0) ))
    if [ "$last_commit_age" -lt 1800 ]; then
      git diff HEAD~1 --name-only 2>/dev/null
    fi
  } | sort -u
)

[ -z "$changed_files" ] && exit 0

# Skip if changes are ONLY in docs/wiki/README (no code changes to document)
code_changes=$(echo "$changed_files" | grep -v -E '^(wiki/|docs/|README\.md|CLAUDE\.md|CHANGELOG\.md|\.github/)' || true)
[ -z "$code_changes" ] && exit 0

# Map code paths to documentation pages
suggestions=""

add() {
  local doc="$1" reason="$2"
  suggestions="${suggestions}  - ${doc} (${reason})\n"
}

while IFS= read -r file; do
  case "$file" in
    backend/src/services/defender/*|backend-serverless/src/services/defender/*)
      add "wiki: user-guide/integrations/microsoft-defender.md" "Defender service changed" ;;
    backend/src/services/agent/*|backend-serverless/src/services/agent/*)
      add "wiki: user-guide/agent-management/" "Agent service changed" ;;
    backend/src/services/analytics/*|backend-serverless/src/services/analytics/*)
      add "wiki: user-guide/analytics/defense-score.md" "Analytics service changed" ;;
    backend/src/services/alerting/*|backend-serverless/src/services/alerting/*)
      add "wiki: user-guide/integrations/alerting.md" "Alerting service changed" ;;
    backend/src/services/browser/*|backend-serverless/src/services/browser/*)
      add "wiki: user-guide/test-browser/" "Browser service changed" ;;
    backend/src/services/tests/*|backend-serverless/src/services/tests/*)
      add "wiki: user-guide/test-browser/building-signing.md" "Build/test service changed" ;;
    backend/src/services/risk-acceptance/*|backend-serverless/src/services/risk-acceptance/*)
      add "wiki: user-guide/analytics/risk-acceptance.md" "Risk acceptance service changed" ;;
    backend/src/api/*.routes.ts|backend-serverless/src/api/*.routes.ts)
      add "wiki: api-reference/" "API routes changed" ;;
    backend/src/middleware/*)
      add "wiki: developer-guide/backend/routes-middleware.md" "Middleware changed" ;;
    frontend/src/pages/analytics/*)
      add "wiki: user-guide/analytics/" "Analytics frontend changed" ;;
    frontend/src/pages/browser/*)
      add "wiki: user-guide/test-browser/" "Test browser frontend changed" ;;
    frontend/src/pages/endpoints/*)
      add "wiki: user-guide/agent-management/" "Agent frontend changed" ;;
    frontend/src/pages/settings/*)
      add "wiki: user-guide/settings/" "Settings frontend changed" ;;
    frontend/src/components/shared/ui/*)
      add "wiki: developer-guide/frontend/ui-components.md" "UI components changed" ;;
    agent/*.go|agent/internal/*)
      add "wiki: developer-guide/agent/" "Go agent changed" ;;
    cli/src/commands/*|cli/src/chat/*)
      add "wiki: user-guide/cli/" "CLI changed" ;;
    docker-compose.yml)
      add "wiki: deployment/docker-compose.md" "Docker Compose changed" ;;
    scripts/*)
      add "wiki: getting-started/quick-start-local.md" "Scripts changed" ;;
  esac
done <<< "$code_changes"

# Deduplicate
suggestions=$(echo -e "$suggestions" | sort -u)

[ -z "$suggestions" ] && exit 0

echo "Documentation may need updating based on code changes in this session:"
echo ""
echo "$suggestions"
echo ""
echo "Review these pages and update if the changes affect user-facing behavior, API contracts, or configuration."
