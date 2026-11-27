"""Run: python3 -m unittest discover -s .github/scripts/tests -v

What claude-review-outcome.sh says an attempt left, with a fake `gh` on PATH and a fake
execution log. A green review job must mean a review was posted, or say plainly that none was.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

SCRIPTS = Path(__file__).parents[1]
WORKFLOWS = Path(__file__).parents[2] / 'workflows'
OUTCOME = SCRIPTS / 'claude-review-outcome.sh'

FAKE_GH = textwrap.dedent('''\
    #!/usr/bin/env bash
    # Answers the three questions outcome() asks, from the test's environment.
    args="$*"
    case "$args" in
      *"--paginate"*"pulls/"*) printf '%s' "${FAKE_PRIOR_INLINE:-}" ;;
      *"--paginate"*"issues/"*) printf '%s' "${FAKE_PRIOR_SUMMARY:-}" ;;
      *"issues/"*"comments?since="*) echo "${FAKE_SUMMARY:-0}" ;;
      *"pulls/"*"comments?since="*) echo "${FAKE_INLINE:-0}" ;;
      *) echo "unexpected gh call: $args" >&2; exit 3 ;;
    esac
''')


class OutcomeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        bin_dir = Path(self.temp.name) / 'bin'
        bin_dir.mkdir()
        gh = bin_dir / 'gh'
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.path = f'{bin_dir}:{os.environ["PATH"]}'

    def outcome(self, denied=0, summary=0, inline=0, prior_summary='', prior_inline=''):
        log = Path(self.temp.name) / 'execution.json'
        denials = [{'tool_name': 'Bash', 'tool_input': {'command': 'grep -n x y'}}] * denied
        log.write_text(json.dumps([{'type': 'result', 'permission_denials': denials}]))
        env = dict(os.environ, PATH=self.path, EXECUTION_FILE=str(log), GH_TOKEN='t',
                   GITHUB_REPOSITORY='owner/repo', PR='7', SINCE='2026-11-27T11:41:15Z',
                   FAKE_SUMMARY=str(summary), FAKE_INLINE=str(inline),
                   FAKE_PRIOR_SUMMARY=prior_summary, FAKE_PRIOR_INLINE=prior_inline)
        done = subprocess.run(['bash', str(OUTCOME), 'outcome'], env=env, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return done.stdout.strip()

    def test_a_posted_summary_is_a_review(self):
        self.assertEqual(self.outcome(summary=1), 'ok')

    def test_posted_inline_comments_are_a_review(self):
        self.assertEqual(self.outcome(inline=3), 'ok')

    def test_a_review_that_posted_despite_a_denied_call_is_a_review(self):
        self.assertEqual(self.outcome(denied=1, summary=1), 'ok')

    def test_nothing_posted_with_no_denied_call_is_silent_not_ok(self):
        # The plugin stops without posting when it judges a PR trivial, or when it takes an
        # earlier Claude comment (the security review's) for a review: either way, not a review.
        self.assertEqual(self.outcome(), 'silent')

    def test_nothing_posted_after_denied_calls_is_empty(self):
        self.assertEqual(self.outcome(denied=2), 'empty')

    def test_nothing_posted_after_an_earlier_push_was_reviewed_is_prior(self):
        self.assertEqual(self.outcome(prior_summary='123\n'), 'prior')
        self.assertEqual(self.outcome(denied=1, prior_inline='456\n'), 'prior')


class WorkflowTests(unittest.TestCase):
    workflow = (WORKFLOWS / 'claude-code-review.yml').read_text()

    def test_the_reviewer_is_told_the_security_comment_is_not_a_code_review(self):
        # The code-review plugin stops when "Claude has already commented on this PR", and the
        # security review posts as the same account, usually first.
        self.assertIn('claude-security-review', self.workflow.split('--append-system-prompt', 1)[1].split('\n')[0])

    def test_a_silent_attempt_is_a_warning_never_a_clean_pass(self):
        final = self.workflow.split('name: Fail when denied tool calls left no review', 1)[1]
        self.assertIn('silent)', final)
        self.assertIn('Not reviewed', final.split('silent)', 1)[1].split(';;', 1)[0])

    def test_a_silent_retry_is_not_reported_as_ok(self):
        final = self.workflow.split('name: Fail when denied tool calls left no review', 1)[1]
        self.assertIn('if [ "$second" = "silent" ]', final)


if __name__ == '__main__':
    unittest.main()
