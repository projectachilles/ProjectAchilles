// Shared fixtures for the execution report tests.
//
// Each payload section is an independent unit-test input. The aggregates
// (totals, hosts, actors, timeline, techniques, findings) are deliberately NOT
// mutually consistent with the runs; real payload consistency comes from the
// backend. Later tests' expected numbers are traced against these exact values,
// so do not rebalance them. Only the runs are kept internally coherent
// (start <= completion, key matches hostname, distinct task ids).

import type {
  ExecutionReport, OutcomeCounts, ReportMeta, ReportRun, ReportTest, ReportWindow,
} from '@/services/api/reports';

export const BUNDLE = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';
export const TZ = 'UTC';

/** Default run duration: 6 min 43 s, so the default run starts 12:41:06 and completes 12:47:49. */
const RUN_DURATION_MS = (6 * 60 + 43) * 1000;

export function counts(c: Partial<OutcomeCounts> = {}): OutcomeCounts {
  return { protected: 0, prevented: 0, detected: 0, unprotected: 0, inconclusive: 0, skipped: 0, ...c };
}

export function makeTest(over: Partial<ReportTest> = {}): ReportTest {
  return {
    testKey: BUNDLE,
    name: 'LockBit 3.0 Double Extortion Kill Chain',
    isBundle: true,
    category: 'intel-driven',
    subcategory: 'ransomware',
    score: 8.8,
    target: ['windows-endpoint'],
    complexity: 'high',
    threatActor: 'LockBit 3.0 (S1202)',
    tags: ['lockbit'],
    description: 'Emulates the LockBit 3.0 playbook end to end.',
    runs: 2,
    endpoints: 2,
    lastRun: '2026-10-12T12:47:49.000Z',
    outcomes: counts({ protected: 4, detected: 2, unprotected: 3, inconclusive: 1 }),
    stages: [
      { controlId: 'T1059.001', name: 'Execution & defense degradation', order: 1, techniques: ['T1059.001'], tactics: ['execution'], outcomes: counts({ detected: 2 }), alerts: { defender: 1, crowdstrike: 1 } },
      { controlId: 'T1003.001', name: 'Privileged credential access', order: 2, techniques: ['T1003.001'], tactics: ['credential-access'], outcomes: counts({ protected: 2 }), alerts: { defender: 1, crowdstrike: 0 } },
      { controlId: 'T1021.002', name: 'Lateral movement & propagation', order: 3, techniques: ['T1021.002'], tactics: ['lateral-movement'], outcomes: counts({ unprotected: 1, protected: 1 }), alerts: { defender: 0, crowdstrike: 0 } },
      { controlId: 'T1567.002', name: 'Pre-encryption exfiltration', order: 4, techniques: ['T1567.002'], tactics: ['exfiltration'], outcomes: counts({ unprotected: 2 }), alerts: { defender: 0, crowdstrike: 0 } },
      { controlId: 'T1486', name: 'Encryption & recovery inhibition', order: 5, techniques: ['T1486'], tactics: ['impact'], outcomes: counts({ protected: 1, inconclusive: 1 }), alerts: { defender: 0, crowdstrike: 1 } },
    ],
    ...over,
  };
}

export function makeRun(over: Partial<ReportRun> = {}): ReportRun {
  const completedAt = over.completedAt ?? '2026-10-12T12:47:49.000Z';
  const hostname = over.hostname ?? 'WS-FIN-014';
  const completedMs = Date.parse(completedAt);
  return {
    // The backend derives hostname from the key's third segment, so they never disagree.
    key: `bundle::${BUNDLE}::${hostname}::${completedMs}`,
    testKey: BUNDLE,
    testName: 'LockBit 3.0 Double Extortion Kill Chain',
    hostname,
    completedAt,
    // An explicit override (including null) wins via the trailing spread.
    startedAt: new Date(completedMs - RUN_DURATION_MS).toISOString(),
    taskId: '4c28f408-1676-40ff-a2e6-60ea5bdd6076',
    stages: [
      { controlId: 'T1059.001', name: 'Execution & defense degradation', order: 1, outcome: 'detected', exitCode: 101, techniques: ['T1059.001'], tactics: ['execution'], highImpact: false },
      { controlId: 'T1003.001', name: 'Privileged credential access', order: 2, outcome: 'protected', exitCode: 126, techniques: ['T1003.001'], tactics: ['credential-access'], highImpact: false },
      { controlId: 'T1021.002', name: 'Lateral movement & propagation', order: 3, outcome: 'unprotected', exitCode: 101, techniques: ['T1021.002'], tactics: ['lateral-movement'], highImpact: false },
      { controlId: 'T1567.002', name: 'Pre-encryption exfiltration', order: 4, outcome: 'unprotected', exitCode: 101, techniques: ['T1567.002'], tactics: ['exfiltration'], highImpact: true },
      { controlId: 'T1486', name: 'Encryption & recovery inhibition', order: 5, outcome: 'protected', exitCode: 126, techniques: ['T1486'], tactics: ['impact'], highImpact: false },
    ],
    moreStages: 0,
    alerts: [
      { vendor: 'defender', title: 'Suspicious access to LSASS service', severity: 'high', status: 'resolved', createdAt: '2026-10-12T12:44:31.000Z', stageControlId: 't1003.001', preventionAction: 'blocked', portalUrl: null, autoResolvedAt: '2026-10-12T13:02:10.000Z' },
      { vendor: 'crowdstrike', title: 'ProcRansomware', severity: 'high', status: 'new', createdAt: '2026-10-12T12:48:51.000Z', stageControlId: 't1486', preventionAction: null, portalUrl: null, autoResolvedAt: null },
    ],
    alertsChecked: true,
    ...over,
  };
}

export function makeWindow(over: Partial<ReportWindow> = {}): ReportWindow {
  return {
    preset: '30d',
    label: 'Last 30 days',
    effectiveFrom: '2026-09-13T23:40:00.000Z',
    effectiveTo: '2026-10-13T23:40:00.000Z',
    axisFrom: '2026-09-13T23:40:00.000Z',
    axisTo: '2026-10-13T23:40:00.000Z',
    bucket: 'day',
    firstExecution: '2026-10-11T09:12:00.000Z',
    lastExecution: '2026-10-12T12:47:49.000Z',
    ...over,
  };
}

export function makeReport(
  over: Partial<Omit<ExecutionReport, 'meta'>> & { meta?: Partial<ReportMeta> } = {},
): ExecutionReport {
  const { meta, ...rest } = over;
  const runs = rest.runs ?? [makeRun(), makeRun({ completedAt: '2026-10-11T09:12:00.000Z', hostname: 'WS-OPS-022', taskId: '9e1b7c52-3d84-4a6f-b0c9-5f2a8d71e346', alerts: [] })];
  return {
    meta: {
      reportId: 'RPT-20261013-7F3A',
      generatedAt: '2026-10-13T23:40:00.000Z',
      tz: TZ,
      org: { id: null, name: null },
      filters: {},
      outcomeFiltered: [],
      window: makeWindow(),
      truncation: { runs: false, tests: false, lanes: false },
      warnings: [],
      unavailable: [],
      partial: null,
      edrVendors: ['defender', 'crowdstrike'],
      ...meta,
    },
    totals: {
      runs: runs.length, runsApproximate: false, stageResults: 10, endpoints: 2, tests: 1, techniques: 3,
      tactics: 3, actors: 1, outcomes: counts({ protected: 4, detected: 2, unprotected: 3, inconclusive: 1 }), highImpactUnprotected: 2,
    },
    defenseScore: { score: 61.5, rawScore: null, riskAcceptedCount: 0 },
    timeline: {
      lanes: [{ testKey: BUNDLE, name: 'LockBit 3.0 Double Extortion Kill Chain', runs: runs.length }],
      buckets: [
        { start: '2026-10-11T00:00:00.000Z', lanes: [{ testKey: BUNDLE, runs: 1, outcomes: counts({ protected: 2, unprotected: 3 }) }] },
        { start: '2026-10-12T00:00:00.000Z', lanes: [{ testKey: BUNDLE, runs: 1, outcomes: counts({ protected: 2, detected: 2 }) }] },
      ],
    },
    tests: [makeTest()],
    otherTests: [],
    techniques: [
      { id: 'T1059.001', name: 'PowerShell', tactic: 'Execution', outcomes: counts({ detected: 2 }), testKeys: [BUNDLE] },
      { id: 'T1003.001', name: 'LSASS Memory', tactic: 'Credential Access', outcomes: counts({ protected: 2 }), testKeys: [BUNDLE] },
      { id: 'T1567.002', name: 'Exfiltration to Cloud Storage', tactic: 'Exfiltration', outcomes: counts({ unprotected: 6 }), testKeys: [BUNDLE] },
    ],
    actors: [{ name: 'LockBit 3.0 (S1202)', testKeys: [BUNDLE], runs: runs.length, outcomes: counts({ protected: 4, detected: 2, unprotected: 3 }) }],
    hosts: [
      { hostname: 'WS-FIN-014', runs: 1, outcomes: counts({ protected: 2, detected: 1, unprotected: 2 }) },
      { hostname: 'WS-OPS-022', runs: 1, outcomes: counts({ protected: 2, detected: 1, unprotected: 1 }) },
    ],
    findings: [{
      techniqueId: 'T1567.002', techniqueName: 'Exfiltration to Cloud Storage', tactic: 'Exfiltration', highImpact: true,
      outcomes: counts({ unprotected: 6 }), testKeys: [BUNDLE], testNames: ['LockBit 3.0 Double Extortion Kill Chain'],
      acceptedRisk: false,
      guidance: { testKey: BUNDLE, testName: 'LockBit 3.0 Double Extortion Kill Chain', excerpt: 'Exfiltration · M1021 Restrict Web-Based Content' },
    }],
    runs,
    acceptedRisks: null,
    ...rest,
  };
}
