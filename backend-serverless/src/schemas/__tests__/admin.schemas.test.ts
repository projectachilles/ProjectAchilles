import { describe, it, expect } from 'vitest';
import { CreateTaskSchema, CreateScheduleSchema } from '../admin.schemas.js';

// The metadata the frontend sends since test severity left the UI: no `severity`.
const frontendMetadata = {
  category: 'intel-driven',
  subcategory: '',
  techniques: ['T1055.003'],
  tactics: ['defense-evasion'],
  threat_actor: 'LummaC2',
  target: ['windows-endpoint'],
  complexity: 'high',
  tags: [],
  score: 8.7,
  integrations: [],
};

const task = {
  org_id: 'org_1',
  agent_ids: ['agent-1'],
  test_uuid: '26a8b54e-b51c-489d-beae-295e1eecc524',
  test_name: 'Lumma-Style Infostealer',
  binary_name: '26a8b54e-b51c-489d-beae-295e1eecc524.exe',
};

describe('task metadata severity (deprecated)', () => {
  it('CreateTaskSchema accepts metadata without severity', () => {
    const r = CreateTaskSchema.safeParse({ ...task, metadata: frontendMetadata });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('CreateTaskSchema still accepts severity from older frontends', () => {
    const r = CreateTaskSchema.safeParse({ ...task, metadata: { ...frontendMetadata, severity: 'high' } });
    expect(r.success).toBe(true);
    expect(r.data?.metadata?.severity).toBe('high');
  });

  it('CreateScheduleSchema accepts metadata without severity', () => {
    const r = CreateScheduleSchema.safeParse({
      ...task,
      metadata: frontendMetadata,
      schedule_type: 'daily',
      schedule_config: { time: '09:00' },
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});

describe('target_index (where a task writes its results)', () => {
  const base = {
    org_id: 'org-1',
    agent_ids: ['agent-1'],
    test_uuid: '7659eeba-f315-440e-9882-4aa015d68b27',
    test_name: 'Test',
    binary_name: 'test.exe',
  };

  it.each(['achilles-results-lab', 'achilles-results-2026.11', 'achilles-results-org-a.q4'])(
    'accepts the Achilles results index %s', (target_index) => {
      expect(CreateTaskSchema.safeParse({ ...base, target_index }).success).toBe(true);
    });

  it('accepts a task with no target index', () => {
    expect(CreateTaskSchema.safeParse(base).success).toBe(true);
  });

  it.each([
    '.kibana',
    '.security-7',
    'achilles-defender',
    'achilles-sentinelone',
    'archived-achilles-results',
    'logs-app',
    'achilles-results-*',
    'achilles-results-a,logs-app',
    'Achilles-Results-Lab',
    '<achilles-results-{now/d}>',
  ])('rejects %s', (target_index) => {
    expect(CreateTaskSchema.safeParse({ ...base, target_index }).success).toBe(false);
  });
});
