import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentSelector from '../AgentSelector';
import type { AgentSummary } from '@/types/agent';
import type { TestRunRecency } from '@/lib/testRunRecency';

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

const RUNS: TestRunRecency[] = [
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
      recencyRuns={RUNS}
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
    renderSelector({ recencyRuns: null });
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
    fireEvent.change(screen.getByLabelText('Not run this test in'), { target: { value: '30' } });
    expect(hosts().map((h) => h.split(' ')[0])).toEqual(['host-old', 'host-never']);

    fireEvent.change(screen.getByLabelText('Not run this test in'), { target: { value: 'never' } });
    expect(hosts().map((h) => h.split(' ')[0])).toEqual(['host-never']);
  });

  it('Select all picks only the filtered hosts', () => {
    const onSelectionChange = renderSelector();
    fireEvent.change(screen.getByLabelText('Not run this test in'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('Select all (2)'));
    expect(onSelectionChange).toHaveBeenCalledWith(['a-old', 'a-never']);
  });
});
