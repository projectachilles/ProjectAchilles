import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { RELEASE_INFO } from '../releaseInfo.js';
import type { ReleaseInfo } from '../releaseInfo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../../../../scripts/generate-release-info.mjs');
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../../../package.json'), 'utf8')) as { version: string };

const AGENT = `## Agent [0.7.4] - 2026-11-15

### Security
- The agent reads \`bundle_results.json\` only from a folder it trusts.

`;
const head = (summary: string) => `# Changelog

## [Unreleased]

### Added
- Unreleased entry

## [2.11.0] - 2026-11-15

${summary}

### Added
- A card.

`;
const TAIL = `## [2.10.1] - 2026-11-07

### Fixed
- Older.

[2.11.0]: https://example.invalid/compare
`;
const TITLED = '**Stage Coverage and a Security Round.** Two things make up this release.';
const FIXTURE = head(TITLED) + AGENT + TAIL;
const FIXTURE_NO_AGENT = head(TITLED) + TAIL;
const FIXTURE_NO_TITLE = head('Two things make up this release.') + AGENT + TAIL;

function print(changelog: string, version: string): ReleaseInfo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relinfo-'));
  try {
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, changelog);
    const out = execFileSync('node', [script, '--print', '--changelog', file, '--version', version], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return JSON.parse(out) as ReleaseInfo;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('release info', () => {
  it('the committed file is current', () => {
    expect(() => execFileSync('node', [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('matches package.json', () => {
    expect(RELEASE_INFO.version).toBe(pkg.version);
  });

  it('parses the newest platform and agent sections', () => {
    const out = print(FIXTURE, '2.11.0');
    expect(out.version).toBe('2.11.0');
    expect(out.date).toBe('2026-11-15');
    expect(out.title).toBe('Stage Coverage and a Security Round');
    expect(out.notes).toContain('### Added');
    expect(out.notes).not.toContain('## [2.10.1]');
    expect(out.notes).not.toContain('Unreleased entry');
    expect(out.notes).not.toContain('## Agent');
    expect(out.agent).toEqual({
      version: '0.7.4',
      date: '2026-11-15',
      notes: expect.stringContaining('bundle_results.json') as unknown as string,
    });
  });

  it('writes agent: null when the changelog has no agent section', () => {
    expect(print(FIXTURE_NO_AGENT, '2.11.0').agent).toBeNull();
  });

  it('has an empty title when the summary has no bold lead-in', () => {
    expect(print(FIXTURE_NO_TITLE, '2.11.0').title).toBe('');
  });

  it('fails when the changelog and package.json disagree', () => {
    expect(() => print(FIXTURE, '2.11.1')).toThrow(/does not match package\.json/);
  });
});
