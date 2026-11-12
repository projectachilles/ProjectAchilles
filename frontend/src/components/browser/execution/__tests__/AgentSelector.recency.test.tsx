import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentSelector from '../AgentSelector';
import type { AgentSummary } from '@/types/agent';
import type { RunRecencyData } from '@/lib/testRunRecency';

const TEST = '11111111-1111-4111-8111-111111111111';

const agent = (id: string, hostname: string): AgentSummary => ({
  id,
  org_id: 'org-1',
  hostname,
  os: 'windows',
  arch: 'amd64',
  agent_version: '0.7.3',
  status: 'active',
  runtime_status: 'idle',
  last_heartbeat: null,
  tags: [],
  is_online: true,
} as AgentSummary);

const AGENTS = [agent('a-recent', 'host-recent'), agent('a-old', 'host-old'), agent('a-never', 'host-never'), agent('a-queued', 'host-queued')];

// Any test: a-never ran another test 3 days ago; a-recent has another test queued.
const ANY_TEST: RunRecencyData['agents'] = [
  { agent_id: 'a-recent', last_run_at: '2026-11-10T12:00:00Z', queued: true },
  { agent_id: 'a-old', last_run_at: '2026-10-01T12:00:00Z', queued: false },
  { agent_id: 'a-never', last_run_at: '2026-11-08T12:00:00Z', queued: false },
];

const RUNS: RunRecencyData['runs'] = [
  { agent_id: 'a-recent', test_uuid: TEST, last_run_at: '2026-11-10T12:00:00Z', queued: false },
  { agent_id: 'a-old', test_uuid: TEST, last_run_at: '2026-10-01T12:00:00Z', queued: false },
  { agent_id: 'a-queued', test_uuid: TEST, last_run_at: null, queued: true },
];

function renderSelector(props: Partial<Parameters<typeof AgentSelector>[0]> = {}) {
  const onSelectionChange = vi.fn();
  render(
    <AgentSelector
      agents={AGENTS}
      targetAgentIds={[]}
      onSelectionChange={onSelectionChange}
      testUuids={[TEST]}
      recency={{ testUuids: [TEST], runs: RUNS, agents: ANY_TEST }}
      {...props}
    />,
  );
  return onSelectionChange;
}

const hosts = () =>
  screen.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent ?? '').filter((t) => t.startsWith('host-'));

describe('AgentSelector "not run in" filter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('hides the filter and labels without run history', () => {
    renderSelector({ recency: null });
    expect(screen.queryByLabelText(/Not run/)).toBeNull();
    expect(screen.queryByText('never')).toBeNull();
  });

  it('shows each host last run', () => {
    renderSelector();
    expect(hosts()).toEqual([
      expect.stringContaining('1d ago'),
      expect.stringContaining('41d ago'),
      expect.stringContaining('never'),
      expect.stringContaining('queued'),
    ]);
  });

  it('keeps hosts not run within the window, plus never-run ones', () => {
    renderSelector();
    fireEvent.change(screen.getByLabelText('Not run: period'), { target: { value: '30' } });
    expect(hosts().map((h) => h.split(' ')[0])).toEqual(['host-old', 'host-never']);

    fireEvent.change(screen.getByLabelText('Not run: period'), { target: { value: 'never' } });
    expect(hosts().map((h) => h.split(' ')[0])).toEqual(['host-never']);
  });

  it('Select all picks only the filtered hosts', () => {
    const onSelectionChange = renderSelector();
    fireEvent.change(screen.getByLabelText('Not run: period'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('Select all (2)'));
    expect(onSelectionChange).toHaveBeenCalledWith(['a-old', 'a-never']);
  });

  it('"any test" scope judges hosts by their last run of any test', () => {
    renderSelector();
    fireEvent.change(screen.getByLabelText('Not run: which test'), { target: { value: 'any' } });
    expect(hosts()).toEqual([
      expect.stringContaining('queued'),
      expect.stringContaining('41d ago'),
      expect.stringContaining('3d ago'),
      expect.stringContaining('never'),
    ]);

    fireEvent.change(screen.getByLabelText('Not run: period'), { target: { value: '30' } });
    expect(hosts().map((h) => h.split(' ')[0])).toEqual(['host-old', 'host-queued']);

    fireEvent.change(screen.getByLabelText('Not run: period'), { target: { value: 'never' } });
    expect(hosts().map((h) => h.split(' ')[0])).toEqual(['host-queued']);
  });

  it('keeps no host under "this test" while the history on hand is for another selection', () => {
    // History fetched before a test was picked: runs is empty, so every host would read "never".
    const onSelectionChange = renderSelector({ recency: { testUuids: [], runs: [], agents: ANY_TEST } });
    expect(screen.queryByText('never')).toBeNull();

    fireEvent.change(screen.getByLabelText('Not run: period'), { target: { value: 'never' } });
    expect(hosts()).toEqual([]);
    expect(screen.getByText('Loading run history...')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Select all (0)'));
    expect(onSelectionChange).toHaveBeenCalledWith([]);

    // "any test" does not depend on the selection, so it still answers.
    fireEvent.change(screen.getByLabelText('Not run: which test'), { target: { value: 'any' } });
    expect(hosts().map((h) => h.split(' ')[0])).toEqual(['host-queued']);
  });

  it('offers only "any test" until a test is picked', () => {
    renderSelector({ testUuids: [] });
    const scope = screen.getByLabelText('Not run: which test') as HTMLSelectElement;
    expect(scope.value).toBe('any');
    expect((screen.getByText('this test (pick a test first)') as HTMLOptionElement).disabled).toBe(true);
    expect(hosts()[2]).toContain('3d ago');
  });
});
