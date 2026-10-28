import { describe, it, expect } from 'vitest';
import { buildDigestEmail } from '../render.js';
import type { DigestEmailData } from '../render.js';
import { buildIcsEvents } from '../ics.js';

const t1 = { name: 'Test One', uuid: '11111111-1111-1111-1111-111111111111', stages: '3', techniques: ['T1486'], tactics: ['impact'] };
const t2 = { name: 'Test Two', uuid: '22222222-2222-2222-2222-222222222222', stages: '1', techniques: [], tactics: [] };
const h = (hostname: string, online = true) => ({ hostname, os: 'windows', online });

function data(over: Partial<DigestEmailData> = {}): DigestEmailData {
  return {
    runDate: '2026-10-29',
    digestTz: 'Europe/London',
    uiUrl: 'https://example.test/app',
    entries: [
      { scheduleName: 'Nightly', mode: 'fixed', timezone: 'Europe/London', start: new Date('2026-10-29T09:00:00Z'), end: new Date('2026-10-29T11:00:00Z'), test: t1, hosts: [h('a'), h('b', false)] },
      { scheduleName: 'Weekly', mode: 'fleet', timezone: 'Europe/London', start: new Date('2026-10-29T12:00:00Z'), end: new Date('2026-10-29T14:00:00Z'), test: t2, hosts: [h('b'), h('c')] },
    ],
    ...over,
  };
}

describe('buildDigestEmail', () => {
  it('builds the subject with distinct tests and hosts', () => {
    expect(buildDigestEmail(data()).subject).toBe(
      '[ProjectAchilles] Security testing scheduled tomorrow, Thu 2026-10-29 — 2 tests on 3 hosts',
    );
  });

  it('escapes schedule names', () => {
    const d = data();
    d.entries[0].scheduleName = '<script>x</script> & co';
    const { html } = buildDigestEmail(d);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders each mode line and no ISO strings', () => {
    const mk = (mode: 'fixed' | 'fleet' | 'per_machine') =>
      buildDigestEmail(data({ entries: [{ ...data().entries[0], mode }] })).html;
    expect(mk('per_machine')).toContain('Each host at its own random time. Hosts can start the test between');
    expect(mk('fleet')).toContain('All hosts together at one random time. Hosts can start the test between');
    const fixed = mk('fixed');
    expect(fixed).toContain('All hosts together. Hosts can start the test between');
    expect(fixed).not.toContain('nothing new starts after');
    for (const m of ['per_machine', 'fleet', 'fixed'] as const) {
      expect(mk(m)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
  });

  it('includes the intro, link and offline note', () => {
    const { html } = buildDigestEmail(data());
    expect(html).toContain('This is an advance heads-up.');
    expect(html).toContain('If the mail server is slow on the day, both times move later');
    expect(html).toContain('Open schedules');
    expect(html).toContain('https://example.test/app');
    expect(html).toContain('offline: runs only if it reconnects in time');
    expect(html).not.toContain('identifies this run');
  });
});

describe('buildIcsEvents', () => {
  const ev = (uid: string, summary: string) => ({
    uid, sequence: 0, start: new Date('2026-10-29T09:00:00Z'), end: new Date('2026-10-29T10:00:00Z'),
    summary, description: 'd', stamp: new Date('2026-10-28T09:00:00Z'),
  });
  it('emits one calendar with N events and escapes text', () => {
    const ics = buildIcsEvents([ev('digest-a-2026-10-29@projectachilles', 'A, B; C'), ev('digest-b-2026-10-29@projectachilles', 'B')]);
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:digest-a-2026-10-29@projectachilles');
    expect(ics).toContain('UID:digest-b-2026-10-29@projectachilles');
    expect(ics).toContain(String.raw`SUMMARY:A\, B\; C`);
  });
});
