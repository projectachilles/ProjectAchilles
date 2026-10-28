import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TaskStream from '../TaskStream';
import type { AgentTask, TaskGroup } from '@/types/agent';

function testTask(id: string, exit_code: number, status: AgentTask['status'] = 'completed'): AgentTask {
  return {
    id,
    agent_id: `agent-${id}`,
    agent_hostname: `HOST-${id}`,
    type: 'execute_test',
    priority: 5,
    status,
    payload: { test_uuid: 'u', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 },
    result: {
      exit_code, stdout: '', stderr: '', execution_duration_ms: 700,
      started_at: '2026-10-28T12:00:00Z', completed_at: '2026-10-28T12:01:00Z', hostname: `HOST-${id}`,
      ...(exit_code === -1 ? { error: 'Agent went offline during execution' } : {}),
    },
    notes: null,
    notes_history: [],
    created_at: '2026-10-28 12:00:00',
    assigned_at: null,
    completed_at: '2026-10-28 12:01:00',
    batch_id: 'batch-1',
  };
}

const tasks = [testTask('a', 126), testTask('b', -1, 'failed'), testTask('c', 999), testTask('d', 260)];
const group: TaskGroup = {
  batch_id: 'batch-1', type: 'execute_test', payload: tasks[0].payload, created_at: tasks[0].created_at,
  created_by: 'u', agent_count: 4, status_counts: { completed: 3, failed: 1 }, tasks,
};

describe('TaskStream test outcomes', () => {
  it('labels exit 126 Protected in the pane, never Failed', () => {
    render(<TaskStream groups={[group]} loading={false} />);
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.getAllByText('Protected').length).toBeGreaterThan(0);
    expect(screen.getByText(/execution prevented/)).toBeTruthy();
  });

  it('names each row by its outcome', () => {
    render(<TaskStream groups={[group]} loading={false} />);
    for (const word of ['protected', 'run failed', 'test error', 'not run']) {
      expect(screen.getByText(word)).toBeTruthy();
    }
  });

  it('counts the batch by outcome: 1 protected, 3 that produced no verdict', () => {
    render(<TaskStream groups={[group]} loading={false} />);
    const header = screen.getByRole('button', { name: /batch · LockBit Chain/ });
    expect(within(header).getByText('1').className).toContain('text-accent');
    expect(within(header).getByText('3').className).toContain('text-warning');
    expect(header.textContent).not.toMatch(/✕/);
  });
});

describe('TaskStream bundle verdict vs final exit', () => {
  const bundle: AgentTask = {
    ...testTask('z', 999),
    result: {
      ...testTask('z', 999).result!,
      bundle_results: { bundle_category: 'intel-driven', controls: [
        { control_id: 'T1', exit_code: 101 }, { control_id: 'T2', exit_code: 101 }, { control_id: 'T3', exit_code: 101 },
        { control_id: 'T4', exit_code: 999 }, { control_id: 'T5', exit_code: 0, skipped: true },
      ] },
    },
  };
  const one: TaskGroup = { ...group, batch_id: 'b2', tasks: [bundle], agent_count: 1, status_counts: { completed: 1 } };

  it('labels the exit "Final exit", leaves it uncoloured, and states the stage verdict', () => {
    render(<TaskStream groups={[one]} loading={false} />);
    expect(screen.getByText('Final exit')).toBeTruthy();
    expect(screen.queryByText('Exit code')).toBeNull();
    const exit = screen.getByText(/test error, prerequisites not met/).parentElement!;
    expect(exit.className).not.toContain('text-danger');
    expect(screen.getByText('3 of 4 stages ran without being blocked.')).toBeTruthy();
  });

  it('keeps "Exit code" and no reason line when the exit code is the verdict', () => {
    render(<TaskStream groups={[{ ...group, tasks: [testTask('s', 126)] }]} loading={false} />);
    expect(screen.getByText('Exit code')).toBeTruthy();
    expect(screen.queryByText(/Exit 126: execution prevented/)).toBeNull();
  });
});

describe('TaskStream selected row', () => {
  it('marks the selected task clearly (accent wash + inset bar, aria-current) and moves it on click', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<TaskStream groups={[group]} loading={false} />);
    const rows = () => screen.getAllByRole('button').filter((b) => b.textContent?.includes('LockBit Chain') && !b.textContent.includes('batch'));
    const first = rows()[0];
    expect(first.getAttribute('aria-current')).toBe('true');
    expect(first.className).toContain('bg-accent-dim');
    expect(first.className).toContain('shadow-[inset_3px_0_0_var(--color-accent)]');

    await userEvent.click(rows()[2]);
    expect(rows()[2].getAttribute('aria-current')).toBe('true');
    expect(rows()[0].getAttribute('aria-current')).toBeNull();
  });
});

describe('TaskStream requested by', () => {
  it('shows who requested the selected task', () => {
    const t = { ...testTask('r', 126), created_by_label: 'Jane Doe (jane@example.com)' };
    render(<TaskStream groups={[{ ...group, tasks: [t] }]} loading={false} />);
    expect(screen.getByText('Requested by')).toBeTruthy();
    expect(screen.getByText('Jane Doe (jane@example.com)')).toBeTruthy();
  });

  it('omits the row when the backend sends no requester (serverless)', () => {
    render(<TaskStream groups={[{ ...group, tasks: [testTask('r', 126)] }]} loading={false} />);
    expect(screen.queryByText('Requested by')).toBeNull();
  });
});

