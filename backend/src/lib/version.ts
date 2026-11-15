/**
 * Release-version comparison for the About dialog and the release check.
 *
 * Only plain `x.y.z` (with an optional leading "v") counts as a release.
 * Anything else ("unknown", a prerelease, an empty string) sorts below every
 * release, so it can never be reported as newer than what is running.
 */
const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): [number, number, number] | null {
  const match = RELEASE.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** True only when both are plain releases and `candidate` is the higher one. */
export function isNewer(candidate: string, current: string): boolean {
  return parse(candidate) !== null && parse(current) !== null && compareVersions(candidate, current) > 0;
}
