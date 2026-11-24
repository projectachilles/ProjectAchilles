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

describe('test id and binary name (they become part of the blob key)', () => {
  const schedule = { ...task, schedule_type: 'once', schedule_config: { date: '2030-01-01', time: '09:00' } };

  it('accepts a test id as the library writes it', () => {
    expect(CreateTaskSchema.safeParse(task).success).toBe(true);
    expect(CreateTaskSchema.safeParse({ ...task, test_uuid: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
    expect(CreateScheduleSchema.safeParse(schedule).success, JSON.stringify(CreateScheduleSchema.safeParse(schedule).error?.issues)).toBe(true);
  });

  it.each([`x/../${task.test_uuid}`, '..', '../../etc', `${task.test_uuid}/`, 'not-a-test-id'])(
    'refuses test id %j for a task and a schedule',
    (test_uuid) => {
      expect(CreateTaskSchema.safeParse({ ...task, test_uuid }).success).toBe(false);
      expect(CreateScheduleSchema.safeParse({ ...schedule, test_uuid }).success).toBe(false);
    },
  );

  it.each(['../secret.exe', 'sub/test.exe', '..', '.hidden', '/etc/passwd', 'x'.repeat(256)])(
    'refuses binary name %j for a task and a schedule',
    (binary_name) => {
      expect(CreateTaskSchema.safeParse({ ...task, binary_name }).success).toBe(false);
      expect(CreateScheduleSchema.safeParse({ ...schedule, binary_name }).success).toBe(false);
    },
  );
});

