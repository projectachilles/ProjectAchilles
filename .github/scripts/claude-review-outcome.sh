#!/usr/bin/env bash
# Sanitized denial reporting and current-head evidence shared by both reviews.
# outcome/prepare environment contract: see claude-review-evidence.py and workflows.
set -euo pipefail

report() {
  # Bash denials show the first two words of each part of a compound command (split on ; && || |,
  # at most 4 parts), so "cd /tmp; gh pr diff" reads "cd /tmp → gh pr". Everything from the first
  # quote or backtick on is dropped, so quoted text is never shown; so are lines after a heredoc
  # start. VAR=value words are masked. The full log stays hidden (public repo).
  local denials
  denials=$(jq -r '
    def words2: split(" ") | map(select(. != "")) as $w
      | ($w | map(test("^[A-Za-z_][A-Za-z0-9_]*=")) | index(false) // ($w | length)) as $n
      | (if $n > 0 then ["<env>"] else [] end)
        + ($w[$n:$n + 2] | map(if test("=") then "<env>" else . end))
      | join(" ");
    .[] | select(.type == "result") | .permission_denials[]? |
    if .tool_name == "Bash" then
      "Bash: " + ((.tool_input.command // "") | sub("[\"\u0027`][\\s\\S]*"; "") | split("\n")
        | (map(test("<<")) | index(true)) as $h | (if $h == null then . else .[0:$h + 1] end)
        | join("; ") | [splits("\\s*(?:;|&&|\\|\\||\\|)\\s*")] | map(select(. != "")) | .[0:4]
        | map(words2) | join(" → "))
    else .tool_name end
  ' "$EXECUTION_FILE" | sort | uniq -c | sort -rn)
  {
    echo "### Denied tool calls${ATTEMPT:+ (attempt $ATTEMPT)}"
    echo '```'
    echo "${denials:-none}"
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  echo "${denials:-No denied tool calls}"
}

trace() {
  trace=$(jq -r '
    def words3: split(" ") | map(select(. != "")) as $w
      | ($w | map(test("^[A-Za-z_][A-Za-z0-9_]*=")) | index(false) // ($w | length)) as $n
      | (if $n > 0 then ["<env>"] else [] end)
        + ($w[$n:$n + 3] | map(if test("=") then "<env>" else . end))
      | join(" ");
    def clean: gsub("[`\u0000-\u001f]"; " ") | gsub(" +"; " ") | .[0:160];
    ([.[] | select(.type == "user") | .message.content[]? | select(.type? == "tool_result")
       | {key: .tool_use_id,
          value: {err: (.is_error // false),
                  text: (.content | if type == "array" then map(.text? // "") | join(" ") else tostring end)}}]
     | from_entries) as $res
    | .[] | select(.type == "assistant") | .message.content[]? | select(.type? == "tool_use")
    | ($res[.id] // {err: null, text: ""}) as $r
    | (if .name == "Bash" then
         "Bash: " + ((.input.command // "") | sub("[\"\u0027`][\\s\\S]*"; "") | split("\n")
           | (map(test("<<")) | index(true)) as $h | (if $h == null then . else .[0:$h + 1] end)
           | join("; ") | [splits("\\s*(?:;|&&|\\|\\||\\|)\\s*")] | map(select(. != "")) | .[0:4]
           | map(words3) | join(" → "))
       elif .name == "WebFetch" then
         "WebFetch: " + ((.input.url // "") | capture("^[a-z]+://(?<h>[^/?#]+)").h // "?")
       else .name end) as $call
    | if $r.err == null then "?   " + $call
      elif $r.err then "ERR " + $call + "\n      " + ($r.text | split("\n")[0] | clean)
      else "ok  " + $call end
  ' "$EXECUTION_FILE")
  { echo "### Tool calls"; echo '```'; echo "${trace:-none}"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
}

case "${1:-}" in
  report) report; trace ;;
  outcome|prepare) python3 "$(dirname "$0")/claude-review-evidence.py" "$1" ;;
  *) echo "usage: $0 report|outcome|prepare" >&2; exit 2 ;;
esac
