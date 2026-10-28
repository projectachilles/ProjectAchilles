import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTask, TaskGroup } from '@/types/agent';

const copyText = vi.hoisted(() => vi.fn());
vi.mock('@/lib/clipboard', () => ({ copyText }));

import TaskStream from '../TaskStream';

const STDOUT = '[stage 1] starting\n[stage 2] blocked by EDR\n'.repeat(40);

const task: AgentTask = {
  id: 'task-1',
  agent_id: 'agent-1',
  agent_hostname: 'host-1',
  type: 'execute_test',
  priority: 5,
  status: 'completed',
  payload: { test_uuid: 'uuid-1', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 },
  result: {
    exit_code: 126,
    stdout: STDOUT,
    stderr: '',
    execution_duration_ms: 1200,
    started_at: '2026-10-28T12:00:30Z',
    completed_at: '2026-10-28T12:01:00Z',
    hostname: 'host-1',
  },
  notes: null,
  notes_history: [],
  created_at: '2026-10-28 12:00:00',
  assigned_at: null,
  completed_at: '2026-10-28 12:01:00',
  batch_id: 'batch-0001',
};
const group: TaskGroup = {
  batch_id: task.batch_id,
  type: task.type,
  payload: task.payload,
  created_at: task.created_at,
  created_by: 'user-1',
  agent_count: 1,
  status_counts: { completed: 1 },
  tasks: [task],
};

describe('TaskStream output copy', () => {
  beforeEach(() => copyText.mockReset().mockResolvedValue(true));

  it('copies the whole stdout without opening the expanded viewer', async () => {
    const user = userEvent.setup();
    render(<TaskStream groups={[group]} loading={false} />);
    await user.click(screen.getByRole('button', { name: 'Copy stdout' }));
    expect(copyText).toHaveBeenCalledWith(STDOUT);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('disables copy for an empty stream', () => {
    render(<TaskStream groups={[group]} loading={false} />);
    expect((screen.getByRole('button', { name: 'Copy stderr' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers Copy all in the expanded viewer', async () => {
    const user = userEvent.setup();
    render(<TaskStream groups={[group]} loading={false} />);
    await user.click(screen.getAllByTitle('Click to expand')[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Copy all stdout' }));
    expect(copyText).toHaveBeenCalledWith(STDOUT);
  });
});
