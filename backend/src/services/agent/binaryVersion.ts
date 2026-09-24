/**
 * Reads the version an agent binary will report at runtime, so an upload can
 * be refused when it disagrees with the version the operator typed.
 *
 * The agent's version is set at link time with `-ldflags "-X main.version=…"`,
 * and Go (1.18+) records those flags verbatim in the binary's build info, e.g.
 *   build	-ldflags="-s -w -X main.version=0.6.3"
 * That text survives stripping (-s -w) and code signing, on every OS.
 *
 * Why this matters: an agent that installs an update and restarts still
 * reporting its old version is offered the same update again — a binary built
 * as 0.6.3 but registered as 0.6.4 restarted a whole fleet in a download loop.
 */

// -X main.version=V, -X=main.version=V, or -X 'main.version=V'
const VERSION_STAMP = /-X[ =]'?main\.version=([\w.+-]+)/g;

export class EmbeddedVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddedVersionError';
  }
}

/**
 * Returns the version stamped into an agent binary, or null if it has none.
 * Throws EmbeddedVersionError if the binary carries conflicting stamps.
 */
export function readEmbeddedAgentVersion(binary: Buffer): string | null {
  // latin1 maps every byte to one char, so binary data can't break decoding.
  const text = binary.toString('latin1');
  const found = new Set<string>();
  for (const match of text.matchAll(VERSION_STAMP)) {
    found.add(match[1]);
  }
  if (found.size > 1) {
    throw new EmbeddedVersionError(
      `Binary carries conflicting version stamps (${[...found].join(', ')}); cannot tell which it will report.`
    );
  }
  return found.size === 1 ? [...found][0] : null;
}

const normalize = (v: string) => v.replace(/^v/i, '');

/**
 * Throws EmbeddedVersionError unless the binary is stamped with the declared
 * version. An unstamped build reports main.go's source default, which cannot
 * be read back from the file, so it is refused rather than trusted.
 */
export function assertEmbeddedVersionMatches(declaredVersion: string, binary: Buffer): void {
  const embedded = readEmbeddedAgentVersion(binary);
  if (embedded === null) {
    throw new EmbeddedVersionError(
      `Cannot verify this binary's version: it was not built with -ldflags "-X main.version=<version>". ` +
        `Upload a release build (make build-all VERSION=${declaredVersion}) or use Build from source.`
    );
  }
  if (normalize(embedded) !== normalize(declaredVersion)) {
    throw new EmbeddedVersionError(
      `Version mismatch: this binary was built as ${embedded} but is being registered as ${declaredVersion}. ` +
        `Agents would install it, restart still reporting ${embedded}, and download it again in a loop. ` +
        `Register it as ${embedded}, or upload a build of ${declaredVersion}.`
    );
  }
}
