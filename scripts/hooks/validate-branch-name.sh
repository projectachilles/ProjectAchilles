#!/usr/bin/env bash
set -euo pipefail

# Claude Code PreToolUse hook: warns on non-conventional branch names.
# Always exits 0 (never blocks), just prints warnings to stderr.
# Input: $1 is JSON with a "command" field.

TOOL_INPUT="${1:-}"

# Extract the command from JSON input
if command -v jq &>/dev/null; then
  CMD=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null) || CMD=""
else
  CMD=$(echo "$TOOL_INPUT" | grep -oP '"command"\s*:\s*"(?:[^"\\]|\\.)*"' | head -1 | sed 's/^"command"\s*:\s*"//;s/"$//;s/\\"/"/g;s/\\\\/\\/g') || CMD=""
fi

# Only check branch creation commands
BRANCH=""
if [[ "$CMD" =~ git[[:space:]]+checkout[[:space:]]+-b[[:space:]]+([^[:space:]]+) ]]; then
  BRANCH="${BASH_REMATCH[1]}"
elif [[ "$CMD" =~ git[[:space:]]+switch[[:space:]]+-c[[:space:]]+([^[:space:]]+) ]]; then
  BRANCH="${BASH_REMATCH[1]}"
fi

# Not a branch creation command — pass through
if [[ -z "$BRANCH" ]]; then
  exit 0
fi

VALID_PREFIXES="feature/|fix/|docs/|refactor/|chore/|perf/|test/"

# Check prefix
if [[ ! "$BRANCH" =~ ^(${VALID_PREFIXES}) ]]; then
  echo "WARNING: Branch name '$BRANCH' does not follow naming convention." >&2
  echo "Expected prefixes: feature/, fix/, docs/, refactor/, chore/, perf/, test/" >&2
  echo "Example: feature/add-release-tooling" >&2
fi

# Check for uppercase letters
if [[ "$BRANCH" =~ [A-Z] ]]; then
  echo "WARNING: Branch name '$BRANCH' contains uppercase letters. Use lowercase with hyphens." >&2
fi

# Check for spaces
if [[ "$BRANCH" =~ [[:space:]] ]]; then
  echo "WARNING: Branch name '$BRANCH' contains spaces. Use hyphens instead." >&2
fi

# Always allow — warnings only
exit 0
