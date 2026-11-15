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
its workflow differs from the default branch. These jobs also load the verifier
from the trusted base. A missing verifier now fails preparation with an explicit
bootstrap error, before invoking Claude. Never check out the PR or fetch a helper
from its head to bypass this boundary; never turn this case into a green review.

### Safe staged rollout (maintainer action, not performed by this PR)

1. Prepare an additive **helper-only** PR from the current base containing exactly
   `.github/scripts/claude-review-evidence.py` from the reviewed activation branch.
   Keep the old shell helper and both workflows unchanged: replacing the old
   shell outcome before the workflows would break its existing environment
   contract. Validate that the helper is byte-identical to the version covered
   by this branch's regression suite. This adds an unused verifier without
   changing any live review behavior. Review and merge through the normal process.
2. Update this activation branch with that trusted base commit and push a new
   event (an old workflow re-run retains its old event base SHA). The workflows
   invoke Python directly for preparation, outcome and head checks, so an older
   shell helper cannot silently apply its weaker outcome rules. The shell helper
   is used only for reporting. Run the complete local suite again. Workflow
   validation may still skip Claude on the activation PR; record that lack of
   coverage explicitly. An authorized maintainer must review the workflow diff
   under the repository's normal change process; do not loosen required checks
   or add a success bypass here.
3. After authorized activation, perform the smoke tests below on fresh ordinary
   PR events. Retain the draft/rollout blocker until that validation is recorded.
   Nothing in this document authorizes this agent to merge or deploy.

If policy requires live Claude coverage on the activation PR itself, rollout
remains blocked on a maintainer-approved process; this change cannot honestly
satisfy that requirement by making a skipped execution green.

### Investigation of the initial draft checks

At head `32e045aba53e27a61d59d78178a026f61bc1c443`, both
[code review](https://github.com/projectachilles/ProjectAchilles/actions/runs/43763593089/job/132963602772)
and [security review](https://github.com/projectachilles/ProjectAchilles/actions/runs/43763593088/job/132963602646)
checked out `ca0b830356d6d2ad4a93560d49976531e3d2b67c` successfully, then failed
at the base shell helper's line 17 with `EXECUTION_FILE: parameter null or not set`.
That old helper has no `prepare` command. Both Claude action steps were skipped;
this was a bootstrap failure, not a denied Claude tool call or a completed review.

The [Semgrep summary](https://github.com/projectachilles/ProjectAchilles/pull/818#issuecomment-6901618555)
listed seven findings. The two workflow findings were introduced by making the
trusted checkout explicit, not by checking out the head. The upstream
`pull-request-target-code-checkout` rule matches *any*
`github.event.pull_request ...` ref expression, including `base.sha`. Both
checkouts retain the exact base SHA and now carry a rule-specific `nosemgrep`
annotation with this rationale. No rule pack, severity, job or permission is
changed. Regression guards enforce the base-only checkout; do not reuse this
annotation on a head or merge ref.

The other five findings are in installer files byte-identical to the base:

| Location | Assessment |
| --- | --- |
| `installer/internal/ca/ca.go:217` | SHA-1 derives the public subject key identifier (the code documents RFC 5280 method 1); not certificate signing. Existing compatibility use. |
| `installer/internal/ca/export.go:23` | SHA-1 produces the Windows thumbprint alongside SHA-256; existing identifier/export behavior. |
| `installer/internal/cli/engine_real_test.go:82` | Appends a test fixture environment to the test runner, not a remote task payload. Existing test code. |
| `installer/internal/cli/install_cmd.go:56` | Appends a fixed `ACHILLES_CA_DIR_OVERRIDE=` key with a local CLI value; it cannot select arbitrary environment keys. Existing narrow override. |
| `installer/internal/day2/backup.go:630` | `io.Copy` extracts a locally selected, operator-confirmed archive without aggregate expanded-size limits. Existing resource-exhaustion concern for untrusted backups; deserves a separate installer hardening task, not suppression or an unrelated fix here. |

These warnings are not resolved by #624 and remain visible. No installer code
or scanner configuration is changed.

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

This change is isolated to the review infrastructure on
`fix/624-current-head-review-evidence`, based on
`ca0b830356d6d2ad4a93560d49976531e3d2b67c`. The PR records the exact implementation and follow-up commits.
Before merge, closing the draft leaves production untouched. After merge, create
a separate rollback branch and revert the follow-up commit first, then
`32e045aba53e27a61d59d78178a026f61bc1c443` (or revert the actual squash commit
if squashed), open a rollback PR and use the normal maintainer process. If merged
as a merge commit and reverting that merge, use `git revert -m 1 <merge-commit>`.
Do not reset shared history, merge, or deploy as part of this implementation.
For a staged rollout, revert activation before removing the unused additive helper.
Reverting restores the prior weaker completion checks; treat their green result
as insufficient evidence of current-head review until a replacement is verified.
