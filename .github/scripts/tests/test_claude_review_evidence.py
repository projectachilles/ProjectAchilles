"""Run: python3 -m unittest discover -s .github/scripts/tests -v"""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

SCRIPTS = Path(__file__).parents[1]
WORKFLOWS = Path(__file__).parents[2] / 'workflows'
SPEC = importlib.util.spec_from_file_location('evidence', SCRIPTS / 'claude-review-evidence.py')
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)

HEAD = 'a' * 40
BASE = 'b' * 40
OTHER = 'c' * 40


def run_main(command, env):
    out = io.StringIO()
    with redirect_stdout(out):
        code = evidence.main(['x', command], env)
    return code, out.getvalue()


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = dict(GITHUB_REPOSITORY='owner/repo', PR='7', HEAD_SHA=HEAD, BASE_SHA=BASE,
                        GITHUB_WORKSPACE=self.temp.name)
        self.target = Path(self.temp.name) / evidence.INPUT_DIR / evidence.DIFF_NAME

    def test_writes_the_pinned_diff_as_text(self):
        diff = 'diff --git a/a b/a\n+$(touch /tmp/never-run)\n'
        with patch.object(evidence, 'gh_api', return_value=diff) as api:
            self.assertTrue(evidence.prepare(self.env))
        self.assertEqual(api.call_args.args[0], f'repos/owner/repo/compare/{BASE}...{HEAD}')
        self.assertEqual(self.target.read_text(), diff)

    def test_api_failure_or_empty_diff_leaves_a_fallback_note(self):
        for effect in (subprocess.CalledProcessError(1, 'gh'), ['']):
            with self.subTest(effect=effect):
                kwargs = {'side_effect': effect} if isinstance(effect, Exception) else {'return_value': ''}
                with patch.object(evidence, 'gh_api', **kwargs):
                    self.assertFalse(evidence.prepare(self.env))
                self.assertIn('gh pr diff 7', self.target.read_text())

    def test_replaces_a_stale_or_symlinked_file(self):
        outside = Path(self.temp.name) / 'outside.txt'
        outside.write_text('keep')
        self.target.parent.mkdir()
        self.target.symlink_to(outside)
        with patch.object(evidence, 'gh_api', return_value='diff --git a/a b/a\n'):
            evidence.prepare(self.env)
        self.assertFalse(self.target.is_symlink())
        self.assertEqual(outside.read_text(), 'keep')

    def test_refuses_a_symlinked_folder(self):
        elsewhere = Path(self.temp.name) / 'elsewhere'
        elsewhere.mkdir()
        (Path(self.temp.name) / evidence.INPUT_DIR).symlink_to(elsewhere)
        with patch.object(evidence, 'gh_api', return_value='diff'):
            with self.assertRaises(ValueError):
                evidence.prepare(self.env)
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_rejects_a_ref_that_is_not_a_sha(self):
        for key in ('HEAD_SHA', 'BASE_SHA'):
            with self.subTest(key=key), patch.object(evidence, 'gh_api', return_value='diff') as api:
                with self.assertRaises(ValueError):
                    evidence.prepare(dict(self.env, **{key: 'main'}))
                api.assert_not_called()

    def test_main_never_fails_the_job(self):
        with patch.object(evidence, 'gh_api', side_effect=subprocess.CalledProcessError(1, 'gh')):
            code, out = run_main('prepare', self.env)
        self.assertEqual(code, 0)
        self.assertIn('::warning::', out)
        code, out = run_main('prepare', dict(self.env, HEAD_SHA='main'))
        self.assertEqual(code, 0)
        self.assertIn('::warning::', out)


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.env = dict(GITHUB_REPOSITORY='owner/repo', PR='7', HEAD_SHA=HEAD, REVIEW_KIND='security',
                        SINCE='2026-11-15T12:00:00Z')
        self.comment = dict(user=dict(login='claude[bot]', type='Bot'), created_at='2026-11-15T12:03:00Z',
                            body=f'<!-- claude-security-review sha={HEAD} -->\n<h2>Claude Security Review</h2>\nNo issues.')

    def check(self, comments, live_head=HEAD):
        """live_head: what the pulls API reports as the PR's head (an Exception to make that call fail)."""
        lines = '\n'.join(json.dumps(c) for c in comments)
        calls = []

        def api(endpoint, *args):
            calls.append((endpoint, args))
            if endpoint == 'repos/owner/repo/pulls/7':
                if isinstance(live_head, Exception):
                    raise live_head
                return live_head + '\n'
            return lines

        with patch.object(evidence, 'gh_api', side_effect=api):
            code, out = run_main('receipt', self.env)
        self.assertIn('--paginate', calls[0][1])
        self.calls = calls
        return code, out

    def test_comment_for_this_commit_and_run_passes(self):
        self.assertEqual(self.check([self.comment])[0], 0)

    def test_fork_reviews_post_as_github_actions(self):
        self.comment['user']['login'] = 'github-actions[bot]'
        self.assertEqual(self.check([self.comment])[0], 0)

    def test_short_recheck_line_passes(self):
        self.comment['body'] = f'<!-- claude-security-review sha={HEAD} -->\nRe-checked aaaaaaa: no new security findings.'
        self.assertEqual(self.check([self.comment])[0], 0)

    def test_found_on_a_later_page(self):
        noise = dict(self.comment, body='unrelated')
        self.assertEqual(self.check([noise] * 150 + [self.comment])[0], 0)

    def test_no_comment_fails(self):
        code, out = self.check([])
        self.assertEqual(code, 1)
        self.assertIn('::error::', out)

    def test_comment_from_an_earlier_run_fails(self):
        self.comment['created_at'] = '2026-11-15T11:59:59Z'
        self.assertEqual(self.check([self.comment])[0], 1)

    def test_old_comment_edited_now_fails(self):
        self.comment.update(created_at='2026-11-15T11:00:00Z', updated_at='2026-11-15T12:05:00Z')
        self.assertEqual(self.check([self.comment])[0], 1)

    def test_comment_for_another_commit_fails(self):
        self.comment['body'] = self.comment['body'].replace(HEAD, OTHER)
        self.assertEqual(self.check([self.comment])[0], 1)

    def test_marker_without_a_sha_fails(self):
        self.comment['body'] = '<!-- claude-security-review -->\n<h2>Claude Security Review</h2>'
        self.assertEqual(self.check([self.comment])[0], 1)

    def test_another_review_kind_fails(self):
        self.comment['body'] = self.comment['body'].replace('security', 'code')
        self.assertEqual(self.check([self.comment])[0], 1)

    def test_users_and_other_bots_cannot_post_it(self):
        for login, kind in (('claude[bot]', 'User'), ('mallory', 'User'), ('other[bot]', 'Bot')):
            with self.subTest(login=login, kind=kind):
                self.comment['user'] = dict(login=login, type=kind)
                self.assertEqual(self.check([self.comment])[0], 1)

    def test_head_moved_during_the_review_fails(self):
        # The comment for the reviewed commit is there, but a push landed meanwhile.
        code, out = self.check([self.comment], live_head=OTHER)
        self.assertEqual(code, 1)
        self.assertIn('::error::The PR changed during the review', out)
        self.assertIn('claude-review label again', out)

    def test_head_is_read_after_the_comments(self):
        self.check([self.comment])
        self.assertEqual([endpoint for endpoint, _ in self.calls][-1], 'repos/owner/repo/pulls/7')
        self.assertEqual(self.calls[-1][1], ('--jq', '.head.sha'))

    def test_head_lookup_failure_fails_closed(self):
        for effect in (subprocess.CalledProcessError(1, 'gh'), '', 'null', 'not-a-sha'):
            with self.subTest(effect=effect):
                code, out = self.check([self.comment], live_head=effect)
                self.assertEqual(code, 1)
                self.assertIn('::error::', out)

    def test_head_moved_and_no_comment_reports_the_moved_head(self):
        code, out = self.check([], live_head=OTHER)
        self.assertEqual(code, 1)
        self.assertIn('The PR changed during the review', out)

    def test_api_failure_fails(self):
        with patch.object(evidence, 'gh_api', side_effect=subprocess.CalledProcessError(1, 'gh')):
            code, out = run_main('receipt', self.env)
        self.assertEqual(code, 1)
        self.assertIn('::error::', out)

    def test_unknown_command(self):
        self.assertEqual(evidence.main(['x', 'nope'], {}), 2)


class EntrypointTest(unittest.TestCase):
    """The script as the workflows call it, with a fake gh on PATH."""

    def test_receipt_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            gh = Path(tmp) / 'gh'
            gh.write_text("#!/usr/bin/env python3\nimport os, sys\n"
                          "print(os.environ['LIVE_HEAD'] if '/pulls/' in sys.argv[2] else os.environ['FIXTURE'])\n")
            gh.chmod(0o755)
            good = json.dumps(dict(user=dict(login='claude[bot]', type='Bot'), created_at='2026-11-15T12:03:00Z',
                                   body=f'<!-- claude-security-review sha={HEAD} -->'))
            for fixture, live_head, expected in ((good, HEAD, 0), ('', HEAD, 1), (good, OTHER, 1)):
                env = dict(os.environ, PATH=tmp + os.pathsep + os.environ['PATH'], FIXTURE=fixture,
                           LIVE_HEAD=live_head,
                           GITHUB_REPOSITORY='owner/repo', PR='7', HEAD_SHA=HEAD, REVIEW_KIND='security',
                           SINCE='2026-11-15T12:00:00Z')
                result = subprocess.run(['python3', str(SCRIPTS / 'claude-review-evidence.py'), 'receipt'],
                                        env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)


class WorkflowTests(unittest.TestCase):
    """Guards on the two review workflows that no scanner checks for us."""

    def workflows(self):
        for name in ('claude-code-review.yml', 'security-review.yml'):
            yield name, (WORKFLOWS / name).read_text()

    def test_never_checks_out_the_pr_head(self):
        for name, text in self.workflows():
            with self.subTest(workflow=name):
                for line in text.splitlines():
                    if line.strip().startswith(('ref:', 'repository:')):
                        self.fail(f'{name}: checkout must use its default ref ({line.strip()})')
                self.assertIn('persist-credentials: false', text)

    def test_fork_reviews_stay_label_gated(self):
        for name, text in self.workflows():
            with self.subTest(workflow=name):
                self.assertIn("github.event.label.name == 'claude-review'", text)
                self.assertIn('--remove-label claude-review', text)

    def test_diff_is_prepared_before_claude_runs(self):
        for name, text in self.workflows():
            with self.subTest(workflow=name):
                prepare = text.index('claude-review-evidence.py prepare')
                self.assertLess(prepare, text.index('uses: anthropics/claude-code-action@'))
                self.assertIn(f'{evidence.INPUT_DIR}/{evidence.DIFF_NAME}', text)

    def test_a_skipped_review_is_reported(self):
        for name, text in self.workflows():
            with self.subTest(workflow=name):
                self.assertIn('Not reviewed', text)

    def test_security_receipt_names_the_head_commit(self):
        text = (WORKFLOWS / 'security-review.yml').read_text()
        self.assertIn('<!-- claude-security-review sha=${{ github.event.pull_request.head.sha }} -->', text)
        self.assertIn('claude-review-evidence.py receipt', text)
        self.assertNotIn('If one exists, post nothing', text)


if __name__ == '__main__':
    unittest.main()
