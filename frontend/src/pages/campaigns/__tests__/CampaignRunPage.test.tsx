import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({ getRun: vi.fn(), exportRunCsv: vi.fn() }));
vi.mock('@/services/api/campaigns', () => ({ campaignsApi: api }));

import type { RunMatrix, CellState, CellVersion, RunNotice } from '@/services/api/campaigns';
import CampaignRunPage from '../CampaignRunPage';

const cell = (state: CellState, reason: string | null = null, stages: RunMatrix['cells'][string][string]['stages'] = []) =>
  ({ state, exit_code: null, task_id: 'x', completed_at: null, reason, techniques: [], edr: null, stages, stages_text: '' });

const SENT_AT = '2026-10-23T09:55:00.000Z';
const sentNotice: RunNotice = {
  id: 'n', run_tag: 'PA-RUN-1234', state: 'sent', last_error: null, release_at: null, pickup_deadline: null,
  sent_at: SENT_AT, recipients: ['a@x.com', 'b@y.com'], override_by: null, override_reason: null, override_at: null,
};

function matrix(states: CellState[], pct: number | null = 50, notice: RunNotice | null = sentNotice): RunMatrix {
  const agents = states.map((_, i) => ({ id: `a${i}`, hostname: `host${i}`, os: 'windows' }));
  const row: Record<string, ReturnType<typeof cell>> = {};
  states.forEach((s, i) => { row[`a${i}`] = cell(s, s === 'na' || s === 'not_run' ? 'no windows binary' : null); });
  const totals = { waiting_for_notice: 0, running: 0, protected: 0, prevented: 0, detected: 0, unprotected: 0, error: 0, not_run: 0, na: 0 } as RunMatrix['totals'];
  states.forEach((s) => { totals[s]++; });
  totals.percent_protected = pct;
  return {
    run: { id: 'r1', campaign_id: 'c1', campaign_name: 'CIS Baseline', framework_label: 'CIS v8', started_by: 'user_abc',
      started_by_name: 'Jane Doe', started_at: '2026-10-23T10:00:00.000Z', notice },
    edr: { status: 'ok', sources: ['Microsoft Defender'] },
    tests: [{ uuid: 't1', name: 'Test One' }], agents, cells: { t1: row }, totals, as_of: '2026-10-23T10:05:00.000Z',
  };
}

function setup() {
  return render(
    <MemoryRouter initialEntries={['/tasks/campaigns/runs/r1']}>
      <Routes><Route path="/tasks/campaigns/runs/:runId" element={<CampaignRunPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('CampaignRunPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders header and a label for every state, with reasons as titles', async () => {
    const states: CellState[] = ['waiting_for_notice', 'running', 'protected', 'prevented', 'detected', 'unprotected', 'error', 'not_run', 'na'];
    api.getRun.mockResolvedValue(matrix(states));
    const { container } = setup();
    await screen.findByRole('table');
    for (const s of states) {
      const td = container.querySelector(`td[data-state="${s}"]`)!;
      expect(td).toHaveTextContent(
        { waiting_for_notice: 'Waiting for notice', running: 'Running', protected: 'Protected', prevented: 'Prevented', detected: 'Detected',
          unprotected: 'Unprotected', error: 'Error', not_run: 'Not run', na: 'N/A' }[s],
      );
    }
    expect(container.querySelector('td[data-state="na"]')).toHaveAttribute('title', 'no windows binary');
    expect(container.querySelector('td[data-state="not_run"]')).toHaveAttribute('title', 'no windows binary');
    expect(screen.getByText('CIS Baseline')).toBeInTheDocument();
    expect(screen.getByText('CIS v8')).toBeInTheDocument();
    expect(screen.getByText(/PA-RUN-1234/)).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText(/user_abc/)).not.toBeInTheDocument();
    expect(screen.getByText(/As of/)).toBeInTheDocument();
  });

  it('shows — when percent protected is null', async () => {
    api.getRun.mockResolvedValue(matrix(['error'], null));
    setup();
    expect(await screen.findByTestId('percent-protected')).toHaveTextContent('—');
  });

  it('shows percent protected and progress', async () => {
    api.getRun.mockResolvedValue(matrix(['protected', 'running', 'na'], 80));
    setup();
    expect(await screen.findByTestId('percent-protected')).toHaveTextContent('80%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('polls every 15s while unsettled and stops once settled', async () => {
    vi.useFakeTimers();
    api.getRun
      .mockResolvedValueOnce(matrix(['running']))
      .mockResolvedValueOnce(matrix(['protected']));
    setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.getRun).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(api.getRun).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(api.getRun).toHaveBeenCalledTimes(2);
  });

  it('stops polling on unmount', async () => {
    vi.useFakeTimers();
    api.getRun.mockResolvedValue(matrix(['running']));
    const { unmount } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(api.getRun).toHaveBeenCalledTimes(1);
  });

  it('prints and downloads the CSV via a blob', async () => {
    api.getRun.mockResolvedValue(matrix(['protected']));
    api.exportRunCsv.mockResolvedValue({ blob: new Blob(['a,b']), filename: 'campaign-run-r1-20261023T1005Z.csv' });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const createUrl = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    setup();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Print/ }));
    expect(print).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Download CSV/ }));
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.exportRunCsv).toHaveBeenCalledWith('r1');
    expect(createUrl).toHaveBeenCalled();
    expect(click.mock.instances[0]).toHaveProperty('download', 'campaign-run-r1-20261023T1005Z.csv');
  });
  it('notice record: sent shows run tag, local sent time and recipients', async () => {
    api.getRun.mockResolvedValue(matrix(['protected']));
    setup();
    const rec = await screen.findByTestId('notice-record');
    expect(rec).toHaveTextContent(
      `Notice PA-RUN-1234 sent ${new Date(SENT_AT).toLocaleString()} to a@x.com, b@y.com`,
    );
  });

  it('notice record: overridden shows who released it, when and why', async () => {
    const at = '2026-10-23T09:58:00.000Z';
    api.getRun.mockResolvedValue(matrix(['protected'], 50, {
      ...sentNotice, state: 'overridden', sent_at: null, recipients: [],
      override_by: 'admin@corp.com', override_reason: 'CAB-123 approved', override_at: at,
    }));
    setup();
    const rec = await screen.findByTestId('notice-record');
    expect(rec).toHaveTextContent(
      `Notice PA-RUN-1234 released without notice by admin@corp.com at ${new Date(at).toLocaleString()}: CAB-123 approved`,
    );
  });

  it('notice record: none says notices were off', async () => {
    api.getRun.mockResolvedValue(matrix(['protected'], 50, null));
    setup();
    expect(await screen.findByTestId('notice-record')).toHaveTextContent('No pre-execution notice (notices off)');
  });

  it('notice record and started-by name are in the printed area', async () => {
    api.getRun.mockResolvedValue(matrix(['protected']));
    const { container } = setup();
    const rec = await screen.findByTestId('notice-record');
    const printArea = container.querySelector('.campaign-run-print')!;
    expect(printArea).toContainElement(rec);
    expect(printArea).toContainElement(screen.getByText('Jane Doe'));
    expect(rec.closest('.print\\:hidden')).toBeNull();
  });

  it('puts the longer list down the side: hosts as rows when there are more hosts than tests', async () => {
    api.getRun.mockResolvedValue(matrix(['protected', 'unprotected', 'error']));
    setup();
    const table = await screen.findByRole('table');
    const header = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(header[0]).toBe('Host');
    expect(header).toContain('Test One');
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(
      ['host0windows', 'host1windows', 'host2windows', 'Protected'],
    );
  });

  it('keeps tests as rows when there are at least as many tests as hosts', async () => {
    const m = matrix(['protected']);
    m.tests = [{ uuid: 't1', name: 'Test One' }, { uuid: 't2', name: 'Test Two' }];
    m.cells.t2 = { a0: cell('unprotected') };
    api.getRun.mockResolvedValue(m);
    setup();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent('Test');
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Test One', 'Test Two', 'Protected']);
  });

  it('per-host and per-test totals count Prevented and Detected as protected', async () => {
    api.getRun.mockResolvedValue(matrix(['prevented', 'detected', 'unprotected', 'error'], 75));
    setup();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    // host rows: prevented 1/1, detected 1/1, unprotected 0/1, error —
    expect(rows.slice(1, 5).map((r) => r.lastElementChild?.textContent)).toEqual(['1/1', '1/1', '0/1', '—']);
    // footer: the test column 2/3, then the run percentage
    const foot = rows[rows.length - 1];
    expect(within(foot).getByText('2/3')).toBeInTheDocument();
    expect(within(foot).getByText('75%')).toBeInTheDocument();
  });

  it('cell title carries the reason and each stage', async () => {
    const m = matrix(['prevented']);
    m.cells.t1.a0 = cell('prevented', 'Defender prevented it (process killed) during stage 1 (T1105).', [
      { label: 'Stage 1 (T1105)', exit_code: 101, outcome: 'prevented' },
      { label: 'Stage 2 (T1572)', exit_code: 999, outcome: 'inconclusive' },
      { label: 'Stage 3 (T1005)', exit_code: 0, outcome: 'skipped' },
    ]);
    api.getRun.mockResolvedValue(m);
    const { container } = setup();
    await screen.findByRole('table');
    expect(container.querySelector('td[data-state="prevented"]')).toHaveAttribute('title',
      'Defender prevented it (process killed) during stage 1 (T1105).\nStage 1 (T1105): 101\nStage 2 (T1572): 999\nStage 3 (T1005): skipped');
  });

  it('says which EDR the outcomes reflect, and warns when EDR results are unavailable', async () => {
    api.getRun.mockResolvedValueOnce(matrix(['protected']));
    const { unmount } = setup();
    expect(await screen.findByTestId('edr-line')).toHaveTextContent('EDR results from Microsoft Defender');
    unmount();
    const m = matrix(['protected']);
    m.edr = { status: 'unavailable', sources: ['Microsoft Defender'] };
    api.getRun.mockResolvedValueOnce(m);
    setup();
    expect(await screen.findByTestId('edr-line')).toHaveTextContent('EDR results unavailable: outcomes use test exit codes only');
  });

  it('prints in blocks of 12 columns when the matrix is wider than a page', async () => {
    const m = matrix(['protected']);
    m.tests = Array.from({ length: 30 }, (_, i) => ({ uuid: `t${i}`, name: `Test ${i}` }));
    m.agents = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, hostname: `host${i}`, os: 'windows' }));
    m.cells = Object.fromEntries(m.tests.map((t) => [t.uuid, Object.fromEntries(m.agents.map((a) => [a.id, cell('protected')]))]));
    api.getRun.mockResolvedValue(m);
    setup();
    const blocks = await screen.findByTestId('print-blocks');
    // 40 hosts as rows, 30 tests as columns -> 12 + 12 + 6
    const tables = within(blocks).getAllByRole('table');
    expect(tables).toHaveLength(3);
    expect(tables.map((t) => within(t).getAllByRole('columnheader').length - 2)).toEqual([12, 12, 6]);
    expect(blocks.children[1]).toHaveClass('break-before-page');
  });

  it('adds a landscape @page rule while mounted and removes it on unmount', async () => {
    api.getRun.mockResolvedValue(matrix(['protected']));
    const { unmount } = setup();
    await screen.findByRole('table');
    expect(document.head.querySelector('style[data-campaign-print]')?.textContent).toContain('size: landscape');
    unmount();
    expect(document.head.querySelector('style[data-campaign-print]')).toBeNull();
  });

  describe('test version', () => {
    const COMMIT_A = 'abc1234' + 'f'.repeat(33);
    const COMMIT_B = 'def5678' + 'e'.repeat(33);
    const current: CellVersion = { commit: COMMIT_A, fingerprint: 'fp-a', state: 'current' };
    const older: CellVersion = { commit: COMMIT_B, fingerprint: 'fp-b', state: 'older' };

    /** One test on N hosts (hosts as rows, so the test is a column header), cell i carrying versions[i]. */
    function versioned(versions: (CellVersion | undefined)[]): RunMatrix {
      const m = matrix(versions.map(() => 'protected'));
      versions.forEach((v, i) => { if (v) m.cells.t1[`a${i}`] = { ...m.cells.t1[`a${i}`], version: v }; });
      return m;
    }
    const testHeader = async () => {
      const table = await screen.findByRole('table');
      return within(table).getAllByRole('columnheader').find((h) => h.textContent?.startsWith('Test One'))!;
    };

    it('shows the 7-character commit under the test name, with the full commit and state in the title', async () => {
      api.getRun.mockResolvedValue(versioned([current, current, current]));
      setup();
      const th = await testHeader();
      expect(within(th).getByTestId('test-version')).toHaveTextContent('abc1234 · current');
      expect(th.getAttribute('title')).toContain(COMMIT_A);
      expect(th.getAttribute('title')).toContain('current');
    });

    it('shows the version under a test that is a row header too', async () => {
      const m = matrix(['protected']);
      m.tests = [{ uuid: 't1', name: 'Test One' }, { uuid: 't2', name: 'Test Two' }];
      m.cells.t1.a0 = { ...m.cells.t1.a0, version: current };
      m.cells.t2 = { a0: { ...cell('unprotected'), version: older } };
      api.getRun.mockResolvedValue(m);
      setup();
      const table = await screen.findByRole('table');
      const rowHeaders = within(table).getAllByRole('rowheader');
      expect(within(rowHeaders[0]).getByTestId('test-version')).toHaveTextContent('abc1234 · current');
      expect(within(rowHeaders[1]).getByTestId('test-version')).toHaveTextContent('def5678 · older');
      expect(rowHeaders[1].getAttribute('title')).toContain(COMMIT_B);
    });

    it('says mixed versions when the hosts ran different versions, and lists them with host counts', async () => {
      api.getRun.mockResolvedValue(versioned([current, older, current]));
      setup();
      const th = await testHeader();
      expect(within(th).getByTestId('test-version')).toHaveTextContent('mixed versions');
      expect(th.getAttribute('title')).toContain(`${COMMIT_A} · current: 2 hosts`);
      expect(th.getAttribute('title')).toContain(`${COMMIT_B} · older: 1 host`);
    });

    it('not recorded, and a custom test shows its state without a commit', async () => {
      const notRecorded: CellVersion = { commit: null, fingerprint: null, state: 'not_recorded' };
      api.getRun.mockResolvedValueOnce(versioned([notRecorded, notRecorded]));
      const { unmount } = setup();
      expect(within(await testHeader()).getByTestId('test-version')).toHaveTextContent(/^not recorded$/);
      unmount();
      api.getRun.mockResolvedValueOnce(versioned([{ commit: null, fingerprint: 'fp-c', state: 'unknown' }, { commit: null, fingerprint: 'fp-c', state: 'unknown' }]));
      setup();
      expect(within(await testHeader()).getByTestId('test-version')).toHaveTextContent(/^version unknown$/);
    });

    const NOT_COMPARED = 'Version states could not be compared with the test library when this page was generated.';

    it('without states (library unreadable) shows the commit, no state text, and says the states could not be compared', async () => {
      api.getRun.mockResolvedValue(versioned([{ commit: COMMIT_A, fingerprint: 'fp-a' }, { commit: COMMIT_A, fingerprint: 'fp-a' }]));
      const { container } = setup();
      const th = await testHeader();
      expect(within(th).getByTestId('test-version')).toHaveTextContent(/^abc1234$/);
      const basis = screen.getByTestId('version-basis');
      expect(basis).toHaveTextContent(NOT_COMPARED);
      expect(basis.textContent).not.toMatch(/compare each test/);
      // Printed too: inside the printed area, never print-hidden.
      expect(container.querySelector('.campaign-run-print')).toContainElement(basis);
      expect(basis.closest('.print\\:hidden')).toBeNull();
    });

    it('a matrix wider than a page, without states, prints the could-not-compare sentence', async () => {
      const m = matrix(['protected']);
      m.tests = Array.from({ length: 30 }, (_, i) => ({ uuid: `t${i}`, name: `Test ${i}` }));
      m.agents = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, hostname: `host${i}`, os: 'windows' }));
      m.cells = Object.fromEntries(m.tests.map((t, ti) => [t.uuid, Object.fromEntries(m.agents.map((a) => [
        a.id, { ...cell('protected'), version: ti % 2 === 0 ? { commit: COMMIT_A, fingerprint: 'fp-a' } : { commit: null, fingerprint: null, state: 'not_recorded' } },
      ]))]));
      api.getRun.mockResolvedValue(m);
      const { container } = setup();
      const blocks = await screen.findByTestId('print-blocks');
      expect(within(blocks).getAllByTestId('test-version')[0]).toHaveTextContent(/^abc1234$/);
      const basis = screen.getByTestId('version-basis');
      expect(basis).toHaveTextContent(NOT_COMPARED);
      expect(container.querySelector('.campaign-run-print')).toContainElement(basis);
      expect(basis.closest('.print\\:hidden')).toBeNull();
    });

    it('all not recorded: no version sentence', async () => {
      const notRecorded: CellVersion = { commit: null, fingerprint: null, state: 'not_recorded' };
      api.getRun.mockResolvedValue(versioned([notRecorded, notRecorded]));
      setup();
      expect(within(await testHeader()).getByTestId('test-version')).toHaveTextContent(/^not recorded$/);
      expect(screen.queryByTestId('version-basis')).toBeNull();
    });

    it('a matrix from a server without versions renders exactly as before', async () => {
      api.getRun.mockResolvedValue(matrix(['protected', 'unprotected', 'error']));
      const { container } = setup();
      const th = await testHeader();
      expect(th).toHaveAttribute('title', 'Test One');
      expect(th).toHaveTextContent(/^Test One$/);
      expect(screen.queryByTestId('test-version')).toBeNull();
      expect(screen.queryByTestId('version-basis')).toBeNull();
      expect(container.textContent).not.toMatch(/version|not recorded/i);
    });

    it('prints a version line per test and says what the states compare with, as of the matrix time', async () => {
      const m = matrix(['protected']);
      m.tests = Array.from({ length: 30 }, (_, i) => ({ uuid: `t${i}`, name: `Test ${i}` }));
      m.agents = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, hostname: `host${i}`, os: 'windows' }));
      m.cells = Object.fromEntries(m.tests.map((t, ti) => [t.uuid, Object.fromEntries(m.agents.map((a) => [
        a.id, { ...cell('protected'), version: ti % 2 === 0 ? current : older },
      ]))]));
      api.getRun.mockResolvedValue(m);
      const { container } = setup();
      const blocks = await screen.findByTestId('print-blocks');
      const lines = within(blocks).getAllByTestId('test-version');
      expect(lines).toHaveLength(30);
      expect(lines[0]).toHaveTextContent('abc1234 · current');
      expect(lines[1]).toHaveTextContent('def5678 · older');
      const basis = screen.getByTestId('version-basis');
      expect(basis).toHaveTextContent(
        `Version states compare each test with the synced test library as of ${new Date(m.as_of).toLocaleString()}.`,
      );
      expect(container.querySelector('.campaign-run-print')).toContainElement(basis);
      expect(basis.closest('.print\\:hidden')).toBeNull();
    });
  });
});
