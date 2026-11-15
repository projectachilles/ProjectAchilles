#!/usr/bin/env python3
"""Helpers for the Claude review jobs (claude-code-review.yml, security-review.yml).

  prepare  Write the PR's diff (base.sha...head.sha, fetched through the API) to
           claude-review-input/pr.diff in the workspace, so the reviewer can use
           Read and Grep on it instead of piping `gh pr diff`, which the allow
           rules refuse. Never fails the job: when the diff can't be fetched the
           file says so and the reviewer falls back to `gh pr diff`.
  receipt  Exit 0 only when a review bot posted, since this run started, a
           comment carrying this review's marker for the PR's head commit:
           <!-- claude-security-review sha=<head sha> -->
           An earlier run's comment, a comment for another commit, or a comment
           from a user can't satisfy it.

Standard library only. The diff is written as text and never executed; on fork
PRs this file comes from the base-branch checkout.

Env (both): GITHUB_REPOSITORY, HEAD_SHA, GH_TOKEN (for gh).
  prepare: BASE_SHA, PR, GITHUB_WORKSPACE
  receipt: PR, SINCE (ISO time the run started), REVIEW_KIND (e.g. security)
"""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys

INPUT_DIR = 'claude-review-input'
DIFF_NAME = 'pr.diff'
REVIEW_BOTS = ('claude[bot]', 'github-actions[bot]')
SHA = re.compile(r'[0-9a-f]{40}')


def gh_api(endpoint, *args):
    return subprocess.check_output(['gh', 'api', endpoint, *args], text=True)


def require_sha(value):
    if not SHA.fullmatch(value or ''):
        raise ValueError('not a commit SHA')
    return value


def prepare(env):
    """Returns True when the diff was written, False when only the fallback note was."""
    head, base = require_sha(env['HEAD_SHA']), require_sha(env['BASE_SHA'])
    folder = Path(env['GITHUB_WORKSPACE']) / INPUT_DIR
    # The folder is ours: refuse anything a checkout could have put in its place.
    if folder.is_symlink() or (folder.exists() and not folder.is_dir()):
        raise ValueError(f'{INPUT_DIR} exists and is not a plain folder')
    folder.mkdir(exist_ok=True)
    target = folder / DIFF_NAME
    if target.is_symlink() or target.exists():
        target.unlink()
    try:
        diff = gh_api(f"repos/{env['GITHUB_REPOSITORY']}/compare/{base}...{head}",
                      '-H', 'Accept: application/vnd.github.diff')
    except subprocess.CalledProcessError:
        diff = ''
    if diff.strip():
        target.write_text(diff)
        return True
    target.write_text('The diff could not be prepared here (too large, or the API call failed).\n'
                      f"Run: gh pr diff {env['PR']}\n")
    return False


def marker(kind, head):
    return re.compile(r'<!--\s*claude-' + re.escape(kind) + r'-review\s+sha=' + re.escape(head) + r'\s*-->')


def parse_time(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))


def is_receipt(comment, kind, head, since):
    user = comment.get('user') or {}
    if user.get('type') != 'Bot' or user.get('login') not in REVIEW_BOTS:
        return False
    # created_at, not updated_at: editing an old comment must not count.
    if parse_time(comment['created_at']) < since:
        return False
    return bool(marker(kind, head).search(comment.get('body') or ''))


def comments(env):
    # One compact JSON object per line across all pages.
    out = gh_api(f"repos/{env['GITHUB_REPOSITORY']}/issues/{env['PR']}/comments?per_page=100",
                 '--paginate', '--jq', '.[] | {user: {login: .user.login, type: .user.type}, created_at, body}')
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def receipt(env):
    head = require_sha(env['HEAD_SHA'])
    since = parse_time(env['SINCE'])
    return any(is_receipt(c, env['REVIEW_KIND'], head, since) for c in comments(env))


def main(argv, env):
    command = argv[1] if len(argv) > 1 else ''
    if command == 'prepare':
        try:
            if prepare(env):
                print(f'Wrote {INPUT_DIR}/{DIFF_NAME}')
            else:
                print('::warning::The PR diff could not be prepared; the reviewer will use gh pr diff.')
        except (OSError, ValueError, KeyError) as error:
            # Reviews still work without the file, so this never fails the job.
            print(f'::warning::The PR diff was not prepared ({type(error).__name__}); the reviewer will use gh pr diff.')
        return 0
    if command == 'receipt':
        try:
            found = receipt(env)
        except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
            print(f'::error::Could not check for the review comment ({type(error).__name__}).')
            return 1
        if found:
            print('Review comment for this commit is present.')
            return 0
        print(f"::error::Claude finished without posting a {env.get('REVIEW_KIND', '')} review comment for "
              "this commit. See 'Denied tool calls' and 'Tool calls' in the job summary.")
        return 1
    print('usage: claude-review-evidence.py prepare|receipt', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv, os.environ))
