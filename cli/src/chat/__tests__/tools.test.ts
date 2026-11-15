import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestApproval } from '../approval.js';

const { createCommandTaskMock, deleteUserMock } = vi.hoisted(() => ({
  createCommandTaskMock: vi.fn(),
  deleteUserMock: vi.fn(),
}));

vi.mock('../../api/tasks.js', () => ({
  createCommandTask: createCommandTaskMock,
}));

vi.mock('../../api/users.js', () => ({
  deleteUser: deleteUserMock,
}));

const { createChatTools } = await import('../tools.js');

type ExecutableTool = {
  execute?: (parameters: Record<string, unknown>) => Promise<unknown>;
};

const STATE_CHANGING_TOOLS = [
  'create_token',
  'create_tasks',
  'create_command_task',
  'create_update_tasks',
  'update_agent',
  'add_agent_tag',
  'remove_agent_tag',
  'update_task_notes',
  'update_schedule',
  'trigger_sync',
  'build_test',
  'accept_risk',
  'invite_user',
  'delete_agent',
  'rotate_agent_key',
  'revoke_token',
  'cancel_task',
  'delete_task',
  'delete_schedule',
  'create_uninstall_tasks',
  'delete_build',
  'delete_certificate',
  'revoke_risk_acceptance',
  'delete_user',
] as const;

async function executeTool(
  name: string,
  parameters: Record<string, unknown>,
  requestApproval: RequestApproval,
): Promise<unknown> {
  const tools = createChatTools(requestApproval) as Record<string, ExecutableTool>;
  const execute = tools[name]?.execute;
  if (!execute) throw new Error(`Missing executable tool: ${name}`);
  return execute(parameters);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chat tool approval boundary', () => {
  it('exposes only read tools without an interactive approval channel', () => {
    const tools = createChatTools();

    expect(tools).toHaveProperty('list_agents');
    for (const name of STATE_CHANGING_TOOLS) {
      expect(tools).not.toHaveProperty(name);
    }
  });

  it('does not execute a proposed command when terminal approval is denied', async () => {
    const requestApproval = vi.fn(async () => false);

    await expect(executeTool(
      'create_command_task',
      { agent_ids: ['agent-1'], command: 'whoami' },
      requestApproval,
    )).resolves.toEqual({ status: 'cancelled', action: 'create_command_task' });

    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'create_command_task',
      parameters: { agent_ids: ['agent-1'], command: 'whoami' },
    }));
    expect(createCommandTaskMock).not.toHaveBeenCalled();
  });

  it('does not execute a destructive identity action when approval is denied', async () => {
    await executeTool(
      'delete_user',
      { userId: 'user-1' },
      async () => false,
    );

    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('preserves command execution after terminal approval', async () => {
    createCommandTaskMock.mockResolvedValue({ task_ids: ['task-1'] });

    await expect(executeTool(
      'create_command_task',
      { agent_ids: ['agent-1'], command: 'whoami', execution_timeout: 30 },
      async () => true,
    )).resolves.toEqual({ task_ids: ['task-1'] });

    expect(createCommandTaskMock).toHaveBeenCalledWith({
      org_id: 'default',
      agent_ids: ['agent-1'],
      command: 'whoami',
      execution_timeout: 30,
    });
  });
});
