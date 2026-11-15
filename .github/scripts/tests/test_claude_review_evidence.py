"""Regression tests: python3 -m unittest discover -s .github/scripts/tests -v"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('evidence', Path(__file__).parents[1] / 'claude-review-evidence.py')
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = dict(GITHUB_REPOSITORY='owner/repo', PR='624', HEAD_SHA='a' * 40,
                        BASE_SHA='b' * 40, REVIEW_KIND='code', REVIEW_BOT='claude[bot]',
                        GITHUB_RUN_ID='100', GITHUB_RUN_ATTEMPT='2', REVIEW_ATTEMPT='1',
                        SINCE='2026-11-15T12:00:00+00:00', ACTION_OUTCOME='success',
                        ACTION_CONCLUSION='success', RUNNER_TEMP=self.temp.name,
                        GITHUB_OUTPUT=self.temp.name + '/output',
                        DIFF_FILE=self.temp.name + '/review.diff',
                        EXECUTION_FILE=self.temp.name + '/execution.json')
        self.events = [
            {'type': 'assistant', 'message': {'content': [
                {'type': 'tool_use', 'id': 'read1', 'name': 'Read',
                 'input': {'file_path': self.env['DIFF_FILE']}}]}},
            {'type': 'user', 'message': {'content': [
                {'type': 'tool_result', 'tool_use_id': 'read1', 'content': 'diff --git ...'}]}},
            {'type': 'result', 'subtype': 'success', 'is_error': False, 'permission_denials': []}]
        self.write_log()
        self.comment = dict(user=dict(login='claude[bot]', type='Bot'),
                            created_at='2026-11-15T12:01:00Z',
                            body=evidence.marker(self.env) + '\nReview complete: no new findings.\n'
                            '<h2>Code review</h2>\nRe-checked this SHA: no new findings.')

    def write_log(self):
        Path(self.env['EXECUTION_FILE']).write_text(json.dumps(self.events))

    def run_outcome(self, pages=None, heads=None):
        pages = [[self.comment]] if pages is None else pages
        heads = iter(heads or [self.env['HEAD_SHA']] * 2)

        def fake_api(endpoint, *args):
            if '/comments?' in endpoint:
                self.assertEqual(args, ('--paginate', '--slurp'))
                self.assertIn('per_page=100', endpoint)
                return json.dumps(pages)
            return json.dumps({'head': {'sha': next(heads)}})

        with patch.object(evidence, 'api', side_effect=fake_api):
            return evidence.outcome(self.env)

    def test_clean_review(self):
        self.assertEqual(self.run_outcome(), 'ok')

    def test_clean_rereview_ignores_historical_comments(self):
        old = copy.deepcopy(self.comment)
        old['body'] = '<!-- claude-code-review -->\nPrior review'
        self.assertEqual(self.run_outcome([[old], [self.comment]]), 'ok')

    def test_security_receipt(self):
        self.env['REVIEW_KIND'] = 'security'
        self.env['REVIEW_BOT'] = 'github-actions[bot]'
        self.comment['user']['login'] = self.env['REVIEW_BOT']
        self.comment['body'] = evidence.marker(self.env) + '\nReview complete: no new findings.\nRe-checked SHA.'
        self.assertEqual(self.run_outcome(), 'ok')

    def test_valid_findings(self):
        self.comment['body'] = evidence.marker(self.env) + '\nReview complete: findings.\nHigh: src/a.ts:4 injection; use execFile.'
        self.assertEqual(self.run_outcome(), 'ok')

    def test_stale_identity_fields(self):
        original = self.comment['body']
        for old, new in [('sha=' + 'a'*40, 'sha=' + 'b'*40), ('run=100', 'run=99'),
                         ('run_attempt=2', 'run_attempt=1'), ('review_attempt=1', 'review_attempt=2'),
                         ('claude-code-review', 'claude-security-review')]:
            with self.subTest(field=old):
                self.comment['body'] = original.replace(old, new)
                self.assertEqual(self.run_outcome(), 'empty')

    def test_stale_created_at_even_if_edited_now(self):
        self.comment.update(created_at='2026-11-15T11:59:59Z', updated_at='2026-11-15T12:02:00Z')
        self.assertEqual(self.run_outcome(), 'empty')

    def test_wrong_bot_or_user_impersonation(self):
        for login, kind in [('other[bot]', 'Bot'), ('claude[bot]', 'User'), ('github-actions[bot]', 'Bot')]:
            with self.subTest(login=login, kind=kind):
                self.comment['user'] = dict(login=login, type=kind)
                self.assertEqual(self.run_outcome(), 'empty')

    def test_no_receipt_despite_no_denials(self):
        self.assertEqual(self.run_outcome([]), 'empty')

    def test_missing_explicit_completion_or_body(self):
        for suffix in ['', '\nLooks fine', '\nReview complete: no new findings.\n', '\nReview complete: findings.\n']:
            with self.subTest(suffix=suffix):
                self.comment['body'] = evidence.marker(self.env) + suffix
                self.assertEqual(self.run_outcome(), 'empty')

    def test_quoted_or_embedded_marker_rejected(self):
        self.comment['body'] = '> ' + self.comment['body']
        self.assertEqual(self.run_outcome(), 'empty')

    def test_failed_or_skipped_action(self):
        for field in ('ACTION_OUTCOME', 'ACTION_CONCLUSION'):
            for status in ('failure', 'skipped', '', 'cancelled'):
                with self.subTest(field=field, status=status):
                    env = dict(self.env, **{field: status})
                    with patch.object(evidence, 'assert_head'):
                        self.assertEqual(evidence.outcome(env), 'empty')

    def test_missing_empty_or_malformed_execution(self):
        for content in ('', '[]', '{}', 'not json'):
            with self.subTest(content=content):
                Path(self.env['EXECUTION_FILE']).write_text(content)
                self.assertEqual(self.run_outcome(), 'empty')
        Path(self.env['EXECUTION_FILE']).unlink()
        self.assertEqual(self.run_outcome(), 'empty')

    def test_failed_execution_even_with_receipt(self):
        self.events[-1].update(subtype='error_max_turns', is_error=True)
        self.write_log()
        self.assertEqual(self.run_outcome(), 'empty')

    def test_missing_final_result(self):
        self.events.pop()
        self.write_log()
        self.assertEqual(self.run_outcome(), 'empty')

    def test_receipt_without_read(self):
        self.events = self.events[-1:]
        self.write_log()
        self.assertEqual(self.run_outcome(), 'empty')

    def test_wrong_diff_or_denied_read(self):
        self.events[0]['message']['content'][0]['input']['file_path'] = '/tmp/moving.diff'
        self.write_log()
        self.assertEqual(self.run_outcome(), 'empty')
        self.events[0]['message']['content'][0]['input']['file_path'] = self.env['DIFF_FILE']
        self.events[1]['message']['content'][0]['is_error'] = True
        self.write_log()
        self.assertEqual(self.run_outcome(), 'empty')

    def test_recovered_denial_with_success_and_receipt(self):
        self.events[-1]['permission_denials'] = [{'tool_name': 'Bash'}]
        self.write_log()
        self.assertEqual(self.run_outcome(), 'ok')

    def test_pagination_past_full_page(self):
        wrong = dict(self.comment, user=dict(login='other[bot]', type='Bot'))
        self.assertEqual(self.run_outcome([[wrong] * 100, [], [self.comment]]), 'ok')
        self.assertEqual(self.run_outcome([[wrong] * 100, []]), 'empty')

    def test_head_moves_before_or_during_verification(self):
        for heads in [['b'*40], ['a'*40, 'b'*40]]:
            with self.subTest(heads=heads), self.assertRaises(ValueError):
                self.run_outcome(heads=heads)

    def test_api_failure_does_not_become_success(self):
        with patch.object(evidence, 'api', side_effect=subprocess.CalledProcessError(1, 'gh')):
            with self.assertRaises(subprocess.CalledProcessError):
                evidence.outcome(self.env)

    def test_prepare_pins_commits_and_writes_only_inert_data(self):
        diff = 'diff --git a/a b/a\n+$(touch /tmp/never-execute)\n'
        with patch.object(evidence, 'assert_head') as head, patch.object(evidence, 'api', return_value=diff) as api:
            evidence.prepare(self.env)
            self.assertEqual(head.call_count, 2)
            self.assertIn('/compare/' + 'b'*40 + '...' + 'a'*40, api.call_args.args[0])
        output = Path(self.env['GITHUB_OUTPUT']).read_text()
        path = Path(output.splitlines()[0].removeprefix('diff='))
        self.assertEqual(path.read_text(), diff)
        self.assertEqual(path.stat().st_mode & 0o222, 0)
        self.assertIn('since=', output)

    def test_prepare_rejects_empty_diff_or_head_movement(self):
        with patch.object(evidence, 'assert_head'), patch.object(evidence, 'api', return_value=''):
            with self.assertRaises(ValueError):
                evidence.prepare(self.env)
        with patch.object(evidence, 'assert_head', side_effect=[None, ValueError('moved')]), patch.object(evidence, 'api', return_value='diff'):
            with self.assertRaises(ValueError):
                evidence.prepare(self.env)
        self.assertFalse(Path(self.env['GITHUB_OUTPUT']).exists())

    def test_shell_entrypoint_with_paginated_gh_fixture(self):
        gh = Path(self.temp.name) / 'gh'
        gh.write_text("#!/usr/bin/env python3\nimport json, os, sys\n"
                      "if '/comments?' in sys.argv[2]:\n"
                      "    assert sys.argv[3:] == ['--paginate', '--slurp']\n"
                      "    print(os.environ['FIXTURE_PAGES'])\n"
                      "else:\n"
                      "    print(json.dumps({'head': {'sha': os.environ['HEAD_SHA']}}))\n")
        gh.chmod(0o755)
        command = ['bash', str(Path(__file__).parents[1] / 'claude-review-outcome.sh'), 'outcome']
        for pages, expected in [([[], [self.comment]], 'ok'), ([[]], 'empty')]:
            env = dict(os.environ, **self.env)
            env['PATH'] = self.temp.name + os.pathsep + os.environ['PATH']
            env['FIXTURE_PAGES'] = json.dumps(pages)
            result = subprocess.run(command, env=env, capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), expected)

    def test_retry_needs_its_own_receipt(self):
        self.env['REVIEW_ATTEMPT'] = '2'
        self.assertEqual(self.run_outcome(), 'empty')
        self.comment['body'] = self.comment['body'].replace('review_attempt=1', 'review_attempt=2')
        self.assertEqual(self.run_outcome(), 'ok')


class WorkflowTests(unittest.TestCase):
    def test_workflow_guards_and_attempt_wiring(self):
        for filename in ('claude-code-review.yml', 'security-review.yml'):
            workflow = (Path(__file__).parents[2] / 'workflows' / filename).read_text()
            with self.subTest(workflow=filename):
                self.assertIn("github.event.label.name == 'claude-review'", workflow)
                self.assertIn('ref: ${{ github.event.pull_request.base.sha }}', workflow)
                self.assertIn('persist-credentials: false', workflow)
                self.assertNotIn('ref: ${{ github.event.pull_request.head', workflow)
                self.assertNotIn('ref: ${{ github.head_ref', workflow)
                self.assertEqual(workflow.count('uses: actions/checkout@'), 2 if filename == 'security-review.yml' else 1)
                self.assertEqual(workflow.count('ref: ${{'), 1)
                self.assertNotIn('/code-review:code-review', workflow)
                self.assertNotIn('plugins:', workflow)
                self.assertEqual(workflow.count('review_attempt=1 -->'), 1)
                self.assertEqual(workflow.count('review_attempt=2 -->'), 1)
                self.assertEqual(workflow.count('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB:'), 2)
                self.assertEqual(workflow.count('ACTION_CONCLUSION:'), 2)
                self.assertIn("if: always() && steps.prepare.outcome == 'success'", workflow)
                self.assertIn('claude-review-evidence.py head', workflow)
                self.assertEqual(workflow.count('$(python3 .github/scripts/claude-review-evidence.py outcome)'), 2)
                self.assertNotIn('claude-review-outcome.sh outcome', workflow)
                self.assertNotIn('claude-review-outcome.sh prepare', workflow)
                self.assertIn('--remove-label claude-review', workflow)

    def test_bootstrap_missing_helper_fails_with_explicit_error(self):
        result = self.run_prepare(helper_present=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('helper-only bootstrap first', result.stdout)
        self.assertIn('No review coverage', result.stdout)
        self.assertNotIn('OLD_HELPER_EXECUTED', result.stdout + result.stderr)

    def test_bootstrap_new_helper_with_old_shell_is_compatible(self):
        result = self.run_prepare(helper_present=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('OLD_HELPER_EXECUTED', result.stdout + result.stderr)

    def run_prepare(self, helper_present):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scripts = root / '.github/scripts'
            scripts.mkdir(parents=True)
            # The existing shell helper must never decide the new outcome or
            # receive prepare, even during helper-only staged rollout.
            (scripts / 'claude-review-outcome.sh').write_text('echo OLD_HELPER_EXECUTED; exit 99')
            if helper_present:
                source = Path(__file__).parents[1] / 'claude-review-evidence.py'
                (scripts / source.name).write_text(source.read_text())
            gh = root / 'gh'
            gh.write_text("#!/usr/bin/env python3\nimport json, os, sys\n"
                          "print('diff --git a/a b/a\\n+inert' if '/compare/' in sys.argv[2] "
                          "else json.dumps({'head': {'sha': os.environ['HEAD_SHA']}}))\n")
            gh.chmod(0o755)
            env = dict(os.environ, HEAD_SHA='a'*40, BASE_SHA='b'*40, PR='818',
                       GITHUB_REPOSITORY='owner/repo', GITHUB_RUN_ID='10', GITHUB_RUN_ATTEMPT='1',
                       REVIEW_KIND='code', RUNNER_TEMP=tmp, GITHUB_OUTPUT=tmp+'/output')
            env['PATH'] = tmp + os.pathsep + os.environ['PATH']
            for filename in ('claude-code-review.yml', 'security-review.yml'):
                env['REVIEW_KIND'] = 'security' if filename == 'security-review.yml' else 'code'
                workflow = (Path(__file__).parents[2] / 'workflows' / filename).read_text()
                step = workflow.split('      - name: Prepare pinned review diff\n')[1].split('      - name:')[0]
                command = '\n'.join(line[10:] for line in step.split('        run: |\n')[1].splitlines())
                result = subprocess.run(['bash', '-e', '-c', command], cwd=root, env=env,
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, helper_present, result.stdout + result.stderr)
            return result


if __name__ == '__main__':
    unittest.main()
