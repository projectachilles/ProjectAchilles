import { describe, it, expect } from 'vitest';
import { DEFAULT_TASK_KIND, kindCount, typesForKind } from '../taskKinds';

const counts = { execute_test: 41, execute_command: 6, update_agent: 50, uninstall: 2 };

describe('taskKinds', () => {
  it('defaults to security tests', () => {
    expect(DEFAULT_TASK_KIND).toBe('tests');
    expect(typesForKind('tests')).toEqual(['execute_test']);
  });

  it('groups agent updates and uninstalls as maintenance; All filters nothing', () => {
    expect(typesForKind('maintenance')).toEqual(['update_agent', 'uninstall']);
    expect(typesForKind('all')).toEqual([]);
  });

  it('counts each pill from the per-type counts', () => {
    expect(kindCount('tests', counts)).toBe(41);
    expect(kindCount('commands', counts)).toBe(6);
    expect(kindCount('maintenance', counts)).toBe(52);
    expect(kindCount('all', counts)).toBe(99);
    expect(kindCount('commands', { execute_test: 3 })).toBe(0);
  });

  it('has no count when the backend sends none (serverless)', () => {
    expect(kindCount('tests', undefined)).toBeNull();
  });
});
