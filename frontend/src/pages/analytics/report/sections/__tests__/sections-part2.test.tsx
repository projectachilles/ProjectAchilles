import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TestDetail } from '../TestDetail';
import { Findings } from '../Findings';
import { ExecutionLog } from '../ExecutionLog';
import { RunStrips } from '../RunStrips';
import { Method } from '../Method';
import { countStages, firstAlert } from '../../lib/runs';
import { BUNDLE, counts, makeReport, makeRun, makeTest } from '../../__tests__/fixtures';
import type { AcceptedRiskRow, ReportMeta, ReportRun } from '@/services/api/reports';

const head = { left: 'h', right: 'r' };
const ALERTS_INCOMPLETE = 'EDR alert correlation was incomplete — see the notice on the summary page.';
const NO_ALERTS = 'No EDR alert was correlated to these runs.';

/** A run as a big-scope report ships it: stages keep controlId/order/outcome but lose name, techniques and tactics. */
const nameless = (run: ReportRun): ReportRun => ({
  ...run,
  stages: run.stages.map(({ name: _n, techniques: _t, tactics: _ta, ...s }) => s),
});
const noEdr = (): { meta: Partial<ReportMeta> } => ({ meta: { edrVendors: [] } });
const silentRuns = (over: Partial<ReportRun> = {}) => [
  makeRun({ alerts: [], ...over }),
  makeRun({ completedAt: '2026-10-11T09:12:00.000Z', hostname: 'WS-OPS-022', taskId: '9e1b7c52-3d84-4a6f-b0c9-5f2a8d71e346', alerts: [], ...over }),
];
const hostRow = (hostname: string) => screen.getByText(hostname).closest('tr') as HTMLElement;
/** A row of the endpoint matrix (the hostname also appears in the alert table). */
const matrixRow = (hostname: string) => {
  const matrix = screen.getByText('Latest result on each endpoint').closest('div') as HTMLElement;
  return within(matrix).getByText(hostname).closest('tr') as HTMLElement;
};

describe('run helpers', () => {
  it('counts a run\'s stages and finds its first alert', () => {
    const run = makeRun();
    expect(countStages(run.stages)).toMatchObject({ protected: 2, detected: 1, unprotected: 2 });
    expect(firstAlert(run)?.vendor).toBe('defender');
    expect(firstAlert(makeRun({ alerts: [] }))).toBeNull();
  });
});

/** 63 characters, a realistic FQDN with no break opportunity but its dots. */
const LONG_HOST = 'wks-fin-0042.finance-operations.emea.corp.contoso-international';

describe('TestDetail', () => {
  it('keeps the kill-chain heading in the same unbreakable block as the first row of chevrons', () => {
    const { container } = render(<TestDetail report={makeReport()} test={makeTest()} head={head} />);
    const block = screen.getByRole('heading', { name: /Kill chain/ }).closest('.rp-avoid');
    expect(block).not.toBeNull();
    expect(block!.contains(container.querySelector('polygon.rp-kc'))).toBe(true);
  });

  it('lets hostnames, control ids and technique lists wrap, and keeps dates on one line', () => {
    expect(LONG_HOST).toHaveLength(63);
    const standalone = makeTest({
      isBundle: false, category: 'host-hardening',
      stages: [{ ...makeTest().stages[0], controlId: null, techniques: ['T1059.001', 'T1059.003', 'T1105', 'T1112', 'T1547.001', 'T1562.001'] }],
    });
    const runs = [makeRun({ hostname: LONG_HOST })];
    render(<TestDetail report={makeReport({ runs })} test={standalone} head={head} />);
    expect(screen.getByText('T1059.001, T1059.003, T1105, T1112, T1547.001, T1562.001')).toHaveClass('rp-id');
    for (const cell of screen.getAllByText(LONG_HOST)) {
      expect(cell.tagName).toBe('TD');
      expect(cell).toHaveClass('rp-id');
    }
    // The alert table's "Raised" cell is a date: it stays on one line.
    expect(screen.getByText('12 Oct 12:48')).toHaveClass('rp-nowrap');
  });

  it('uses the kill-chain flow for intel-driven bundles', () => {
    const { container } = render(<TestDetail report={makeReport()} test={makeTest()} head={head} />);
    expect(screen.getByRole('heading', { name: /Kill chain/ })).toBeInTheDocument();
    expect(container.querySelectorAll('polygon.rp-kc')).toHaveLength(5);
    expect(screen.getByText('Latest result on each endpoint')).toBeInTheDocument();
    expect(screen.getByText('ProcRansomware')).toBeInTheDocument();
  });

  it('uses a control table for cyber-hygiene bundles', () => {
    render(<TestDetail report={makeReport()} test={makeTest({ category: 'cyber-hygiene' })} head={head} />);
    expect(screen.getByRole('heading', { name: /Controls/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Kill chain/ })).toBeNull();
  });

  it('shows a standalone test as a single result row', () => {
    const test = makeTest({ isBundle: false, category: 'host-hardening', stages: [makeTest().stages[0]] });
    render(<TestDetail report={makeReport()} test={test} head={head} />);
    expect(screen.getByRole('heading', { name: /^Result/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Kill chain|Controls/ })).toBeNull();
  });

  it('lists each endpoint once, by its newest run', () => {
    const older = makeRun({ completedAt: '2026-10-10T08:00:00.000Z', alerts: [], taskId: '11111111-1111-4111-8111-111111111111' });
    const newer = makeRun({ alerts: [] });
    render(<TestDetail report={makeReport({ runs: [older, newer] })} test={makeTest()} head={head} />);
    const rows = within(screen.getByText('Latest result on each endpoint').closest('div') as HTMLElement).getAllByRole('row');
    expect(rows).toHaveLength(2); // header + WS-FIN-014
    expect(within(matrixRow('WS-FIN-014')).getByText('12 Oct')).toBeInTheDocument();
  });

  it('caps the endpoint matrix and says how many were left out', () => {
    const runs = Array.from({ length: 14 }, (_, i) => makeRun({
      hostname: `WS-${String(i).padStart(2, '0')}`,
      alerts: [],
      taskId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    const truncated = makeReport({ runs, meta: { truncation: { runs: true, tests: false, lanes: false } } });
    render(<TestDetail report={truncated} test={makeTest()} head={head} />);
    expect(screen.getByText('First 12 of 14 endpoints, from the newest runs')).toBeInTheDocument();
    expect(screen.queryByText('WS-12')).toBeNull();
  });

  it('shows a long control list as one glyph row per endpoint instead of overflowing columns', () => {
    const stageOutcomes = ['protected', 'unprotected', 'detected', 'skipped'] as const;
    const stages = Array.from({ length: 14 }, (_, i) => ({
      ...makeTest().stages[0], controlId: `CH-${i}`, name: `Control ${i}`, order: i + 1,
    }));
    const test = makeTest({ category: 'cyber-hygiene', stages });
    const run = makeRun({
      alerts: [],
      stages: stages.map((s, i) => ({ controlId: s.controlId, name: s.name, order: s.order, outcome: stageOutcomes[i % 4], exitCode: 101, techniques: [], tactics: [], highImpact: false })),
    });
    render(<TestDetail report={makeReport({ runs: [run] })} test={test} head={head} />);
    const matrix = within(screen.getByText('Latest result on each endpoint').closest('div') as HTMLElement);
    expect(matrix.getByRole('columnheader', { name: 'Stages' })).toBeInTheDocument();
    expect(matrix.queryByRole('columnheader', { name: 'S13' })).toBeNull();
    // Skipped stages are not results, so the row draws 11 of the 14.
    const row = matrix.getByRole('img', { name: /Protected, Unprotected, Detected/ });
    expect(row.getAttribute('aria-label')?.split(', ')).toHaveLength(11);
    expect(matrix.getByText('Unprotected, exfiltration or impact')).toBeInTheDocument();
  });

  it('has no stage column in the alert table of a standalone test', () => {
    const test = makeTest({ isBundle: false, category: 'host-hardening', stages: [makeTest().stages[0]] });
    render(<TestDetail report={makeReport()} test={test} head={head} />);
    expect(screen.getByText('ProcRansomware')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Stage' })).toBeNull();
  });

  it('names the stage an alert fired on, from the run\'s own stages', () => {
    render(<TestDetail report={makeReport()} test={makeTest()} head={head} />);
    expect(screen.getByText('S2 Privileged credential access')).toBeInTheDocument();
    expect(screen.getByText('S5 Encryption & recovery inhibition')).toBeInTheDocument();
  });

  it('resolves stage names from the test when the run stages carry none (big-scope payload)', () => {
    const runs = makeReport().runs.map(nameless);
    expect(runs[0].stages[0].name).toBeUndefined();
    const { container } = render(<TestDetail report={makeReport({ runs })} test={makeTest()} head={head} />);
    expect(screen.getByText('S2 Privileged credential access')).toBeInTheDocument();
    expect(screen.getByText('S5 Encryption & recovery inhibition')).toBeInTheDocument();
    // The matrix still matches run stages to the test's stages by controlId.
    expect(within(matrixRow('WS-FIN-014')).getAllByText(/Detected|Protected|Unprotected/)).toHaveLength(5);
    expect(container.textContent).not.toContain('undefined');
  });

  it('names the stage of an alert on a control the run did not fetch', () => {
    const controls = Array.from({ length: 70 }, (_, i) => ({
      ...makeTest().stages[0], controlId: `CH-DEF-${String(i + 1).padStart(3, '0')}`, name: `Control ${i + 1}`, order: i + 1,
    }));
    const test = makeTest({ category: 'cyber-hygiene', stages: controls });
    const [alert] = makeRun().alerts;
    const run = makeRun({
      stages: controls.slice(0, 60).map((s) => ({ ...makeRun().stages[1], controlId: s.controlId, name: s.name, order: s.order })),
      moreStages: 10,
      alerts: [{ ...alert, stageControlId: 'ch-def-069' }],
    });
    render(<TestDetail report={makeReport({ tests: [test], runs: [run] })} test={test} head={head} />);
    expect(screen.getByText('S69 Control 69')).toBeInTheDocument();
    expect(screen.queryByText('bundle')).toBeNull();
  });

  it('labels the alert table as sampled when the runs list was cut', () => {
    const truncated = makeReport({ meta: { truncation: { runs: true, tests: false, lanes: false } } });
    render(<TestDetail report={truncated} test={makeTest()} head={head} />);
    expect(screen.getByRole('heading', { name: /Most recent correlated EDR alerts/ })).toHaveTextContent('From the newest runs');
  });

  it('omits every EDR cell when no vendor is configured', () => {
    const { container } = render(<TestDetail report={makeReport(noEdr())} test={makeTest()} head={head} />);
    expect(screen.queryByText('Most recent correlated EDR alerts')).toBeNull();
    expect(screen.queryByText('ProcRansomware')).toBeNull();
    expect(container.textContent).not.toContain('Alerts:');
    expect(container.textContent).not.toContain(ALERTS_INCOMPLETE);
  });

  it('omits the alert column of the control table when no vendor is configured', () => {
    const hygiene = makeTest({ category: 'cyber-hygiene' });
    const { rerender } = render(<TestDetail report={makeReport()} test={hygiene} head={head} />);
    expect(screen.getByRole('columnheader', { name: 'Alerts' })).toBeInTheDocument();
    rerender(<TestDetail report={makeReport(noEdr())} test={hygiene} head={head} />);
    expect(screen.queryByRole('columnheader', { name: 'Alerts' })).toBeNull();
  });

  it('lists only the configured vendors on the kill chain', () => {
    const { container } = render(<TestDetail report={makeReport({ meta: { edrVendors: ['defender'] } })} test={makeTest()} head={head} />);
    const chain = Array.from(container.querySelectorAll('.rp-kc-sub')).map((el) => el.textContent).join('|');
    expect(chain).toContain('Alerts: Defender 1');
    expect(chain).not.toContain('Falcon');
  });

  it('flags incomplete alert correlation but still lists the alerts that were found', () => {
    render(<TestDetail report={makeReport({ meta: { unavailable: ['alerts'] } })} test={makeTest()} head={head} />);
    expect(screen.getByText(ALERTS_INCOMPLETE)).toBeInTheDocument();
    expect(screen.getByText('ProcRansomware')).toBeInTheDocument();
  });

  it('prints control-table alert counts as lower bounds and zeros as a dash when correlation is incomplete', () => {
    const hygiene = makeTest({ category: 'cyber-hygiene' });
    render(<TestDetail report={makeReport({ meta: { unavailable: ['alerts'] } })} test={hygiene} head={head} />);
    const table = screen.getByRole('columnheader', { name: 'Alerts' }).closest('table') as HTMLElement;
    const alertCells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').at(-1)?.textContent);
    expect(alertCells).toEqual(['≥2', '≥1', '—', '—', '≥1']);
  });

  it('passes incomplete correlation to the kill chain', () => {
    const { container } = render(<TestDetail report={makeReport({ meta: { unavailable: ['alerts'] } })} test={makeTest()} head={head} />);
    expect(container.textContent).toContain('Alerts: Defender ≥1 · Falcon ≥1');
    expect(container.textContent).not.toMatch(/Defender 0|Falcon 0/);
  });

  it('keeps plain alert counts when correlation completed', () => {
    render(<TestDetail report={makeReport()} test={makeTest({ category: 'cyber-hygiene' })} head={head} />);
    const table = screen.getByRole('columnheader', { name: 'Alerts' }).closest('table') as HTMLElement;
    const alertCells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').at(-1)?.textContent);
    expect(alertCells).toEqual(['2', '1', '0', '0', '1']);
  });

  it('says the stage alert counts come from the newest runs when this test\'s runs were cut', () => {
    const truncation = { runs: true, tests: false, lanes: false };
    const test = makeTest({ runs: 1504 });
    const { rerender } = render(<TestDetail report={makeReport({ meta: { truncation } })} test={test} head={head} />);
    // Outcomes and rates are aggregated over every run; only the alert counts come from the fetched runs.
    expect(screen.getByRole('heading', { name: /^Kill chain/ })).toHaveTextContent('All 1,504 runs · alert counts from the newest 2');

    rerender(<TestDetail report={makeReport()} test={test} head={head} />);
    expect(screen.getByRole('heading', { name: /^Kill chain/ })).toHaveTextContent(/All 1,504 runs$/);

    // No EDR means no alert counts, so nothing in the block comes from the fetched runs.
    rerender(<TestDetail report={makeReport({ meta: { truncation, edrVendors: [] } })} test={test} head={head} />);
    expect(screen.getByRole('heading', { name: /^Kill chain/ })).toHaveTextContent(/All 1,504 runs$/);

    // Every run of this test was fetched: no caveat even though the report as a whole was cut.
    rerender(<TestDetail report={makeReport({ meta: { truncation } })} test={makeTest()} head={head} />);
    expect(screen.getByRole('heading', { name: /^Kill chain/ })).toHaveTextContent(/All 2 runs$/);
  });

  it('does not flag incomplete correlation on a tenant without EDR', () => {
    render(<TestDetail report={makeReport({ meta: { edrVendors: [], unavailable: ['alerts'] } })} test={makeTest()} head={head} />);
    expect(screen.queryByText(ALERTS_INCOMPLETE)).toBeNull();
  });
});

describe('Findings', () => {
  it('shows the guidance excerpt and its source', () => {
    render(<Findings report={makeReport()} head={head} />);
    expect(screen.getByText('Exfiltration · M1021 Restrict Web-Based Content')).toBeInTheDocument();
    expect(screen.getByText('From the defense guidance of LockBit 3.0 Double Extortion Kill Chain')).toBeInTheDocument();
    expect(screen.getByText('high impact')).toBeInTheDocument();
  });

  it('names each test once, caps the list at five and never prints a test id', () => {
    const otherTests = Array.from({ length: 8 }, (_, i) => ({ testKey: `k${i}`, name: i < 3 ? 'DPRK BlueNoroff Chain' : `Test ${i}`, runs: 1, outcomes: counts({ protected: 1 }) }));
    const report = makeReport({ otherTests });
    report.findings[0] = {
      ...report.findings[0],
      testKeys: [BUNDLE, ...otherTests.map((t) => t.testKey), 'f00dfeed-0000-4000-8000-000000000000'],
      // The backend prints the key when it cannot name a test.
      testNames: ['LockBit 3.0 Double Extortion Kill Chain', ...otherTests.map((t) => t.name), 'f00dfeed-0000-4000-8000-000000000000'],
    };
    const { container } = render(<Findings report={report} head={head} />);
    expect(container.textContent).toContain(
      'tested by LockBit 3.0 Double Extortion Kill Chain, DPRK BlueNoroff Chain, Test 3, Test 4, Test 5 +2 more, 1 other test',
    );
    expect(container.textContent).not.toContain('f00dfeed');
  });

  it('points to the file when no section matches, and omits accepted risks when not permitted', () => {
    const report = makeReport();
    report.findings[0].guidance = { ...report.findings[0].guidance!, excerpt: null };
    render(<Findings report={report} head={head} />);
    expect(screen.getByText(/See the defense guidance for LockBit/)).toBeInTheDocument();
    expect(screen.queryByText('Accepted risks')).toBeNull();
  });

  it('shows an empty accepted-risk table when permitted but none apply', () => {
    render(<Findings report={makeReport({ acceptedRisks: [] })} head={head} />);
    expect(screen.getByText('No active accepted risks for the tests in this scope.')).toBeInTheDocument();
  });

  it('lists accepted risks with their scope', () => {
    const risks: AcceptedRiskRow[] = [
      { testName: 'LockBit 3.0', controlId: 'T1567.002', hostname: 'WS-FIN-014', scope: 'host', justification: 'Compensating proxy control', acceptedBy: 'ciso@example.org', acceptedAt: '2026-10-01T10:00:00.000Z' },
      { testName: 'Credential Dump', controlId: null, hostname: null, scope: 'global', justification: 'Legacy system', acceptedBy: 'ops@example.org', acceptedAt: '2026-09-15T10:00:00.000Z' },
    ];
    render(<Findings report={makeReport({ acceptedRisks: risks })} head={head} />);
    expect(within(screen.getByText('Compensating proxy control').closest('tr') as HTMLElement).getByText('WS-FIN-014')).toBeInTheDocument();
    expect(within(screen.getByText('Legacy system').closest('tr') as HTMLElement).getByText('All endpoints')).toBeInTheDocument();
    expect(screen.getByText('1 Oct 2026')).toBeInTheDocument();
    expect(screen.queryByText('No active accepted risks for the tests in this scope.')).toBeNull();
  });

  it('says accepted risks are unavailable instead of "none" when the lookup failed', () => {
    for (const acceptedRisks of [null, [] as AcceptedRiskRow[]]) {
      const { unmount } = render(<Findings report={makeReport({ acceptedRisks, meta: { unavailable: ['acceptedRisks'] } })} head={head} />);
      expect(screen.getByText('Accepted risks unavailable — see the notice on the summary page.')).toBeInTheDocument();
      expect(screen.queryByText('No active accepted risks for the tests in this scope.')).toBeNull();
      unmount();
    }
  });

  it('says so when no technique fell below the threshold', () => {
    render(<Findings report={makeReport({ findings: [] })} head={head} />);
    expect(screen.getByText('No technique fell below the threshold in this scope.')).toBeInTheDocument();
  });

  it('shows what held only for techniques with enough conclusive results', () => {
    const report = makeReport();
    report.techniques = [
      { id: 'T1003.001', name: 'LSASS Memory', tactic: 'Credential Access', outcomes: counts({ protected: 9, unprotected: 1 }), testKeys: [] },
      { id: 'T1059.001', name: 'PowerShell', tactic: 'Execution', outcomes: counts({ protected: 4 }), testKeys: [] },
    ];
    render(<Findings report={report} head={head} />);
    expect(screen.getByRole('heading', { name: /^What held/ })).toBeInTheDocument();
    expect(screen.getByText('T1003.001')).toBeInTheDocument();
    expect(screen.queryByText('T1059.001')).toBeNull();
  });

  it('counts silent runs against the runs whose alerts were actually searched', () => {
    render(<Findings report={makeReport()} head={head} />);
    expect(screen.getByRole('heading', { name: /Time to first EDR alert/ })).toHaveTextContent('1 of 2 checked runs raised no alert');
  });

  it('says no alert was correlated only when every run was checked', () => {
    render(<Findings report={makeReport({ runs: silentRuns() })} head={head} />);
    expect(screen.getByText(NO_ALERTS)).toBeInTheDocument();
  });

  it('does not claim "no alert" for runs that were not checked', () => {
    const report = makeReport({ runs: silentRuns({ alertsChecked: false }) });
    report.runs[1].alertsChecked = true;
    render(<Findings report={report} head={head} />);
    expect(screen.queryByText(NO_ALERTS)).toBeNull();
    expect(screen.getByText('No EDR alert was found.')).toBeInTheDocument();
    expect(screen.getByText('Alerts were not checked for 1 of 2 runs.')).toBeInTheDocument();
    // The unchecked run is neither silent nor counted in the denominator.
    expect(screen.getByRole('heading', { name: /Time to first EDR alert/ })).toHaveTextContent('1 of 1 checked run raised no alert');
  });

  it('prints no silent-run tally when no run was checked', () => {
    const report = makeReport({ runs: silentRuns({ alertsChecked: false }), meta: { unavailable: ['alerts'] } });
    const { container } = render(<Findings report={report} head={head} />);
    expect(container.textContent).not.toContain('raised no alert');
    expect(screen.getByRole('heading', { name: 'Time to first EDR alert' })).toBeInTheDocument();
    expect(screen.getByText('Alerts were not checked for 2 of 2 runs.')).toBeInTheDocument();
    expect(screen.queryByText(NO_ALERTS)).toBeNull();
    expect(screen.queryByText('No EDR alert was found.')).toBeNull();
  });

  it('does not count an unchecked run that carries alerts as checked', () => {
    const report = makeReport();
    report.runs[0] = { ...report.runs[0], alertsChecked: false };
    render(<Findings report={report} head={head} />);
    expect(screen.getByRole('heading', { name: /Time to first EDR alert/ })).toHaveTextContent('1 of 1 checked run raised no alert');
  });

  it('flags incomplete correlation and still plots the alerts that were found', () => {
    const { container } = render(<Findings report={makeReport({ meta: { unavailable: ['alerts'] } })} head={head} />);
    expect(screen.getByText(ALERTS_INCOMPLETE)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('omits the whole alert-latency block when no vendor is configured', () => {
    const { container } = render(<Findings report={makeReport({ ...noEdr(), runs: silentRuns({ alertsChecked: false }) })} head={head} />);
    expect(screen.queryByText(/Time to first EDR alert/)).toBeNull();
    expect(container.textContent).not.toContain('No EDR alert');
    expect(container.textContent).not.toContain('not checked');
    expect(container.textContent).not.toContain(ALERTS_INCOMPLETE);
  });
});

describe('ExecutionLog', () => {
  it('lists every run, or says how many were left out', () => {
    const { rerender } = render(<ExecutionLog report={makeReport()} head={head} />);
    expect(screen.getByText('Newest first. All 2 runs.')).toBeInTheDocument();
    const truncated = makeReport({ meta: { truncation: { runs: true, tests: false, lanes: false } } });
    truncated.totals.runs = 1504;
    rerender(<ExecutionLog report={truncated} head={head} />);
    expect(screen.getByText('Newest first. The newest 2 of 1,504 runs.')).toBeInTheDocument();
  });

  it('calls an approximate run total approximate', () => {
    const truncated = makeReport({ meta: { truncation: { runs: true, tests: false, lanes: false } } });
    truncated.totals.runs = 12000;
    truncated.totals.runsApproximate = true;
    render(<ExecutionLog report={truncated} head={head} />);
    expect(screen.getByText('Newest first. The newest 2 of about 12,000 runs.')).toBeInTheDocument();
  });

  it('puts the newest run first whatever order the payload arrives in', () => {
    const [newest, oldest] = makeReport().runs;
    render(<ExecutionLog report={makeReport({ runs: [oldest, newest] })} head={head} />);
    const hosts = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent);
    expect(hosts).toEqual(['WS-FIN-014', 'WS-OPS-022']);
  });

  it('shows each run\'s first alert, a dash when none, and "not checked" when unknown', () => {
    const report = makeReport();
    report.runs[1] = { ...report.runs[1], alertsChecked: false };
    render(<ExecutionLog report={report} head={head} />);
    expect(within(hostRow('WS-FIN-014')).getByText('−3m 18s Defender')).toBeInTheDocument();
    expect(within(hostRow('WS-OPS-022')).getByText('not checked')).toBeInTheDocument();
    expect(within(hostRow('WS-OPS-022')).queryByText('—')).toBeNull();
  });

  it('does not read as "none" when the run\'s only alert has no time', () => {
    const report = makeReport();
    report.runs[0] = { ...report.runs[0], alerts: [{ ...report.runs[0].alerts[0], createdAt: '' }] };
    render(<ExecutionLog report={report} head={head} />);
    expect(within(hostRow('WS-FIN-014')).getByText('Defender (time unknown)')).toBeInTheDocument();
  });

  it('shows a dash for a run whose alerts were searched and found nothing', () => {
    render(<ExecutionLog report={makeReport()} head={head} />);
    expect(within(hostRow('WS-OPS-022')).getByText('—')).toBeInTheDocument();
  });

  it('still shows an alert found on a run that was not fully checked', () => {
    const report = makeReport();
    report.runs[0] = { ...report.runs[0], alertsChecked: false };
    render(<ExecutionLog report={report} head={head} />);
    expect(within(hostRow('WS-FIN-014')).getByText('−3m 18s Defender')).toBeInTheDocument();
  });

  it('counts defended stages per run, with or without stage names', () => {
    const runs = makeReport().runs.map(nameless);
    render(<ExecutionLog report={makeReport({ runs })} head={head} />);
    expect(within(hostRow('WS-FIN-014')).getByText('3/5')).toBeInTheDocument();
    expect(within(hostRow('WS-FIN-014')).getByRole('img', { name: /Detected, Protected, Unprotected/ })).toBeInTheDocument();
  });

  it('notes stages that were not fetched', () => {
    const report = makeReport();
    report.runs[0] = { ...report.runs[0], moreStages: 7 };
    render(<ExecutionLog report={report} head={head} />);
    expect(within(hostRow('WS-FIN-014')).getByText('(+7 not fetched)')).toBeInTheDocument();
  });

  it('prints one count for a long run: the hidden glyphs, then the stages not fetched', () => {
    const stages = Array.from({ length: 60 }, (_, i) => ({ ...makeRun().stages[1], controlId: `C-${i + 1}`, order: i + 1 }));
    const report = makeReport({ runs: [makeRun({ stages, moreStages: 10 })] });
    render(<ExecutionLog report={report} head={head} />);
    const more = hostRow('WS-FIN-014').querySelectorAll('.rp-more');
    expect(more).toHaveLength(1);
    expect(more[0]).toHaveTextContent('+44 (+10 not fetched)');
  });

  it('keeps the not-fetched note out of the glyph row, which alone sets the Stages column width', () => {
    const stages = Array.from({ length: 70 }, (_, i) => ({ ...makeRun().stages[1], controlId: `C-${i + 1}`, order: i + 1 }));
    render(<ExecutionLog report={makeReport({ runs: [makeRun({ stages, moreStages: 10 })] })} head={head} />);
    const row = hostRow('WS-FIN-014');
    const note = row.querySelector('.rp-more') as HTMLElement;
    const svg = row.querySelector('svg[role="img"]') as SVGElement;
    expect(note).toHaveTextContent('+54 (+10 not fetched)');
    expect(note.parentElement).not.toBe(svg.parentElement);
    expect(svg.closest('.rp-glyph-row')!.contains(note)).toBe(false);
  });

  it('lets the first-alert cell wrap, but never inside a latency', () => {
    const report = makeReport();
    const alert = report.runs[0].alerts[0];
    report.runs[0] = { ...report.runs[0], alerts: [{ ...alert, createdAt: '' }] };
    // The second run completed 09:12:00, so this alert is 13m 34s after it.
    report.runs[1] = { ...report.runs[1], alerts: [{ ...alert, createdAt: '2026-10-11T09:25:34.000Z' }] };
    render(<ExecutionLog report={report} head={head} />);
    const unknown = within(hostRow('WS-FIN-014')).getByText('Defender (time unknown)');
    expect(unknown).toHaveClass('rp-num-wrap');
    expect(unknown).not.toHaveClass('rp-num');
    expect(unknown).not.toHaveClass('rp-nowrap');
    // Words break between the vendor and what follows, so the two parts may stack; a latency does not split.
    expect(unknown.textContent).toBe('Defender (time\u00a0unknown)');
    const timed = within(hostRow('WS-OPS-022')).getAllByRole('cell')[5];
    expect(timed).toHaveClass('rp-num-wrap');
    expect(timed.textContent).toBe('+13m\u00a034s Defender');
  });

  it('keeps "not checked" on one line, like "(time unknown)"', () => {
    render(<ExecutionLog report={makeReport({ runs: silentRuns({ alertsChecked: false }) })} head={head} />);
    const unchecked = within(hostRow('WS-FIN-014')).getAllByRole('cell')[5];
    expect(unchecked).toHaveClass('rp-num-wrap');
    expect(unchecked.textContent).toBe('not checked');
  });

  it('lets a 63-character hostname wrap instead of widening the table past the page', () => {
    render(<ExecutionLog report={makeReport({ runs: [makeRun({ hostname: LONG_HOST })] })} head={head} />);
    const cell = within(hostRow(LONG_HOST)).getAllByRole('cell')[1];
    expect(cell).toHaveTextContent(LONG_HOST);
    expect(cell).toHaveClass('rp-id');
    expect(cell).not.toHaveClass('rp-nowrap');
    // The completion date beside it keeps to one line.
    expect(within(hostRow(LONG_HOST)).getAllByRole('cell')[0]).toHaveClass('rp-nowrap');
  });

  it('drops the alert column when no vendor is configured', () => {
    const { container } = render(<ExecutionLog report={makeReport(noEdr())} head={head} />);
    expect(screen.queryByRole('columnheader', { name: 'First alert' })).toBeNull();
    expect(container.textContent).not.toContain('not checked');
    expect(container.textContent).not.toContain('Defender');
  });

  it('flags incomplete correlation above the table', () => {
    render(<ExecutionLog report={makeReport({ meta: { unavailable: ['alerts'] } })} head={head} />);
    expect(screen.getByText(ALERTS_INCOMPLETE)).toBeInTheDocument();
  });
});

describe('RunStrips', () => {
  it('shows each run oldest first with its event list and silent runs flagged', () => {
    render(<RunStrips report={makeReport()} head={head} />);
    expect(screen.getByText('Appendix B · Run timelines')).toBeInTheDocument();
    expect(screen.getByText('SILENT RUN')).toBeInTheDocument();
    // Both fixture runs took 6m 43s from start to completion.
    expect(screen.getAllByText(/Completed after 6m 43s/)).toHaveLength(2);
  });

  it('lists a run\'s events in time order, naming the stage of each alert', () => {
    const { container } = render(<RunStrips report={makeReport({ runs: [makeReport().runs[0]] })} head={head} />);
    const events = Array.from(container.querySelectorAll('.rp-events li')).map((li) => li.textContent);
    expect(events).toEqual([
      '12:41:06Started on WS-FIN-014',
      '12:44:31Defender · high · Suspicious access to LSASS service · S2 Privileged credential access · during run · resolved · blocked',
      '12:47:49Completed after 6m 43s · 3 of 5 stages defended',
      '12:48:51Falcon · high · ProcRansomware · S5 Encryption & recovery inhibition · +1m 02s · new',
    ]);
  });

  it('sorts runs oldest first', () => {
    render(<RunStrips report={makeReport()} head={head} />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => within(h).getByText(/^WS-/).textContent);
    expect(titles).toEqual(['WS-OPS-022', 'WS-FIN-014']);
  });

  it('says completion only when a run has no start time', () => {
    const report = makeReport({ runs: [makeRun({ startedAt: null, alerts: [] })] });
    const { container } = render(<RunStrips report={report} head={head} />);
    const events = Array.from(container.querySelectorAll('.rp-events li')).map((li) => li.textContent);
    expect(events).toEqual(['12:47:49Completed · 3 of 5 stages defended']);
  });

  it('says start times are unavailable when the lookup failed', () => {
    render(<RunStrips report={makeReport({ meta: { unavailable: ['startTimes'] } })} head={head} />);
    expect(screen.getByText('Run start times unavailable; strips show completion only.')).toBeInTheDocument();
  });

  it('stays quiet about start times when they were found', () => {
    render(<RunStrips report={makeReport()} head={head} />);
    expect(screen.queryByText(/Run start times unavailable/)).toBeNull();
  });

  it('marks a run whose alerts were not checked instead of calling it silent', () => {
    const report = makeReport({ runs: silentRuns({ alertsChecked: false }) });
    const { container } = render(<RunStrips report={report} head={head} />);
    expect(screen.queryByText('SILENT RUN')).toBeNull();
    expect(screen.getAllByText('ALERTS NOT CHECKED')).toHaveLength(2);
    expect(container.textContent).toContain('alerts not checked');
  });

  it('flags incomplete correlation', () => {
    render(<RunStrips report={makeReport({ meta: { unavailable: ['alerts'] } })} head={head} />);
    expect(screen.getByText(ALERTS_INCOMPLETE)).toBeInTheDocument();
  });

  it('carries no EDR content when no vendor is configured', () => {
    const { container } = render(<RunStrips report={makeReport({ ...noEdr(), runs: silentRuns({ alertsChecked: false }) })} head={head} />);
    expect(screen.queryByText('SILENT RUN')).toBeNull();
    expect(screen.queryByText('ALERTS NOT CHECKED')).toBeNull();
    expect(container.textContent).not.toMatch(/not checked|EDR alert|Defender|Falcon/i);
  });

  it('prints no alert events for a tenant without EDR even if a run carries alerts', () => {
    const { container } = render(<RunStrips report={makeReport({ runs: [makeRun()], meta: { edrVendors: [] } })} head={head} />);
    const events = Array.from(container.querySelectorAll('.rp-events li')).map((li) => li.textContent);
    expect(events).toHaveLength(2);
  });

  it('names the stage of an alert beyond the fetched stages, and no "bundle" for a standalone test', () => {
    const controls = Array.from({ length: 70 }, (_, i) => ({
      ...makeTest().stages[0], controlId: `CH-DEF-${String(i + 1).padStart(3, '0')}`, name: `Control ${i + 1}`, order: i + 1,
    }));
    const bundle = makeTest({ category: 'cyber-hygiene', stages: controls });
    const [alert] = makeRun().alerts;
    const bundleRun = makeRun({
      stages: controls.slice(0, 60).map((s) => ({ ...makeRun().stages[1], controlId: s.controlId, name: s.name, order: s.order })),
      moreStages: 10,
      alerts: [{ ...alert, stageControlId: 'ch-def-069' }],
    });
    const single = makeTest({ testKey: 'single', isBundle: false, category: 'host-hardening', stages: [{ ...makeTest().stages[0], controlId: null }] });
    const singleRun = makeRun({
      testKey: 'single', hostname: 'WS-OPS-022', taskId: '9e1b7c52-3d84-4a6f-b0c9-5f2a8d71e346',
      stages: [{ ...makeRun().stages[0], controlId: null }], alerts: [{ ...alert, stageControlId: null }],
    });
    const { container } = render(<RunStrips report={makeReport({ tests: [bundle, single], runs: [bundleRun, singleRun] })} head={head} />);
    const events = Array.from(container.querySelectorAll('.rp-events li')).map((li) => li.textContent ?? '');
    expect(events.some((e) => e.includes('S69 Control 69'))).toBe(true);
    expect(container.textContent).not.toContain('bundle');
  });

  it('renders runs whose stages carry no names', () => {
    const { container } = render(<RunStrips report={makeReport({ runs: makeReport().runs.map(nameless) })} head={head} />);
    expect(container.textContent).toContain('S2 Privileged credential access');
    expect(container.textContent).not.toContain('undefined');
  });
});

describe('Method', () => {
  it('defines both metrics', () => {
    render(<Method head={head} />);
    expect(screen.getByText('Defense Score')).toBeInTheDocument();
    expect(screen.getByText('Stage protection rate')).toBeInTheDocument();
  });

  it('names both EDR products as alert sources by default', () => {
    render(<Method head={head} />);
    const sources = screen.getByText('Sources.').closest('p') as HTMLElement;
    expect(sources).toHaveTextContent('Microsoft Defender for Endpoint and CrowdStrike Falcon');
  });

  it('renders an unknown vendor id from a newer backend instead of throwing', () => {
    render(<Method head={head} edrVendors={['defender', 'acmeedr' as never]} />);
    expect(screen.getByText(/acmeedr/)).toBeInTheDocument();
  });

  it('names only the configured EDR vendor as an alert source', () => {
    const { container } = render(<Method head={head} edrVendors={['defender']} />);
    expect(container.textContent).toContain('Microsoft Defender for Endpoint');
    expect(container.textContent).not.toMatch(/CrowdStrike|Falcon/);
    const other = render(<Method head={head} edrVendors={['crowdstrike']} />);
    expect(other.container.textContent).toContain('CrowdStrike Falcon');
    expect(other.container.textContent).not.toContain('Defender for Endpoint');
  });

  it('has no EDR source or alert-window sentence when no vendor is configured', () => {
    const { container } = render(<Method head={head} edrVendors={[]} />);
    const sources = screen.getByText('Sources.').closest('p') as HTMLElement;
    expect(sources).toHaveTextContent('Stage results come from the ProjectAchilles agent.');
    expect(container.textContent).not.toMatch(/CrowdStrike|Falcon|Defender for Endpoint/);
    expect(container.textContent).not.toContain('EDR alerts come from');
    expect(container.textContent).not.toContain('Alerts raised more than 5 minutes');
    // The metric definitions stay.
    expect(screen.getByText('Defense Score')).toBeInTheDocument();
  });

  it('defines every outcome in the report\'s vocabulary', () => {
    render(<Method head={head} />);
    for (const label of ['Protected', 'Prevented', 'Detected', 'Unprotected', 'Inconclusive']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('EDR-killed runs in the appendices', () => {
  const NOTE = 'SentinelOne terminated the Achilles agent while this test was running, so the test could not report which stages ran. The run counts as protected for the test as a whole; stages are unknown.';
  const killed = () => makeRun({
    alerts: [],
    alertsChecked: true,
    agentTerminated: { vendors: ['sentinelone'], alertIds: ['s1-alert-1'] },
  });

  it('the execution log carries the note on the kill row only', () => {
    render(<ExecutionLog report={makeReport({ runs: [killed(), makeRun({ hostname: 'WS-OPS-022', completedAt: '2026-10-11T09:12:00.000Z' })] })} head={head} />);
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
    expect(within(hostRow('WS-FIN-014')).getByText(NOTE)).toBeInTheDocument();
  });

  it('the execution log shows a dash, not a glyph or "1/1", for the unknown stages', () => {
    const one = { ...makeRun().stages[0], controlId: null, order: 1, outcome: 'protected' as const, exitCode: 126 };
    render(<ExecutionLog report={makeReport({ runs: [{ ...killed(), stages: [one] }, makeRun({ hostname: 'WS-OPS-022', completedAt: '2026-10-11T09:12:00.000Z' })] })} head={head} />);
    const cells = hostRow('WS-FIN-014').querySelectorAll('td');
    expect(cells[3].querySelector('svg')).toBeNull();
    expect(cells[3].textContent).toBe(`—${NOTE}`);
    expect(cells[4]).toHaveTextContent(/^—$/);
    // An ordinary run keeps its glyphs and count.
    const other = hostRow('WS-OPS-022').querySelectorAll('td');
    expect(other[3].querySelector('svg')).not.toBeNull();
    expect(other[4].textContent).toMatch(/^\d+\/\d+$/);
  });

  it('the run timeline carries the note, a protected-as-a-whole completion and no silent-run flag', () => {
    const { container } = render(<RunStrips report={makeReport({ runs: [killed()] })} head={head} />);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByText('SILENT RUN')).toBeNull();
    const events = Array.from(container.querySelectorAll('.rp-events li')).map((li) => li.textContent);
    expect(events.some((e) => e?.includes('protected, stages unknown'))).toBe(true);
    expect(events.some((e) => e?.includes('stages defended'))).toBe(false);
  });
});
