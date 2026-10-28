import { describe, it, expect } from 'vitest';
import { buildNoticeEmail } from '../render.js';
import type { NoticeEmailData } from '../render.js';

const tests = [
  { name: 'Test <One>', uuid: '7659eeba-f315-440e-9882-4aa015d68b27', stages: '3', techniques: ['T1486', 'T1105'], tactics: ['impact'] },
  { name: 'Bundle & Two', uuid: 'aaaaaaaa-f315-440e-9882-4aa015d68b27', stages: '52 controls', techniques: [], tactics: [] },
];

function hosts(n: number) {
  return Array.from({ length: n }, (_, i) => ({ hostname: `host-${i}`, os: i % 2 ? 'linux' : 'windows', online: i % 3 !== 0 }));
}

const base: NoticeEmailData = {
  kind: 'run',
  runTag: 'PA-RUN-0001',
  timezone: 'Europe/London',
  trigger: 'Run now by Jane',
  startNotBefore: new Date('2026-10-29T09:00:00Z'),
  pickupDeadline: new Date('2026-10-29T09:30:00Z'),
  windowEnd: new Date('2026-10-29T10:00:00Z'),
  tests,
  hosts: hosts(3),
  edr: [{ vendor: 'Microsoft Defender', autoResolve: 'enabled' }],
  uiUrl: 'https://example.test/app',
};

describe('buildNoticeEmail snapshots', () => {
  it('run kind', () => {
    expect(buildNoticeEmail(base)).toMatchSnapshot();
  });
  it('day kind with more than 50 hosts', () => {
    const d: NoticeEmailData = {
      ...base,
      kind: 'day',
      dayWindow: { start: new Date('2026-10-29T08:00:00Z'), end: new Date('2026-10-29T16:00:00Z') },
      hosts: hosts(57),
      edr: [],
    };
    expect(buildNoticeEmail(d)).toMatchSnapshot();
  });
});
