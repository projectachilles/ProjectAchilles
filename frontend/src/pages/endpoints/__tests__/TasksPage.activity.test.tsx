import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AgentMetrics, TaskActivityResponse } from '@/types/agent';

// The activity strip on the Tasks page: a day selected on it narrows the list.

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    listTasksGrouped: vi.fn(),
    listSchedules: vi.fn(),
    getMetrics: vi.fn(),
    getTaskActivity: vi.fn(),
  },
}));
vi.mock('@/hooks/useAppRole', () => ({ useHasPermission: () => false }));
const polls = vi.hoisted(() => new Map<number, () => void | Promise<void>>());
vi.mock('@/hooks/usePolling', () => ({
  usePolling: (callback: () => void | Promise<void>, intervalMs: number) => { polls.set(intervalMs, callback); },
}));
const caps = vi.hoisted(() => ({ value: { campaigns: true, activityStrip: true } as Record<string, boolean> }));
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => caps.value }));
vi.mock('@/components/endpoints/tasks/TaskStream', () => ({
  default: ({ footer, groups }: { footer?: React.ReactNode; groups: unknown[] }) => (
    <div data-testid="task-stream" data-groups={groups.length}>{footer}</div>
  ),
}));
vi.mock('@/components/endpoints/tasks/ScheduleList', () => ({ default: () => <div data-testid="schedule-list" /> }));

import { agentApi } from '@/services/api/agent';
import TasksPage from '../TasksPage';

const metrics = {
  total: 0, online: 0, offline: 0, by_os: {}, by_status: {}, pending_tasks: 0,
  task_activity_24h: { completed: 0, failed: 0, total: 0, success_rate: 0, in_progress: 0 },
  by_version: {},
  task_outcomes_7d: { tests: { protected: 0, edr_stopped: 0, unprotected: 0, not_run: 0, run_failed: 0, test_error: 0, inconclusive: 0 }, other: { total: 0, failed: 0 } },
} as unknown as AgentMetrics;

const DAY = 86_400_000;
const START = Date.parse('2026-11-10T00:00:00.000Z');
const ACTIVITY: TaskActivityResponse = {
  interval: 'day',
  timeZone: 'UTC',
  buckets: Array.from({ length: 14 }, (_, i) => ({
    from: new Date(START + i * DAY).toISOString(),
    to: new Date(START + (i + 1) * DAY - 1).toISOString(),
    unprotected: i === 6 ? 2 : 0, failed: 0, noVerdict: 0, inProgress: 0, protected: [1, 3, 6, 8].includes(i) ? 4 : 0, completed: 0,
  })),
};
const NOV16 = ACTIVITY.buckets[6];

const list = vi.mocked(agentApi.listTasksGrouped);
const activity = vi.mocked(agentApi.getTaskActivity);
const lastList = () => list.mock.calls[list.mock.calls.length - 1][0]!;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/endpoints/tasks']}>
      <Routes><Route path="/endpoints/tasks" element={<TasksPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  polls.clear();
  caps.value = { campaigns: true, activityStrip: true };
  list.mockResolvedValue({ groups: [], total: 0, typeCounts: {} });
  vi.mocked(agentApi.listSchedules).mockResolvedValue([]);
  vi.mocked(agentApi.getMetrics).mockResolvedValue(metrics);
  activity.mockResolvedValue(ACTIVITY);
});

describe('the Tasks activity strip', () => {
  it('asks once, for the selected type pill, and draws the bars above the list', async () => {
    renderPage();
    const bar = await screen.findByRole('button', { name: 'Nov 16: 6 tasks, 2 unprotected, 4 protected' });

    expect(activity).toHaveBeenCalledTimes(1);
    expect(activity.mock.calls[0][0]).toEqual({ types: ['execute_test'], search: '' });
    expect(bar.compareDocumentPosition(screen.getByTestId('task-stream')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks nothing and draws nothing where the server has no strip', async () => {
    caps.value = { campaigns: true };
    renderPage();
    await screen.findByTestId('task-stream');
    await new Promise((r) => setTimeout(r, 20));

    expect(activity).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Tasks over time' })).toBeNull();
  });

  it('a click on a bar narrows the list to that day, from its first page', async () => {
    const user = userEvent.setup();
    renderPage();
    const bar = await screen.findByRole('button', { name: /^Nov 16/ });
    list.mockClear();

    await user.click(bar);

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(lastList()).toMatchObject({ from: NOV16.from, to: NOV16.to, offset: 0 });
    expect(screen.getByRole('button', { name: /^Nov 16/ })).toHaveAttribute('aria-pressed', 'true');
    // The strip keeps its 30 days.
    expect(activity).toHaveBeenCalledTimes(1);
  });

  it('goes back to the first page when a day is selected from a later one', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue({ groups: [], total: 100, typeCounts: {} });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Older/ }));
    await waitFor(() => expect(lastList()).toMatchObject({ offset: 25 }));
    list.mockClear();

    await user.click(await screen.findByRole('button', { name: /^Nov 16/ }));

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(lastList()).toMatchObject({ from: NOV16.from, offset: 0 });
    expect(list.mock.calls.some((c) => c[0]!.from === NOV16.from && c[0]!.offset === 25)).toBe(false);
  });

  it('keeps the day in the 10-second refresh of the list, which never asks for the strip', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^Nov 16/ }));
    await waitFor(() => expect(lastList()).toMatchObject({ from: NOV16.from }));
    list.mockClear();

    await act(async () => { await polls.get(10_000)!(); });

    expect(lastList()).toMatchObject({ from: NOV16.from, to: NOV16.to });
    expect(activity).toHaveBeenCalledTimes(1);
  });

  it('clearing the day lists every day again', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^Nov 16/ }));
    await waitFor(() => expect(lastList()).toMatchObject({ from: NOV16.from }));

    await user.click(screen.getByRole('button', { name: 'Clear the selected Nov 16' }));

    await waitFor(() => expect(lastList()).not.toHaveProperty('from'));
    expect(lastList()).not.toHaveProperty('to');
  });

  it('asks again for another type pill, but not for a status', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: /^Nov 16/ });

    await user.selectOptions(screen.getByRole('combobox'), 'completed');
    await waitFor(() => expect(lastList()).toMatchObject({ status: 'completed' }));
    expect(activity).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The status filter narrows the list, not the bars.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Commands/ }));
    await waitFor(() => expect(activity).toHaveBeenCalledTimes(2));
    expect(activity.mock.calls[1][0]).toEqual({ types: ['execute_command'], search: '' });
  });

  it('asks again on Refresh', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: /^Nov 16/ });

    await user.click(screen.getByRole('button', { name: /Refresh/ }));

    await waitFor(() => expect(activity).toHaveBeenCalledTimes(2));
  });
});
