#!/usr/bin/env bash
set -euo pipefail

# Claude Code PreToolUse hook: validates conventional commit messages.
# Exit 0 = allow, Exit 2 = block with explanation.
# Input: $1 is JSON with a "command" field.

TOOL_INPUT="${1:-}"

# Extract the command from JSON input
if command -v jq &>/dev/null; then
  CMD=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null) || CMD=""
else
  CMD=$(echo "$TOOL_INPUT" | grep -oP '"command"\s*:\s*"(?:[^"\\]|\\.)*"' | head -1 | sed 's/^"command"\s*:\s*"//;s/"$//;s/\\"/"/g;s/\\\\/\\/g') || CMD=""
fi

# Only validate git commit commands
if [[ ! "$CMD" =~ git[[:space:]]+commit ]]; then
  exit 0
fi

# Extract commit message — handle both -m "msg" and heredoc patterns
MSG=""
if [[ "$CMD" =~ -m[[:space:]]+\"([^\"]+)\" ]]; then
  MSG="${BASH_REMATCH[1]}"
elif [[ "$CMD" =~ -m[[:space:]]+\'\(\(cat ]]; then
  # Heredoc pattern: git commit -m "$(cat <<'EOF' ... EOF )"
  MSG=$(echo "$CMD" | sed -n '/<<.*EOF/,/^[[:space:]]*EOF/{/<<.*EOF/d;/^[[:space:]]*EOF/d;p}' | head -1)
elif [[ "$CMD" =~ -m[[:space:]]+\'([^\']+)\' ]]; then
  MSG="${BASH_REMATCH[1]}"
fi

# If we couldn't extract a message, allow (might be interactive commit)
if [[ -z "$MSG" ]]; then
  exit 0
fi

# Take only the first line (subject line)
SUBJECT=$(echo "$MSG" | head -1)

# Skip merge commits
if [[ "$SUBJECT" =~ ^Merge[[:space:]] ]]; then
  exit 0
fi

# Skip revert commits
if [[ "$SUBJECT" =~ ^Revert[[:space:]] ]]; then
  exit 0
fi

VALID_TYPES="feat|fix|docs|style|refactor|perf|test|chore"
VALID_SCOPES="frontend|backend|backend-serverless|agent|analytics|browser|docker|render|vercel|fly|settings|certs|deps|ci|release|wiki"

# Pattern: type(scope): description  OR  type: description  OR  type!: description (breaking)
PATTERN="^(${VALID_TYPES})(\((${VALID_SCOPES})\))?!?:[[:space:]].+"

if [[ ! "$SUBJECT" =~ $PATTERN ]]; then
  echo "BLOCKED: Commit message does not follow conventional commit format." >&2
  echo "" >&2
  echo "Expected: <type>(<scope>): <description>" >&2
  echo "     or:  <type>: <description>" >&2
  echo "" >&2
  echo "Valid types:  feat, fix, docs, style, refactor, perf, test, chore" >&2
  echo "Valid scopes: frontend, backend, backend-serverless, agent, analytics," >&2
  echo "              browser, docker, render, vercel, fly, settings, certs," >&2
  echo "              deps, ci, release, wiki" >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  feat(frontend): add dark mode toggle" >&2
  echo "  fix(backend): resolve memory leak in agent polling" >&2
  echo "  chore(deps): bump vite to 7.2.0" >&2
  echo "" >&2
  echo "Your message: $SUBJECT" >&2
  exit 2
fi

# Check description starts lowercase (allow backtick, quote, or digit)
DESC="${SUBJECT#*: }"
if [[ "$DESC" =~ ^[A-Z] ]]; then
  echo "BLOCKED: Commit description should start with a lowercase letter." >&2
  echo "Your message: $SUBJECT" >&2
  echo "Tip: change '${DESC:0:1}' to '$(echo "${DESC:0:1}" | tr '[:upper:]' '[:lower:]')'" >&2
  exit 2
fi

# Check no trailing period
if [[ "$DESC" =~ \.$ ]]; then
  echo "BLOCKED: Commit description should not end with a period." >&2
  echo "Your message: $SUBJECT" >&2
  exit 2
fi

exit 0
