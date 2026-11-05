import { describe, it, expect } from 'vitest';
import type { TestDetails, TestFile } from '@/types/test';
import {
  buildTestTabs,
  fileDisplayName,
  embedDisplayName,
  resolveTabSelection,
} from '../testTabs';

const UUID = '8f68dda1-1111-2222-3333-444455556666';

function f(name: string, category: TestFile['category'], type: TestFile['type'] = 'other'): TestFile {
  return { name, path: `/t/${name}`, type, size: 1, category };
}

function details(files: TestFile[], extra: Partial<TestDetails> = {}): TestDetails {
  return {
    uuid: UUID,
    name: 'Test',
    techniques: [],
    isMultiStage: false,
    stages: [],
    files,
    hasAttackFlow: false,
    hasKillChain: false,
    hasReadme: false,
    hasInfoCard: false,
    hasSafetyDoc: false,
    hasDetectionFiles: false,
    hasDefenseGuidance: false,
    hasReferences: false,
    ...extra,
  };
}

describe('buildTestTabs', () => {
  it('builds the full tab set for a rich test, in order, with counts', () => {
    const files = [
      f('SAFETY.md', 'documentation', 'markdown'),
      f('README.md', 'documentation', 'markdown'),
      f(`${UUID}_info.md`, 'documentation', 'markdown'),
      f(`${UUID}_detections.kql`, 'detection', 'kql'),
      f(`${UUID}_rules.yar`, 'detection', 'yara'),
      f(`${UUID}_sigma_rules.yml`, 'detection', 'sigma'),
      f(`${UUID}_elastic.ndjson`, 'detection', 'ndjson'),
      f(`${UUID}_dr_rules.yaml`, 'detection', 'yaml'),
      f(`${UUID}_DEFENSE_GUIDANCE.md`, 'defense', 'markdown'),
      f(`${UUID}_hardening.ps1`, 'defense', 'powershell'),
      f(`${UUID}_dr_rules.yaml`, 'defense', 'yaml'),
      f(`${UUID}_references.md`, 'references', 'markdown'),
      ...Array.from({ length: 10 }, (_, i) => f(`stage${i}.go`, 'source', 'go')),
      f('go.mod', 'config'),
    ];
    const tabs = buildTestTabs(details(files, { hasKillChain: true }));
    expect(tabs.map(t => t.id)).toEqual([
      'overview', 'readme', 'info', 'detection', 'defense', 'references', 'source', 'kill-chain',
    ]);
    const counts = Object.fromEntries(tabs.filter(t => t.count).map(t => [t.id, t.count]));
    expect(counts).toEqual({ readme: 2, detection: 5, defense: 3, source: 11 });
    expect(tabs.find(t => t.id === 'readme')!.files.map(x => x.name)).toEqual(['README.md', 'SAFETY.md']);
  });

  it('puts remaining documentation files in source and adds the attack flow tab', () => {
    const tabs = buildTestTabs(details(
      [f('main.go', 'source', 'go'), f('NOTES.md', 'documentation', 'markdown')],
      { hasAttackFlow: true },
    ));
    expect(tabs.map(t => t.id)).toEqual(['overview', 'source', 'attack-flow']);
    expect(tabs[1].files.map(x => x.name)).toEqual(['main.go', 'NOTES.md']);
  });

  it('returns overview + source for a Go-only custom test', () => {
    const tabs = buildTestTabs(details([f('main.go', 'source', 'go')]));
    expect(tabs.map(t => t.id)).toEqual(['overview', 'source']);
    expect(tabs[1].count).toBeUndefined();
  });
});

describe('fileDisplayName', () => {
  const cases: Array<[string, TestFile['category'], string]> = [
    ['x_DEFENSE_GUIDANCE.md', 'defense', 'Defense Guide'],
    ['x_dr_rules.yaml', 'defense', 'D&R Rules'],
    ['x_hardening.ps1', 'defense', 'Hardening (Windows)'],
    ['x_hardening_linux.sh', 'defense', 'Hardening (Linux)'],
    ['x_hardening_macos.sh', 'defense', 'Hardening (macOS)'],
    ['x_detections.kql', 'defense', 'KQL Detections'],
    ['x_rules.yar', 'defense', 'YARA Rules'],
    ['x.txt', 'defense', 'TXT File'],
    ['x_detections.kql', 'detection', 'Defender KQL'],
    ['x_rules.yar', 'detection', 'YARA'],
    ['x_sigma_rules.yml', 'detection', 'Sigma'],
    ['x_elastic.ndjson', 'detection', 'Elastic EQL'],
    ['x_dr_rules.yaml', 'detection', 'LimaCharlie D&R'],
    ['x_references.md', 'references', 'References'],
    ['x_info.md', 'documentation', 'Info card'],
    [`${UUID}_notes.md`, 'documentation', 'notes.md'],
    [`${UUID}-main.go`, 'source', 'main.go'],
    ['main.go', 'source', 'main.go'],
  ];
  it.each(cases)('%s (%s) -> %s', (name, category, expected) => {
    expect(fileDisplayName(f(name, category), UUID)).toBe(expected);
  });
});

describe('embedDisplayName', () => {
  it.each([
    [`${UUID}-T1055.exe`, 'stage-T1055'],
    [`${UUID}-T1518.001.exe`, 'stage-T1518.001'],
    [`${UUID}-T1518.001.exe.gz`, 'stage-T1518.001'],
    [`${UUID}-T1055.exe.gz`, 'stage-T1055'],
    ['rwdrv.sys', 'rwdrv.sys'],
    ['validator-defender.exe', 'validator-defender.exe'],
  ])('%s -> %s', (name, expected) => {
    expect(embedDisplayName(name, UUID)).toBe(expected);
  });
});

describe('resolveTabSelection', () => {
  const tabs = buildTestTabs(details([
    f('a_DEFENSE_GUIDANCE.md', 'defense'), f('a_hardening.ps1', 'defense'), f('m.go', 'source'),
  ]));
  it('falls back to the first file of the tab', () => {
    expect(resolveTabSelection(tabs, 'defense', 'nope.md')).toEqual({ tab: 'defense', file: 'a_DEFENSE_GUIDANCE.md' });
    expect(resolveTabSelection(tabs, 'defense', null)).toEqual({ tab: 'defense', file: 'a_DEFENSE_GUIDANCE.md' });
  });
  it('keeps a valid file', () => {
    expect(resolveTabSelection(tabs, 'defense', 'a_hardening.ps1')).toEqual({ tab: 'defense', file: 'a_hardening.ps1' });
  });
  it('unknown tab -> overview', () => {
    expect(resolveTabSelection(tabs, 'bogus', null)).toEqual({ tab: 'overview', file: null });
    expect(resolveTabSelection(tabs, 'overview', 'x')).toEqual({ tab: 'overview', file: null });
  });
});
