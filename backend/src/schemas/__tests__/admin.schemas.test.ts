import { describe, it, expect } from 'vitest';
import { CreateTaskSchema, CreateScheduleSchema, CreateTaskBatchSchema } from '../admin.schemas.js';
import { CreateCampaignSchema, UpdateCampaignSchema } from '../campaigns.schemas.js';

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

describe('test id and binary name (they reach the build folder path)', () => {
  const schedule = { ...task, schedule_type: 'once', schedule_config: { date: '2030-01-01', time: '09:00' } };

  it('accepts a test id as the library writes it, in either case', () => {
    expect(CreateTaskSchema.safeParse(task).success).toBe(true);
    expect(CreateTaskSchema.safeParse({ ...task, test_uuid: task.test_uuid.toUpperCase() }).success).toBe(true);
    // Not an RFC 4122 version/variant: library ids are only UUID-shaped.
    expect(CreateTaskSchema.safeParse({ ...task, test_uuid: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
    expect(CreateScheduleSchema.safeParse(schedule).success, JSON.stringify(CreateScheduleSchema.safeParse(schedule).error?.issues)).toBe(true);
  });

  const badIds = [
    `x/../${task.test_uuid}`,
    `../${task.test_uuid}`,
    '..',
    '../../etc',
    `${task.test_uuid}/`,
    ` ${task.test_uuid}`,
    `${task.test_uuid}\n`,
    'not-a-test-id',
  ];

  it.each(badIds)('refuses test id %j for a task, a batch and a schedule', (test_uuid) => {
    expect(CreateTaskSchema.safeParse({ ...task, test_uuid }).success).toBe(false);
    expect(CreateScheduleSchema.safeParse({ ...schedule, test_uuid }).success).toBe(false);
    const { org_id: _org, ...request } = task;
    expect(CreateTaskBatchSchema.safeParse({ org_id: 'org_1', requests: [{ ...request, test_uuid }] }).success).toBe(false);
  });

  it.each(badIds)('refuses test id %j in a campaign', (id) => {
    const campaign = { org_id: 'org_1', name: 'C', test_uuids: [task.test_uuid, id], agent_ids: ['agent-1'] };
    expect(CreateCampaignSchema.safeParse(campaign).success).toBe(false);
    expect(UpdateCampaignSchema.safeParse(campaign).success).toBe(false);
    expect(CreateCampaignSchema.safeParse({ ...campaign, test_uuids: [task.test_uuid] }).success).toBe(true);
  });

  it.each([task.binary_name, task.test_uuid, 'validator-defender.exe', 'tool_v2.bin'])(
    'accepts binary name %j',
    (binary_name) => {
      expect(CreateTaskSchema.safeParse({ ...task, binary_name }).success).toBe(true);
    },
  );

  it.each([
    '../secret.exe',
    'sub/test.exe',
    'sub\\test.exe',
    '..',
    '.',
    '.tmp-pass',
    '.tmp-inner-pass',
    '/etc/passwd',
    'a\u0000b.exe',
    'x'.repeat(256),
  ])('refuses binary name %j for a task and a schedule', (binary_name) => {
    expect(CreateTaskSchema.safeParse({ ...task, binary_name }).success).toBe(false);
    expect(CreateScheduleSchema.safeParse({ ...schedule, binary_name }).success).toBe(false);
  });
});
