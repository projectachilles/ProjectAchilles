#!/usr/bin/env bash
set -euo pipefail

# Claude Code PreToolUse hook: validates version consistency before pushing tags.
# Exit 0 = allow, Exit 2 = block with explanation.
# Input: $1 is JSON with a "command" field.

TOOL_INPUT="${1:-}"

# Extract the command from JSON input
if command -v jq &>/dev/null; then
  CMD=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null) || CMD=""
else
  CMD=$(echo "$TOOL_INPUT" | grep -oP '"command"\s*:\s*"(?:[^"\\]|\\.)*"' | head -1 | sed 's/^"command"\s*:\s*"//;s/"$//;s/\\"/"/g;s/\\\\/\\/g') || CMD=""
fi

# Only validate git push commands that include tags
if [[ ! "$CMD" =~ git[[:space:]]+push ]]; then
  exit 0
fi

if [[ ! "$CMD" =~ --tags ]] && [[ ! "$CMD" =~ refs/tags/ ]] && [[ ! "$CMD" =~ [[:space:]]v[0-9] ]] && [[ ! "$CMD" =~ [[:space:]]agent-v[0-9] ]]; then
  exit 0
fi

ERRORS=""

# Helper: extract version from JSON field using jq or grep
get_pkg_version() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "MISSING"
    return
  fi
  if command -v jq &>/dev/null; then
    jq -r '.version' "$file" 2>/dev/null || echo "PARSE_ERROR"
  else
    grep -oP '"version"\s*:\s*"([^"]+)"' "$file" | head -1 | grep -oP '(?<=")[0-9]+\.[0-9]+\.[0-9]+' || echo "PARSE_ERROR"
  fi
}

# Check platform tags (v*.*.*)
validate_platform_tag() {
  local tag="$1"
  local version="${tag#v}"

  # Check package.json versions
  local fe_ver be_ver bs_ver
  fe_ver=$(get_pkg_version "frontend/package.json")
  be_ver=$(get_pkg_version "backend/package.json")
  bs_ver=$(get_pkg_version "backend-serverless/package.json")

  if [[ "$fe_ver" != "$version" ]]; then
    ERRORS+="  - frontend/package.json: $fe_ver (expected $version)\n"
  fi
  if [[ "$be_ver" != "$version" ]]; then
    ERRORS+="  - backend/package.json: $be_ver (expected $version)\n"
  fi
  if [[ "$bs_ver" != "$version" ]]; then
    ERRORS+="  - backend-serverless/package.json: $bs_ver (expected $version)\n"
  fi

  # Check CHANGELOG has this version
  if ! grep -qP "^## \[$version\]" docs/CHANGELOG.md 2>/dev/null; then
    ERRORS+="  - docs/CHANGELOG.md: missing '## [$version]' section\n"
  fi
}

# Check agent tags (agent-v*.*.*)
validate_agent_tag() {
  local tag="$1"
  local version="${tag#agent-v}"

  # Check Makefile VERSION
  local makefile_ver
  makefile_ver=$(grep -oP '^VERSION\s*:=\s*\K[0-9]+\.[0-9]+\.[0-9]+' agent/Makefile 2>/dev/null) || makefile_ver="MISSING"
  if [[ "$makefile_ver" != "$version" ]]; then
    ERRORS+="  - agent/Makefile VERSION: $makefile_ver (expected $version)\n"
  fi

  # Check main.go version
  local main_ver
  main_ver=$(grep -oP 'var version\s*=\s*"\K[0-9]+\.[0-9]+\.[0-9]+' agent/main.go 2>/dev/null) || main_ver="MISSING"
  if [[ "$main_ver" != "$version" ]]; then
    ERRORS+="  - agent/main.go version: $main_ver (expected $version)\n"
  fi

  # Check CHANGELOG has agent version section
  if ! grep -qP "^## Agent \[$version\]" docs/CHANGELOG.md 2>/dev/null; then
    ERRORS+="  - docs/CHANGELOG.md: missing '## Agent [$version]' section\n"
  fi
}

# Find tags that would be pushed
for tag in $(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null); do
  # Check if tag exists on remote
  if ! git ls-remote --tags origin "refs/tags/$tag" 2>/dev/null | grep -q "$tag"; then
    validate_platform_tag "$tag"
  fi
done

for tag in $(git tag -l 'agent-v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null); do
  if ! git ls-remote --tags origin "refs/tags/$tag" 2>/dev/null | grep -q "$tag"; then
    validate_agent_tag "$tag"
  fi
done

if [[ -n "$ERRORS" ]]; then
  echo "BLOCKED: Version mismatch detected before tag push." >&2
  echo "" >&2
  echo "The following inconsistencies were found:" >&2
  echo -e "$ERRORS" >&2
  echo "Fix version numbers to match the tag, then try again." >&2
  echo "Use /release for an interactive flow that handles this automatically." >&2
  exit 2
fi

exit 0
