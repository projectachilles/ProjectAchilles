# Claude review completion and operations

Both Claude jobs review an immutable `base.sha...head.sha` API diff as inert text
from the trusted base checkout. Claude uses `Read` (chunking large files), `Grep`
and `Glob`; it must never check out or execute the PR code. Base source files are
context only. GitHub API failures and empty diffs fail preparation.

A passing review requires all of:

- The action step outcome and action conclusion are `success`.
- A nonempty JSON execution log ends in a successful result, with a successful
  `Read` tool result for the exact prepared diff path.
- A newly created top-level receipt from `claude[bot]` (same-repository app token)
  or `github-actions[bot]` (fork job token), with GitHub user type `Bot`.
- The exact receipt marker matches review kind, head SHA, run ID, workflow run
  attempt and review attempt. The next line explicitly says
  `Review complete: no new findings.` or `Review complete: findings.`, followed
  by a summary. Findings themselves are non-blocking; missing completion is not.
- The live PR head still matches before/after preparation, before/after receipt
  lookup, and at the final gate. A later push needs a new review. These checks
  cannot prevent a push after the last API read; the receipt always names only
  the SHA actually reviewed, never future commits.

All comment pages are examined. Historical/edited comments, generic bot comments,
inline comments alone, zero denials, or a prior plugin review cannot pass. A
successful read and the bot's completion attestation are execution evidence,
not a proof of review quality or that every issue was found. Denied-call and
sanitized tool traces remain visible; full execution content stays private.

An incomplete review gets one fresh attempt with identical permissions and a
separate receipt marker. API errors or head changes fail closed. A successful
retry cannot inherit attempt one's receipt. Security and code receipts are
separate even when both jobs share a workflow run ID.

Fork safety is unchanged: only a maintainer adding `claude-review` starts a
privileged review, the action still verifies the actor's write access, the base
is checked out with persisted credentials disabled, subprocess scrubbing and
bubblewrap/socat are required, permissions remain narrow, and the label is
removed afterward. Each fork push needs a new maintainer inspection and label.
Semgrep's existing job is unchanged.

## Local checks

```sh
python3 -m unittest discover -s .github/scripts/tests -v
bash -n .github/scripts/claude-review-outcome.sh
shellcheck .github/scripts/claude-review-outcome.sh
actionlint .github/workflows/claude-code-review.yml .github/workflows/security-review.yml
ruff check .github/scripts/claude-review-evidence.py .github/scripts/tests/
git diff --check
```

## Required post-merge smoke test

A workflow-edit PR is **not** a live Claude validation: the action may skip when
its workflow differs from the default branch. Additionally these jobs load
helpers from the trusted base, so the new `prepare` command is unavailable until
this change lands. Such runs must not be reported as reviewed; the gate fails
closed. Do not relax checkout or workflow validation to make this PR green.

After an authorized maintainer merges, validate on a disposable PR that changes
a security-review path (for example a harmless comment in `backend/src/`), without
editing workflows or helpers:

1. Run both reviews on a same-repository PR. Verify successful pinned-diff reads,
   action/execution results, expected bot identity, and receipts for the exact SHA
   and run/attempt. Verify no diff-reading shell-pipeline denials.
2. Push a second harmless change to the same PR. Both reviewers must actually run
   and post fresh clean receipts for the new SHA, despite the earlier reviews.
3. Re-run a workflow and confirm the receipt has the new `run_attempt` value.
   Inspect a fixture with an obvious bug to confirm findings produce a completion
   receipt as well. If an attempt needs recovery, verify its retry uses attempt 2.
4. Exercise a fork PR: unlabeled runs must not invoke Claude; a maintainer label
   must use only base files plus inert diff data, the scrubbed sandbox and the
   expected `github-actions[bot]` receipt. Confirm label removal and fresh labeling
   for a later push.
5. Push while a review is running. The old run must fail on observed head movement
   and must never claim coverage of the new SHA. Re-label forks after inspection.

Record run URLs, head SHAs and receipt URLs. If either bot or execution format
is different than expected, inspect the private log; fix the contract rather
than accepting arbitrary bots or treating missing logs as successful. Local
regressions cover missing receipts, stale evidence, failed/empty execution,
pagination and races without consuming Claude credentials.

## Rollback

This change is intended as one isolated commit on
`fix/624-current-head-review-evidence`, based on
`ca0b830356d6d2ad4a93560d49976531e3d2b67c`. The PR records the exact change commit.
Before merge, closing the draft leaves production untouched. After merge, create
a separate rollback branch and `git revert <change-commit>` (or the squash commit
if squashed), open a rollback PR and use the normal maintainer process. If merged
as a merge commit and reverting that merge, use `git revert -m 1 <merge-commit>`.
Do not reset shared history, merge, or deploy as part of this implementation.
Reverting restores the prior weaker completion checks; treat their green result
as insufficient evidence of current-head review until a replacement is verified.
