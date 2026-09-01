import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promisify } from 'util';

const mockExecFileAsync =
  vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ stdout: string; stderr: string }>>();
const mockExecFile = vi.fn();
(mockExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = mockExecFileAsync;

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execFile: mockExecFile, default: { ...actual, execFile: mockExecFile } };
});

const { hasWindowsSignature, readWindowsSigner } =
  await import('../binarySigning.service.js');

/** Shape of a non-zero osslsigncode exit, which carries its output on the error. */
function execFailure(stdout: string, code = 1): Error {
  return Object.assign(new Error(`Command failed with exit code ${code}`), { stdout, stderr: '' });
}

describe('binarySigning.hasWindowsSignature', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  // osslsigncode exits non-zero BOTH for "no signature" and for "signature
  // present but untrusted" — and an untrusted chain is the normal case for a
  // self-signed tenant certificate. Reading the exit code alone would report
  // every tenant-signed binary as unsigned, so detection reads the output text.
  it('reports unsigned when the tool exits non-zero saying no signature', async () => {
    mockExecFileAsync.mockRejectedValueOnce(
      execFailure('No signature found\nUnable to extract existing signature\n'),
    );
    await expect(hasWindowsSignature('/tmp/agent.exe')).resolves.toBe(false);
  });

  it('reports SIGNED when the tool exits non-zero because the chain is untrusted', async () => {
    mockExecFileAsync.mockRejectedValueOnce(
      execFailure(
        'Number of signatures: 1\n\tSubject: /CN=Acme Code Signing\nSignature verification: failed\n',
      ),
    );
    await expect(hasWindowsSignature('/tmp/agent.exe')).resolves.toBe(true);
  });

  it('reports signed on a clean exit that is not the no-signature message', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'Number of signatures: 1\n\tSubject: /CN=Acme Code Signing\n',
      stderr: '',
    });
    await expect(hasWindowsSignature('/tmp/agent.exe')).resolves.toBe(true);
  });
});

describe('binarySigning.readWindowsSigner', () => {
  beforeEach(() => mockExecFileAsync.mockReset());

  it('extracts the subject even when verification failed', async () => {
    mockExecFileAsync.mockRejectedValueOnce(
      execFailure('\tSubject: /C=DO/O=Acme/CN=Acme Code Signing\nSignature verification: failed\n'),
    );
    await expect(readWindowsSigner('/tmp/agent.exe')).resolves.toBe('/C=DO/O=Acme/CN=Acme Code Signing');
  });

  it('returns null when no subject line is present', async () => {
    mockExecFileAsync.mockRejectedValueOnce(execFailure('No signature found\n'));
    await expect(readWindowsSigner('/tmp/agent.exe')).resolves.toBeNull();
  });
});

// NOTE: signWindowsBinary's ENOENT branch (osslsigncode missing) is exercised
// end-to-end through registerVersionFromUpload in update.service.test.ts —
// asserting it here needs a rejected-promise mock that vitest reports as an
// unhandled rejection regardless of how the assertion is written.
