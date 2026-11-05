import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AgentMetrics, Schedule } from '@/types/agent';

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    listTasksGrouped: vi.fn(),
    listSchedules: vi.fn(),
    getMetrics: vi.fn(),
  },
}));
vi.mock('@/hooks/useAppRole', () => ({ useHasPermission: () => false }));
vi.mock('@/hooks/usePolling', () => ({ usePolling: () => {} }));
vi.mock('@/components/endpoints/tasks/TaskStream', () => ({ default: ({ footer }: { footer?: React.ReactNode }) => <div data-testid="task-stream">{footer}</div> }));
vi.mock('@/components/endpoints/tasks/ScheduleList', () => ({ default: () => <div data-testid="schedule-list" /> }));

import { agentApi } from '@/services/api/agent';
import TasksPage from '../TasksPage';

const metrics = {
  total: 0, online: 0, offline: 0, by_os: {}, by_status: {}, pending_tasks: 0,
  task_activity_24h: { completed: 0, failed: 0, total: 0, success_rate: 0, in_progress: 0 },
  by_version: {},
  task_outcomes_7d: {
    tests: { protected: 38, edr_stopped: 0, unprotected: 36, not_run: 6, run_failed: 10, test_error: 0, inconclusive: 0 },
    other: { total: 0, failed: 0 },
    breakdown: [
      { key: 'exit:126', outcome: 'protected', code: 126, name: 'Quarantined', count: 38 },
      { key: 'failed:offline', outcome: 'not-run', code: null, name: 'Agent offline', count: 6 },
      { key: 'exit:1', outcome: 'run-failed', code: 1, name: 'Run failed', count: 10 },
    ],
  },
} as unknown as AgentMetrics;

const schedule = { id: 's1' } as Schedule;
const list = vi.mocked(agentApi.listTasksGrouped);

function setup(schedules: Schedule[] = [schedule]) {
  list.mockResolvedValue({ groups: [], total: 0, typeCounts: {} });
  vi.mocked(agentApi.listSchedules).mockResolvedValue(schedules);
  vi.mocked(agentApi.getMetrics).mockResolvedValue(metrics);
  return render(<MemoryRouter><TasksPage /></MemoryRouter>);
}

async function chooseOffline(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Show breakdown of 16 no verdict' }));
  await user.click(await screen.findByText('Agent offline'));
}

describe('TasksPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the stat line in the header', async () => {
    setup();
    expect(await screen.findByText('16')).toBeInTheDocument();
    expect(screen.getByText('no verdict')).toBeInTheDocument();
    expect(screen.queryByText(/Scheduled Tasks \(/)).toBeNull();
  });

  it('filters by a breakdown row and shows a chip', async () => {
    const user = userEvent.setup();
    setup();
    await chooseOffline(user);
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ breakdown: 'failed:offline', types: ['execute_test'], offset: 0 }),
      ),
    );
    expect(await screen.findByText('No verdict › Agent offline · last 7 days')).toBeInTheDocument();
  });

  it('clears the filter with the chip x', async () => {
    const user = userEvent.setup();
    setup();
    await chooseOffline(user);
    await user.click(await screen.findByRole('button', { name: 'Clear breakdown filter' }));
    await waitFor(() => expect(list.mock.lastCall?.[0]).not.toHaveProperty('breakdown'));
    expect(screen.queryByText('No verdict › Agent offline · last 7 days')).toBeNull();
  });

  it('clears the filter when another type pill is chosen', async () => {
    const user = userEvent.setup();
    setup();
    await chooseOffline(user);
    await screen.findByText('No verdict › Agent offline · last 7 days');
    await user.click(screen.getByRole('tab', { name: /Commands/ }));
    await waitFor(() => expect(list.mock.lastCall?.[0]).not.toHaveProperty('breakdown'));
    expect(screen.queryByText('No verdict › Agent offline · last 7 days')).toBeNull();
  });

  it('Schedules pill swaps in the schedule list and hides search', async () => {
    const user = userEvent.setup();
    setup();
    expect(await screen.findByPlaceholderText('Search tasks...')).toBeInTheDocument();
    await user.click(await screen.findByRole('tab', { name: /Schedules/ }));
    expect(screen.getByTestId('schedule-list')).toBeInTheDocument();
    expect(screen.queryByTestId('task-stream')).toBeNull();
    expect(screen.queryByPlaceholderText('Search tasks...')).toBeNull();
  });

  it('has no Schedules pill without schedules', async () => {
    setup([]);
    await screen.findByText('16');
    expect(screen.queryByRole('tab', { name: /Schedules/ })).toBeNull();
  });

  it('falls back to the last page when the total shrinks under the current page', async () => {
    const user = userEvent.setup();
    setup();
    list.mockResolvedValue({ groups: [], total: 60, typeCounts: {} });
    await user.click(await screen.findByRole('button', { name: /Refresh/ }));
    await user.click(await screen.findByRole('button', { name: /Older/ }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 })));
    list.mockResolvedValue({ groups: [], total: 20, typeCounts: {} });
    await user.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 })));
    expect(await screen.findByText('1 / 1')).toBeInTheDocument();
  });

  it('drops the breakdown filter and says so when the filtered fetch fails', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(list).toHaveBeenCalled());
    list.mockImplementation(async (f) => {
      if (f && 'breakdown' in f) throw new Error('boom');
      return { groups: [], total: 0, typeCounts: {} };
    });
    await chooseOffline(user);
    expect(await screen.findByText("Couldn't filter the task list.")).toBeInTheDocument();
    expect(screen.queryByText('No verdict › Agent offline · last 7 days')).toBeNull();
    await waitFor(() => expect(list.mock.lastCall?.[0]).not.toHaveProperty('breakdown'));
  });
});
