import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentTask, TaskResult } from '@/types/agent';

vi.mock('@/services/api/agent', () => ({ agentApi: { getTask: vi.fn() } }));

import { agentApi } from '@/services/api/agent';
import TaskDetailPanel from '../TaskDetailPanel';

const getTask = vi.mocked(agentApi.getTask);

const whole: TaskResult = {
  exit_code: 101, stdout: 'the whole output', stderr: 'a warning', execution_duration_ms: 9000,
  started_at: '2026-11-25T10:00:00Z', completed_at: '2026-11-25T10:00:09Z', hostname: 'HOST-1',
};
/** What the list sends: the facts a list draws, no output, marked as a summary. */
const light = (): TaskResult => ({ summary: true, exit_code: whole.exit_code, execution_duration_ms: whole.execution_duration_ms });

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 't1',
    agent_id: 'agent-1',
    agent_hostname: 'HOST-1',
    type: 'execute_test',
    priority: 5,
    status: 'completed',
    payload: { test_uuid: 'u', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 },
    result: light(),
    notes: null,
    notes_history: [],
    created_at: '2026-11-25 10:00:00',
    assigned_at: null,
    completed_at: '2026-11-25 10:00:09',
    batch_id: 'batch-1',
    ...overrides,
  };
}

/** A request the test answers when it chooses. */
function pending() {
  let resolve!: (t: AgentTask) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<AgentTask>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getTask.mockReset();
});

describe('TaskDetailPanel with a light result from the list', () => {
  it('fetches the task and shows its output; the facts are there at once', async () => {
    const request = pending();
    getTask.mockReturnValue(request.promise);
    render(<TaskDetailPanel task={task()} />);

    expect(getTask).toHaveBeenCalledExactlyOnceWith('t1');
    expect(screen.getByRole('status')).toHaveTextContent('Loading output');
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.queryByText('(empty)')).not.toBeInTheDocument();

    request.resolve(task({ result: whole }));

    expect(await screen.findByText('the whole output')).toBeInTheDocument();
    expect(screen.getByText('a warning')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not fetch a result that came whole', () => {
    render(<TaskDetailPanel task={task({ result: whole })} />);
    expect(getTask).not.toHaveBeenCalled();
    expect(screen.getByText('the whole output')).toBeInTheDocument();
  });

  it('does not fetch a task without a result', () => {
    render(<TaskDetailPanel task={task({ status: 'executing', result: null, completed_at: null })} />);
    expect(getTask).not.toHaveBeenCalled();
  });

  it('does not fetch again when the list refreshes the same finished task', async () => {
    getTask.mockResolvedValue(task({ result: whole }));
    const { rerender } = render(<TaskDetailPanel task={task()} />);
    await screen.findByText('the whole output');

    rerender(<TaskDetailPanel task={task()} />);
    rerender(<TaskDetailPanel task={task({ notes: 'a note added meanwhile' })} />);

    expect(getTask).toHaveBeenCalledTimes(1);
    expect(screen.getByText('the whole output')).toBeInTheDocument();
  });

  it('says when the output could not be loaded, and loads it on Try again', async () => {
    getTask.mockRejectedValueOnce(new Error('network'));
    render(<TaskDetailPanel task={task()} />);

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText('(empty)')).not.toBeInTheDocument();

    getTask.mockResolvedValue(task({ result: whole }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('the whole output')).toBeInTheDocument();
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('never shows one task the output of another', async () => {
    const first = pending();
    const second = pending();
    getTask.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<TaskDetailPanel task={task()} />);

    // Another task is selected before the first answer arrives.
    rerender(<TaskDetailPanel task={task({ id: 't2', agent_hostname: 'HOST-2' })} />);
    expect(getTask).toHaveBeenLastCalledWith('t2');

    first.resolve(task({ result: { ...whole, stdout: 'output of the first task' } }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByText('output of the first task')).not.toBeInTheDocument();

    second.resolve(task({ id: 't2', result: { ...whole, stdout: 'output of the second task' } }));
    expect(await screen.findByText('output of the second task')).toBeInTheDocument();
    expect(screen.queryByText('output of the first task')).not.toBeInTheDocument();
  });

  it('shows loading, not the previous task\'s output, when another task is selected', async () => {
    getTask.mockResolvedValueOnce(task({ result: { ...whole, stdout: 'output of the first task' } }));
    const { rerender } = render(<TaskDetailPanel task={task()} />);
    await screen.findByText('output of the first task');

    getTask.mockReturnValueOnce(pending().promise);
    rerender(<TaskDetailPanel task={task({ id: 't2', agent_hostname: 'HOST-2' })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading output');
    expect(screen.queryByText('output of the first task')).not.toBeInTheDocument();
  });

  it('keeps the selected task\'s output when an earlier task\'s answer arrives after it', async () => {
    const first = pending();
    const second = pending();
    getTask.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<TaskDetailPanel task={task()} />);
    rerender(<TaskDetailPanel task={task({ id: 't2', agent_hostname: 'HOST-2' })} />);

    second.resolve(task({ id: 't2', result: { ...whole, stdout: 'output of the second task' } }));
    await screen.findByText('output of the second task');
    first.resolve(task({ result: { ...whole, stdout: 'output of the first task' } }));
    // Let the late answer be handled.
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.getByText('output of the second task')).toBeInTheDocument());

    expect(screen.queryByText('output of the first task')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows loading, not an old failure, when a task whose output once failed is selected again', async () => {
    getTask.mockRejectedValueOnce(new Error('network'));
    const { rerender } = render(<TaskDetailPanel task={task()} />);
    await screen.findByText(/could not be loaded/i);

    // Another task: its output is loading, and the first task's failure is not shown on it.
    getTask.mockReturnValueOnce(pending().promise);
    rerender(<TaskDetailPanel task={task({ id: 't2', agent_hostname: 'HOST-2' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading output');
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();

    // Back to the first: it is fetched again, and says so.
    getTask.mockReturnValueOnce(pending().promise);
    rerender(<TaskDetailPanel task={task()} />);
    await waitFor(() => expect(getTask).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading output'));
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });

  it('shows loading while Try again is fetching', async () => {
    getTask.mockRejectedValueOnce(new Error('network'));
    render(<TaskDetailPanel task={task()} />);
    await screen.findByText(/could not be loaded/i);

    getTask.mockReturnValueOnce(pending().promise);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Loading output');
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });

  it('drops the output when retention removes it from a task that is open', async () => {
    getTask.mockResolvedValueOnce(task({ result: whole }));
    const { rerender } = render(<TaskDetailPanel task={task()} />);
    await screen.findByText('the whole output');

    // The next refresh of the list: the retention job has removed this task's output.
    const compacted_at = '2026-11-25T12:00:00Z';
    getTask.mockResolvedValueOnce(task({ result: { ...whole, stdout: '', stderr: '', compacted_at } }));
    rerender(<TaskDetailPanel task={task({ result: { ...light(), compacted_at } })} />);

    expect(screen.getByTestId('output-compacted-notice')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('the whole output')).not.toBeInTheDocument());
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('opens the fetched output in the expanded viewer', async () => {
    getTask.mockResolvedValue(task({ result: whole }));
    render(<TaskDetailPanel task={task()} />);

    await userEvent.click(await screen.findByText('the whole output'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('the whole output');
  });

  it('fetches again when a running task it showed finishes', async () => {
    getTask.mockResolvedValue(task({ result: whole }));
    const { rerender } = render(<TaskDetailPanel task={task({ status: 'executing', result: null, completed_at: null })} />);
    expect(getTask).not.toHaveBeenCalled();

    rerender(<TaskDetailPanel task={task()} />);

    expect(await screen.findByText('the whole output')).toBeInTheDocument();
    expect(getTask).toHaveBeenCalledExactlyOnceWith('t1');
  });

  it('shows the retention notice from the light result while the output loads', () => {
    getTask.mockReturnValue(pending().promise);
    render(<TaskDetailPanel task={task({ result: { ...light(), compacted_at: '2026-11-25T12:00:00Z' } })} />);
    expect(screen.getByTestId('output-compacted-notice')).toBeInTheDocument();
  });
});
