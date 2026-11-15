import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Deliberately NOT mocking simple-git: these tests pin our env policy against
// the real v4 environment guard, so a simple-git upgrade that changes the
// guarded key set fails here instead of breaking git sync in production.
const { gitChildEnv, createGit } = await import('../gitSyncService.js');

describe('gitChildEnv', () => {
  it('drops every key simple-git guards, case-insensitively', () => {
    const env = gitChildEnv({
      GIT_SSH_COMMAND: 'evil',
      git_askpass: 'evil',
      GIT_BRANCH: 'main',
      GITHUB_TOKEN: 'ghp_secret',
      EDITOR: 'vim',
      Visual: 'code',
      PAGER: 'less',
      PREFIX: '/usr/local',
      SSH_ASKPASS: 'evil',
    });

    expect(Object.keys(env)).toEqual(['GIT_TERMINAL_PROMPT']);
  });

  it('keeps unrelated variables', () => {
    const env = gitChildEnv({ PATH: '/usr/bin', HOME: '/home/x', LANG: 'C' });
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/x', LANG: 'C' });
  });

  it('forces GIT_TERMINAL_PROMPT=0 even when the ambient value enables prompting', () => {
    expect(gitChildEnv({ GIT_TERMINAL_PROMPT: '1' }).GIT_TERMINAL_PROMPT).toBe('0');
  });
});

describe.skipIf(process.platform === 'win32')('createGit (real simple-git)', () => {
  let dir: string;
  let fakeGit: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitenv-'));
    // Stand-in git binary that prints the environment it was spawned with.
    fakeGit = path.join(dir, 'fakegit');
    fs.writeFileSync(fakeGit, '#!/bin/sh\nenv\n', { mode: 0o755 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('spawns git with prompting disabled and guarded variables stripped, without throwing', async () => {
    // A typical developer shell plus hostile git overrides — v4 throws if any
    // guarded key reaches .env() without being allow-listed.
    vi.stubEnv('EDITOR', 'vim');
    vi.stubEnv('PAGER', 'less');
    vi.stubEnv('PREFIX', '/usr/local');
    vi.stubEnv('GIT_SSH_COMMAND', 'touch /tmp/pwned');
    vi.stubEnv('GIT_TERMINAL_PROMPT', '1');

    const output = await createGit(dir).customBinary(fakeGit).raw(['status']);

    const lines = output.split('\n');
    expect(lines).toContain('GIT_TERMINAL_PROMPT=0');
    expect(lines.some((l) => l.startsWith('GIT_SSH_COMMAND='))).toBe(false);
    expect(lines.some((l) => l.startsWith('EDITOR='))).toBe(false);
  });

  it('passes the token to git as command-scoped config, without throwing', async () => {
    // v4 treats GIT_CONFIG_COUNT as unsafe; a guard that rejects it would
    // break every authenticated clone and fetch.
    const output = await createGit(dir, 'test-token').customBinary(fakeGit).raw(['fetch']);

    const basic = Buffer.from('x-access-token:test-token', 'utf8').toString('base64');
    const lines = output.split('\n');
    expect(lines).toContain('GIT_CONFIG_COUNT=1');
    expect(lines).toContain('GIT_CONFIG_KEY_0=http.extraHeader');
    expect(lines).toContain(`GIT_CONFIG_VALUE_0=Authorization: Basic ${basic}`);
  });

  it('sets no git config variables when there is no token', async () => {
    const output = await createGit(dir).customBinary(fakeGit).raw(['fetch']);

    expect(output.split('\n').some((l) => l.startsWith('GIT_CONFIG_'))).toBe(false);
  });
});
