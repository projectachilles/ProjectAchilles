// Pure tab model for the test detail page (no React).
import type { TestDetails, TestFile } from '@/types/test';

export type TestTabId =
  | 'overview' | 'readme' | 'info' | 'detection' | 'defense'
  | 'references' | 'source' | 'kill-chain' | 'attack-flow';

export interface TestTab {
  id: TestTabId;
  label: string;
  files: TestFile[];
  count?: number;
}

const isReadme = (f: TestFile) => f.name === 'README.md';
const isSafety = (f: TestFile) => f.name === 'SAFETY.md';
const isInfo = (f: TestFile) => f.name.endsWith('_info.md');

function tab(id: TestTabId, label: string, files: TestFile[]): TestTab {
  const t: TestTab = { id, label, files };
  if (files.length > 1) t.count = files.length;
  return t;
}

export function buildTestTabs(test: TestDetails): TestTab[] {
  const files = test.files ?? [];
  const readme = [
    ...files.filter(isReadme),
    ...files.filter(isSafety),
  ];
  const info = files.filter(isInfo);
  const detection = files.filter(f => f.category === 'detection');
  const defense = files.filter(f => f.category === 'defense');
  const references = files.filter(f => f.category === 'references');
  const source = files.filter(
    f =>
      f.category === 'source' ||
      f.category === 'config' ||
      (f.category === 'documentation' && !isReadme(f) && !isSafety(f) && !isInfo(f)),
  );

  const tabs: TestTab[] = [{ id: 'overview', label: 'Overview', files: [] }];
  const add = (id: TestTabId, label: string, list: TestFile[]) => {
    if (list.length > 0) tabs.push(tab(id, label, list));
  };
  add('readme', 'README', readme);
  add('info', 'Info card', info);
  add('detection', 'Detection', detection);
  add('defense', 'Defense', defense);
  add('references', 'References', references);
  add('source', 'Source', source);
  if (test.hasKillChain) tabs.push({ id: 'kill-chain', label: 'Kill chain', files: [] });
  if (test.hasAttackFlow) tabs.push({ id: 'attack-flow', label: 'Attack flow', files: [] });
  return tabs;
}

function defenseName(filename: string): string {
  if (filename.includes('DEFENSE_GUIDANCE')) return 'Defense Guide';
  if (filename.includes('_dr_rules')) return 'D&R Rules';
  if (filename.includes('_hardening')) {
    if (filename.includes('_hardening_linux')) return 'Hardening (Linux)';
    if (filename.includes('_hardening_macos')) return 'Hardening (macOS)';
    return 'Hardening (Windows)';
  }
  if (filename.includes('_detections.kql')) return 'KQL Detections';
  if (filename.includes('_rules.yar')) return 'YARA Rules';
  const ext = filename.split('.').pop() || '';
  return ext.toUpperCase() + ' File';
}

function detectionName(filename: string): string | null {
  if (filename.endsWith('.kql')) return 'Defender KQL';
  if (filename.endsWith('.yar')) return 'YARA';
  if (filename.endsWith('_sigma_rules.yml')) return 'Sigma';
  if (filename.endsWith('.ndjson')) return 'Elastic EQL';
  if (filename.endsWith('_dr_rules.yaml')) return 'LimaCharlie D&R';
  return null;
}

export function fileDisplayName(file: TestFile, uuid: string): string {
  const name = file.name;
  if (file.category === 'defense') return defenseName(name);
  if (file.category === 'detection') {
    const d = detectionName(name);
    if (d) return d;
  }
  if (name.endsWith('_references.md')) return 'References';
  if (name.endsWith('_info.md')) return 'Info card';
  for (const sep of ['_', '-']) {
    const prefix = `${uuid}${sep}`;
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

export function embedDisplayName(filename: string, uuid: string): string {
  const prefix = `${uuid}-`;
  if (!filename.startsWith(prefix)) return filename;
  const rest = filename.slice(prefix.length).replace(/\.exe(\.gz)?$/, '');
  return `stage-${rest}`;
}

export function resolveTabSelection(
  tabs: TestTab[],
  tab: string | null,
  file: string | null,
): { tab: TestTabId; file: string | null } {
  const found = tabs.find(t => t.id === tab);
  if (!found || found.files.length === 0) {
    return { tab: found ? found.id : 'overview', file: null };
  }
  const match = found.files.find(x => x.name === file);
  return { tab: found.id, file: (match ?? found.files[0]).name };
}
