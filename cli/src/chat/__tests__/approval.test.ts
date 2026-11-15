import { describe, expect, it, vi } from 'vitest';
import {
  createPendingAction,
  executeApprovedAction,
  matchesConfirmation,
} from '../approval.js';

describe('chat action approval', () => {
  it('accepts only the exact fresh action confirmation', () => {
    const parameters = { userId: 'user-1', metadata: { source: 'chat' } };
    const first = createPendingAction('delete_user', 'destructive', 'Delete a user', parameters);
    const second = createPendingAction('delete_user', 'destructive', 'Delete a user', { userId: 'user-2' });

    expect(matchesConfirmation(first, first.confirmationText)).toBe(true);
    expect(matchesConfirmation(first, 'yes')).toBe(false);
    expect(matchesConfirmation(second, first.confirmationText)).toBe(false);
    expect(Object.isFrozen(parameters.metadata)).toBe(true);
  });

  it('does not invoke the API executor when approval is denied', async () => {
    const action = createPendingAction('delete_user', 'destructive', 'Delete a user', { userId: 'user-1' });
    const execute = vi.fn().mockResolvedValue({ deleted: true });

    await expect(executeApprovedAction(action, async () => false, execute)).resolves.toEqual({
      status: 'cancelled',
      action: 'delete_user',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('invokes the API executor after approval', async () => {
    const action = createPendingAction('add_agent_tag', 'write', 'Add an agent tag', {
      id: 'agent-1',
      tag: 'production',
    });
    const execute = vi.fn().mockResolvedValue({ tags: ['production'] });

    await expect(executeApprovedAction(action, async () => true, execute)).resolves.toEqual({
      tags: ['production'],
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});
