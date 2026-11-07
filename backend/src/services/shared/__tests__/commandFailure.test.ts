import { describe, it, expect } from 'vitest';
import { describeCommandFailure } from '../commandFailure.js';

/** Shape of the error Node's promisified execFile rejects with. */
function execError(fields: { stdout?: string; stderr?: string; code?: number | string | null; signal?: string | null; killed?: boolean; message?: string }) {
  return Object.assign(new Error(fields.message ?? `Command failed: bash build_all.sh\n${fields.stderr ?? ''}`), {
    stdout: fields.stdout ?? '',
    stderr: fields.stderr ?? '',
    code: fields.code === undefined ? 1 : fields.code,
    signal: fields.signal ?? null,
    killed: fields.killed ?? false,
  });
}

describe('describeCommandFailure', () => {
  it('uses stderr when the command wrote to it', () => {
    const msg = describeCommandFailure('go', ['build', '.'], execError({ stderr: './main.go:3: undefined: foo\n', stdout: 'noise' }));
    expect(msg).toBe('Command failed: go build . (exit code 1)\n./main.go:3: undefined: foo');
  });

  it('falls back to the end of stdout when stderr is empty', () => {
    // A script whose error went to stdout (e.g. inside a $(...) before set -e)
    const stdout = '[INFO] Built: out.exe\n[ERROR] Signing failed — aborting (fail-loud)\n';
    const msg = describeCommandFailure('bash', ['build_all.sh'], execError({ stdout }));
    expect(msg).toBe(
      'Command failed: bash build_all.sh (exit code 1)\n'
      + 'No error output; last lines of standard output:\n'
      + '[INFO] Built: out.exe\n[ERROR] Signing failed — aborting (fail-loud)',
    );
  });

  it('does not repeat the command line when there is no output at all', () => {
    // Node's own message is "Command failed: bash build_all.sh\n" — echoing it doubled the text in the UI
    const msg = describeCommandFailure('bash', ['build_all.sh'], execError({}));
    expect(msg).toBe('Command failed: bash build_all.sh (exit code 1)');
  });

  it('reports a timeout kill', () => {
    const msg = describeCommandFailure('bash', ['build_all.sh'], execError({ code: null, signal: 'SIGTERM', killed: true }));
    expect(msg).toBe('Command failed: bash build_all.sh (killed by SIGTERM, timed out?)');
  });

  it('reports a spawn failure (missing executable) by its system message', () => {
    const err = Object.assign(new Error('spawn osslsigncode ENOENT'), { code: 'ENOENT' });
    expect(describeCommandFailure('osslsigncode', ['sign'], err)).toBe('Command failed: osslsigncode sign (spawn osslsigncode ENOENT)');
  });

  it('keeps only the last 40 lines', () => {
    const stderr = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    const msg = describeCommandFailure('go', ['build'], execError({ stderr }));
    const lines = msg.split('\n');
    expect(lines[1]).toBe('… (60 earlier lines omitted)');
    expect(lines[2]).toBe('line 61');
    expect(lines.at(-1)).toBe('line 100');
  });

  it('caps very long output at 4000 characters, keeping the end', () => {
    const stderr = 'x'.repeat(10_000) + 'THE-END';
    const msg = describeCommandFailure('go', ['build'], execError({ stderr }));
    expect(msg.length).toBeLessThan(4_200);
    expect(msg.endsWith('THE-END')).toBe(true);
  });

  it('strips ANSI colour codes', () => {
    const msg = describeCommandFailure('bash', ['x.sh'], execError({ stdout: '\u001b[0;31m[ERROR]\u001b[0m No certificates found\n' }));
    expect(msg).toContain('[ERROR] No certificates found');
    expect(msg).not.toContain('\u001b');
  });

  it('handles a non-Error rejection', () => {
    expect(describeCommandFailure('go', ['build'], 'boom')).toBe('Command failed: go build');
  });
});
