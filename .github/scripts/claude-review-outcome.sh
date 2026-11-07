#!/usr/bin/env bash
# Shared by both review attempts in .github/workflows/claude-code-review.yml.
#
#   claude-review-outcome.sh report   List the attempt's denied tool calls in the job summary.
#   claude-review-outcome.sh outcome  Print what the attempt left:
#       ok     no tool call was denied, or the review posted (a summary or inline comments);
#              posting nothing with no denials is normal for a trivial PR
#       prior  nothing posted, but Claude reviewed an earlier push of this PR (the plugin reviews
#              a PR only once, so later pushes post nothing by design)
#       empty  tool calls were denied and nothing was posted: the review may not have read the diff
#
# Env: EXECUTION_FILE (the action's execution log), and for `outcome` GH_TOKEN, GITHUB_REPOSITORY,
# PR, SINCE (ISO time the first attempt started; comments since then count as this review's).
# On fork PRs this file comes from the base-branch checkout: no PR code runs.
set -euo pipefail

: "${EXECUTION_FILE:?}"

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

outcome() {
  : "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${PR:?}" "${SINCE:?}"
  local denied summary inline prior
  denied=$(jq '[.[] | select(.type == "result") | .permission_denials[]?] | length' "$EXECUTION_FILE")
  if [ "${denied:-0}" -eq 0 ]; then echo ok; return; fi
  # The review heads its comment "## Code review" or, in newer plugin versions,
  # "<h2>Code review</h2>"; accept both.
  summary=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments?since=$SINCE" \
    --jq '[.[] | select(.user.type == "Bot" and (.body | test("(^|\n)(#+ |<h[1-6][^>]*>)Code review")))] | length')
  inline=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR/comments?since=$SINCE" \
    --jq '[.[] | select(.user.type == "Bot")] | length')
  if [ "$((summary + inline))" -gt 0 ]; then echo ok; return; fi
  prior=$( {
    gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$PR/comments" \
      --jq '.[] | select(.user.login == "claude[bot]" and .created_at < env.SINCE) | .id'
    gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR/comments" \
      --jq '.[] | select(.user.type == "Bot" and .created_at < env.SINCE and (.body | test("(^|\n)(#+ |<h[1-6][^>]*>)Code review"))) | .id'
  } | wc -l)
  if [ "$prior" -gt 0 ]; then echo prior; else echo empty; fi
}

case "${1:-}" in
  report) report ;;
  outcome) outcome ;;
  *) echo "usage: $0 report|outcome" >&2; exit 2 ;;
esac
