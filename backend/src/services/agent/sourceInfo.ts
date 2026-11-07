// What an agent build-from-source compiled. Docker installs build from the
// server's own checkout, mounted read-only at AGENT_SOURCE_PATH, with the
// repo's .git mounted next to it (AGENT_SOURCE_GIT_DIR). Both mounts are live
// views of one checkout, so the commit read here is the code being built.
// Files only: no git binary, no shell, nothing written.

import * as fs from 'fs';
import * as path from 'path';

const SHA = /^[0-9a-f]{40}$/;
const REF = /^refs\/[A-Za-z0-9._\/-]+$/;

const read = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * The commit HEAD points at in a git dir: a detached HEAD, else its branch's
 * loose ref, else the branch in packed-refs. Null when the dir or the ref is
 * missing, or the ref doesn't look like `refs/...` (never reads outside gitDir).
 */
export function readGitHead(gitDir: string | undefined): string | null {
  if (!gitDir) return null;
  const head = read(path.join(gitDir, 'HEAD'))?.trim();
  if (!head) return null;
  if (SHA.test(head)) return head;
  const m = /^ref: (.+)$/.exec(head);
  if (!m || !REF.test(m[1]) || m[1].includes('..')) return null;
  const loose = read(path.join(gitDir, m[1]))?.trim();
  if (loose && SHA.test(loose)) return loose;
  for (const line of (read(path.join(gitDir, 'packed-refs')) ?? '').split('\n')) {
    const [sha, ref] = line.trim().split(' ');
    if (ref === m[1] && SHA.test(sha)) return sha;
  }
  return null;
}

/** The agent's own version in its source (`var version = "x"` in main.go), or null. */
export function readSourceVersion(agentSourcePath: string): string | null {
  const main = read(path.join(agentSourcePath, 'main.go'));
  return main ? /^var version = "([^"]+)"/m.exec(main)?.[1] ?? null : null;
}
