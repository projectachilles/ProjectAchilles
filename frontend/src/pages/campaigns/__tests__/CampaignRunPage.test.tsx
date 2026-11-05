import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({ getRun: vi.fn(), exportRunCsv: vi.fn() }));
vi.mock('@/services/api/campaigns', () => ({ campaignsApi: api }));

import type { RunMatrix, CellState, RunNotice } from '@/services/api/campaigns';
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
});
