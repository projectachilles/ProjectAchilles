import { describe, it, expect } from 'vitest';
import {
  readEmbeddedAgentVersion,
  assertEmbeddedVersionMatches,
  EmbeddedVersionError,
} from '../binaryVersion.js';

// Go records the build flags in the binary's build info as plain text. This
// is the exact line found in the mislabelled production binary (registered
// as 0.6.4, built as 0.6.3), surrounded by bytes that are not text.
const buildInfoLine = (flags: string) =>
  Buffer.concat([
    Buffer.from([0x00, 0xff, 0x13, 0x07]),
    Buffer.from(`path\tgithub.com/f0rt1ka/achilles-agent\nbuild\t-ldflags="${flags}"\nbuild\tCGO_ENABLED=0\n`),
    Buffer.from([0x00, 0x00, 0xfe]),
  ]);

describe('readEmbeddedAgentVersion', () => {
  it('reads the version stamped by -X main.version', () => {
    expect(readEmbeddedAgentVersion(buildInfoLine('-s -w -X main.version=0.6.3'))).toBe('0.6.3');
  });

  it('accepts the -X=main.version= spelling', () => {
    expect(readEmbeddedAgentVersion(buildInfoLine('-X=main.version=1.2.0 -s'))).toBe('1.2.0');
  });

  it('accepts a single-quoted value', () => {
    expect(readEmbeddedAgentVersion(buildInfoLine("-s -X 'main.version=0.7.0-rc1'"))).toBe('0.7.0-rc1');
  });

  it('returns null when the binary carries no version stamp', () => {
    expect(readEmbeddedAgentVersion(buildInfoLine('-s -w'))).toBeNull();
    expect(readEmbeddedAgentVersion(Buffer.from('not a go binary'))).toBeNull();
  });

  it('rejects a binary stamped with two different versions as ambiguous', () => {
    const buf = Buffer.concat([
      buildInfoLine('-X main.version=0.6.3'),
      buildInfoLine('-X main.version=0.6.4'),
    ]);
    expect(() => readEmbeddedAgentVersion(buf)).toThrow(EmbeddedVersionError);
  });

  it('tolerates the same stamp appearing more than once', () => {
    const buf = Buffer.concat([
      buildInfoLine('-X main.version=0.6.3'),
      buildInfoLine('-X main.version=0.6.3'),
    ]);
    expect(readEmbeddedAgentVersion(buf)).toBe('0.6.3');
  });
});

describe('assertEmbeddedVersionMatches', () => {
  it('passes when the stamp equals the declared version', () => {
    expect(() => assertEmbeddedVersionMatches('0.6.3', buildInfoLine('-X main.version=0.6.3'))).not.toThrow();
  });

  it('ignores a leading v on either side', () => {
    expect(() => assertEmbeddedVersionMatches('v0.6.3', buildInfoLine('-X main.version=0.6.3'))).not.toThrow();
    expect(() => assertEmbeddedVersionMatches('0.6.3', buildInfoLine('-X main.version=v0.6.3'))).not.toThrow();
  });

  // The incident this guards against.
  it('rejects a 0.6.3 build declared as 0.6.4, naming both versions', () => {
    const run = () => assertEmbeddedVersionMatches('0.6.4', buildInfoLine('-s -w -X main.version=0.6.3'));
    expect(run).toThrow(EmbeddedVersionError);
    expect(run).toThrow(/0\.6\.4/);
    expect(run).toThrow(/0\.6\.3/);
  });

  // An unstamped build reports main.go's default version, which is not
  // recoverable from the file, so it cannot be verified and is refused.
  it('rejects a binary with no version stamp', () => {
    expect(() => assertEmbeddedVersionMatches('0.6.4', buildInfoLine('-s -w'))).toThrow(EmbeddedVersionError);
  });
});
