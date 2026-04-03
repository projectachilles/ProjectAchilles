#!/usr/bin/env bash
set -euo pipefail

# Claude Code PostToolUse hook: reminds about CHANGELOG after feat/fix commits.
# Always exits 0 (never blocks). Runs AFTER the command succeeds.
# Input: $1 is JSON with a "command" field.

TOOL_INPUT="${1:-}"

# Extract the command from JSON input
if command -v jq &>/dev/null; then
  CMD=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null) || CMD=""
else
  CMD=$(echo "$TOOL_INPUT" | grep -oP '"command"\s*:\s*"(?:[^"\\]|\\.)*"' | head -1 | sed 's/^"command"\s*:\s*"//;s/"$//;s/\\"/"/g;s/\\\\/\\/g') || CMD=""
fi

# Only trigger on git commit commands
if [[ ! "$CMD" =~ git[[:space:]]+commit ]]; then
  exit 0
fi

# Get the last commit message subject
LAST_MSG=$(git log -1 --pretty=%s 2>/dev/null) || exit 0

# Check if it's a feat or fix commit
if [[ ! "$LAST_MSG" =~ ^(feat|fix) ]]; then
  exit 0
fi

# Check if CHANGELOG was modified in this commit
if git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null | grep -q "CHANGELOG"; then
  exit 0
fi

echo "" >&2
echo "NOTE: This commit adds a feature/fix but CHANGELOG.md was not updated." >&2
echo "Run /changelog to generate entries, or update docs/CHANGELOG.md manually." >&2

exit 0
