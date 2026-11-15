#!/usr/bin/env python3
"""Prepare inert, immutable review input and fail closed on incomplete reviews.

No PR checkout, shell evaluation, third-party Python packages, or public execution logs.
The workflow supplies identity from its event/context, never from a PR comment.
"""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def api(endpoint, *args):
    return subprocess.check_output(['gh', 'api', endpoint, *args], text=True)


def current_head(env):
    return json.loads(api(f"repos/{env['GITHUB_REPOSITORY']}/pulls/{env['PR']}"))['head']['sha']


def assert_head(env):
    if current_head(env) != env['HEAD_SHA']:
        raise ValueError('PR head moved; this run does not cover the current head. Start a fresh review.')


def prepare(env):
    for key in ('HEAD_SHA', 'BASE_SHA'):
        if not re.fullmatch(r'[0-9a-f]{40}', env[key]):
            raise ValueError('Invalid commit SHA')
    assert_head(env)
    # Compare immutable commits, not the moving PR endpoint. Never materialize
    # files from the patch or execute its content. GitHub fails oversized diffs.
    diff = api(f"repos/{env['GITHUB_REPOSITORY']}/compare/{env['BASE_SHA']}...{env['HEAD_SHA']}",
               '-H', 'Accept: application/vnd.github.diff')
    if not diff.strip():
        raise ValueError('Empty diff; no review input was prepared')
    assert_head(env)
    path = Path(env['RUNNER_TEMP']) / f"claude-{env['REVIEW_KIND']}-{env['GITHUB_RUN_ID']}-{env['GITHUB_RUN_ATTEMPT']}.diff"
    path.write_text(diff)
    path.chmod(0o444)
    with open(env['GITHUB_OUTPUT'], 'a') as output:
        output.write(f"diff={path}\n")
        output.write(f"since={datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()}\n")


def marker(env):
    return (f"<!-- claude-{env['REVIEW_KIND']}-review sha={env['HEAD_SHA']} "
            f"run={env['GITHUB_RUN_ID']} run_attempt={env['GITHUB_RUN_ATTEMPT']} "
            f"review_attempt={env['REVIEW_ATTEMPT']} -->")


def successful_execution(events, diff_path):
    if not isinstance(events, list) or not events:
        return False
    results = [e for e in events if e.get('type') == 'result']
    if not results or results[-1].get('subtype') != 'success' or results[-1].get('is_error') is not False:
        return False
    # A receipt without a successful Read of the pinned input is not evidence.
    reads = set()
    for event in events:
        content = event.get('message', {}).get('content', [])
        if not isinstance(content, list):
            continue
        for item in content:
            if (event.get('type') == 'assistant' and item.get('type') == 'tool_use'
                    and item.get('name') == 'Read'
                    and item.get('input', {}).get('file_path') == diff_path):
                reads.add(item['id'])
            if (event.get('type') == 'user' and item.get('type') == 'tool_result'
                    and item.get('tool_use_id') in reads
                    and not item.get('is_error', False) and item.get('content')):
                return True
    return False


def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))


def valid_receipt(comment, env):
    user = comment.get('user', {})
    if user.get('type') != 'Bot' or user.get('login') != env['REVIEW_BOT']:
        return False
    if timestamp(comment['created_at']) < timestamp(env['SINCE']):
        return False
    lines = (comment.get('body') or '').splitlines()
    if len(lines) < 3 or lines[0] != marker(env):
        return False
    # Both clean and finding reviews must explicitly attest completion. A
    # historical marker, inline comment, or partial summary cannot substitute.
    if lines[1] == 'Review complete: no new findings.':
        return bool('\n'.join(lines[2:]).strip())
    if lines[1] == 'Review complete: findings.':
        return bool('\n'.join(lines[2:]).strip())
    return False


def outcome(env):
    assert_head(env)
    if env.get('ACTION_OUTCOME') != 'success' or env.get('ACTION_CONCLUSION') != 'success':
        return 'empty'
    try:
        events = json.loads(Path(env.get('EXECUTION_FILE', '')).read_text())
    except (OSError, ValueError):
        return 'empty'
    if not successful_execution(events, env['DIFF_FILE']):
        return 'empty'
    # --slurp preserves page boundaries, including full/empty pages. Do not
    # accept only the first page or sum page-local booleans in shell pipelines.
    pages = json.loads(api(f"repos/{env['GITHUB_REPOSITORY']}/issues/{env['PR']}/comments?per_page=100",
                           '--paginate', '--slurp'))
    found = any(valid_receipt(comment, env) for page in pages for comment in page)
    assert_head(env)
    return 'ok' if found else 'empty'


def main():
    try:
        if sys.argv[1] == 'prepare':
            prepare(os.environ)
        elif sys.argv[1] == 'head':
            assert_head(os.environ)
        elif sys.argv[1] == 'outcome':
            print(outcome(os.environ))
        else:
            raise ValueError('Unknown command')
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError):
        # Never echo untrusted API payloads, diff text, or execution log errors.
        print('::error::Review evidence unavailable or PR head changed; no current-head coverage. '
              'Re-run for the current head (forks require a fresh maintainer label).', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
