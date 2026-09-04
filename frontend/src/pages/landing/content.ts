// Language-independent content for the ecosystem landing: URLs, ledger data,
// ecosystem edges and tool metadata. Copy lives in ./i18n.ts.
import type { LayerKey, NodeKey, StatusKey, ToolKey } from './i18n';

export const URLS = {
  github: 'https://github.com/projectachilles/ProjectAchilles',
  discussions: 'https://github.com/projectachilles/ProjectAchilles/discussions',
  roadmap: 'https://github.com/projectachilles/ProjectAchilles/blob/main/docs/ROADMAP.md',
  contributing: 'https://github.com/projectachilles/ProjectAchilles/blob/main/.github/CONTRIBUTING.md',
  security: 'https://github.com/projectachilles/ProjectAchilles/blob/main/.github/SECURITY.md',
  blog: 'https://blog.projectachilles.io',
  signIn: '/sign-in',
  f0_library: 'https://github.com/ubercylon8/f0_library',
  f0_hpot: 'https://github.com/ubercylon8/f0_hpot',
  f0_pentest: 'https://github.com/ubercylon8/f0_pentest',
  f0_sectools: 'https://github.com/ubercylon8/f0_sectools',
  hx: 'https://github.com/ubercylon8/hx',
} as const;

// Hero coverage ledger. Flags are prev / log / alert / miss. Illustrative data
// until real f0_csv output is wired in.
export type LedgerRow = { id: string; prev: boolean; log: boolean; alert: boolean; miss: boolean };
const L = (id: string, p: number, l: number, a: number, m: number): LedgerRow => ({
  id,
  prev: !!p,
  log: !!l,
  alert: !!a,
  miss: !!m,
});
export const LEDGER_ROWS: LedgerRow[] = [
  L('T1059.001', 1, 1, 1, 0),
  L('T1003.001', 1, 1, 1, 0),
  L('T1547.001', 0, 1, 1, 0),
  L('T1055.012', 1, 1, 0, 0),
  L('T1021.002', 0, 1, 0, 0),
  L('T1562.001', 0, 0, 0, 1),
  L('T1486', 1, 1, 1, 0),
  L('T1048.003', 0, 0, 0, 1),
];
export const LEDGER_BARS = [38, 42, 40, 51, 55, 53, 61, 64, 70, 68, 74, 79];

// "Why it matters" bars — widths in percent.
export const WHY_BARS = [62, 54, 14];

// Ecosystem map connections (undirected for highlighting purposes).
export const EDGES: Record<NodeKey, NodeKey[]> = {
  csv: ['lib', 'env'],
  lib: ['csv'],
  hpot: ['env'],
  pentest: ['agent', 'env'],
  sectools: ['agent', 'env'],
  hx: ['agent', 'env'],
  agent: ['pentest', 'sectools', 'hx'],
  env: ['csv', 'hpot', 'pentest', 'sectools', 'hx'],
};

export type Tool = { key: ToolKey; name: string; layer: LayerKey; status: StatusKey; repo: string; url: string };
export const TOOLS: Tool[] = [
  { key: 'csv', name: 'f0_csv', layer: 'validate', status: 'production', repo: 'projectachilles/ProjectAchilles', url: URLS.github },
  { key: 'lib', name: 'f0_library', layer: 'validate', status: 'production', repo: 'ubercylon8/f0_library', url: URLS.f0_library },
  { key: 'hpot', name: 'f0_hpot', layer: 'deceive', status: 'production', repo: 'ubercylon8/f0_hpot', url: URLS.f0_hpot },
  { key: 'pentest', name: 'f0_pentest', layer: 'test', status: 'service', repo: 'ubercylon8/f0_pentest', url: URLS.f0_pentest },
  { key: 'sectools', name: 'f0_sectools', layer: 'test', status: 'service', repo: 'ubercylon8/f0_sectools', url: URLS.f0_sectools },
  { key: 'hx', name: 'hx', layer: 'test', status: 'development', repo: 'ubercylon8/hx', url: URLS.hx },
];

// Contribute rows link targets, in the same order as copy.contribute.ways.
export const WAY_URLS = [URLS.f0_library, URLS.github, URLS.f0_hpot, URLS.f0_pentest, URLS.discussions];

export const FOOTER_REPOS: { label: string; url: string }[] = [
  { label: 'projectachilles/ProjectAchilles', url: URLS.github },
  { label: 'ubercylon8/f0_library', url: URLS.f0_library },
  { label: 'ubercylon8/f0_hpot', url: URLS.f0_hpot },
  { label: 'ubercylon8/f0_pentest', url: URLS.f0_pentest },
  { label: 'ubercylon8/f0_sectools', url: URLS.f0_sectools },
  { label: 'ubercylon8/hx', url: URLS.hx },
];

// Roadmap phase accent: the first two are accent, the rest muted.
export const ROADMAP_ACCENT = [true, true, false, false];

export const ROADMAP_PROGRESS = 58;
