import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS,
  transformAlert,
  transformSiemEvent,
  parseLegacyCleanup,
  legacyCleanupMatches,
  transformGraphqlDetection,
  transformV1Detection,
  siemPreventionAction,
  siemEventMatchesAlert,
  siemEventMatchesXdr,
  SOPHOS_XDR_JOIN_WINDOW_MS,
  mergeSiemIntoAlert,
  normalizeHost,
} from '../normalize.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => JSON.parse(readFileSync(join(dir, 'fixtures', `${n}.json`), 'utf8')) as Record<string, any>;

const BIN = 'c:\\f0\\tasks\\task-4821-x7k2\\7659eeba-f315-440e-9882-4aa015d68b27-ch-def-001.exe';
const BIN_NAME = '7659eeba-f315-440e-9882-4aa015d68b27-ch-def-001.exe';

describe('fixtures', () => {
  it.each(['common-alert', 'siem-core-detection-ml', 'siem-core-detection-amsi', 'siem-threat-cleanedup',
    'siem-threat-cleanup-failed', 'graphql-detection', 'v1-detection'])('%s is marked provisional first', (n) => {
    const raw = readFileSync(join(dir, 'fixtures', `${n}.json`), 'utf8');
    expect(Object.keys(JSON.parse(raw))[0]).toBe('_provisional');
    expect(JSON.parse(raw)._provisional).toBe('derived from the published Sophos spec; replace with a verbatim PoC capture');
  });
});

describe('normalizeHost', () => {
  it('normalizes FQDN hosts to the short upper-case name', () => {
    expect(normalizeHost('win-lab01.corp.local')).toBe('WIN-LAB01');
    expect(normalizeHost(' Win-Lab01 ')).toBe('WIN-LAB01');
    expect(normalizeHost('')).toBe('');
  });
});

describe('transformAlert (Common Alert)', () => {
  it('maps the shared fields', () => {
    const d = transformAlert(fx('common-alert'));
    expect(d).toMatchObject({
      doc_type: 'alert', source_type: 'alert', service_source: 'Sophos',
      alert_id: 'a5ded91c-6575-435c-a6b4-64b94f9048ff', severity: 'high', severity_raw: 'high',
      status: 'open', category: 'malware', sophos_type: 'Event::Endpoint::Threat::Detected',
      endpoint_id: 'bb90527d-73a8-4e6e-85c6-20c2e0c5bc6f', allowed_actions: ['acknowledge', 'cleanVirus'],
      created_at: '2026-10-28T10:00:05.250Z', updated_at: '2026-10-28T10:00:06.000Z', resolved_at: null,
    });
    expect(d.evidence_hostnames).toEqual(['WIN-LAB01']);
    expect(d.prevention_action).toBeUndefined();
  });

  it('extracts the C:\\F0 test binary from a Common Alert description', () => {
    const d = transformAlert(fx('common-alert'));
    expect(d.evidence_filepaths).toEqual([BIN]);
    expect(d.evidence_filenames).toEqual([BIN_NAME]);
  });

  it('maps high/medium/low 1:1 and tolerates missing fields', () => {
    for (const s of ['high', 'medium', 'low'] as const) expect(transformAlert({ id: 'x', severity: s }).severity).toBe(s);
    const d = transformAlert({});
    expect(d.severity).toBe('unknown');
    expect(d.evidence_hostnames).toEqual([]);
    expect(d.created_at).toBeNull();
  });

  it('treats a zone-less raisedAt as UTC and marks resolved alerts', () => {
    const d = transformAlert({ id: 'x', raisedAt: '2026-10-28T10:00:05.250', status: 'resolved', updatedAt: '2026-10-28T11:00:00Z' });
    expect(d.created_at).toBe('2026-10-28T10:00:05.250Z');
    expect(d.resolved_at).toBe('2026-10-28T11:00:00.000Z');
  });
});

describe('transformSiemEvent', () => {
  it('maps a Core Detection event', () => {
    const d = transformSiemEvent(fx('siem-core-detection-ml'))!;
    expect(d).toMatchObject({
      source_type: 'siem_event', alert_id: 'e1111111-1111-4111-8111-111111111111', severity: 'high',
      origin: 'ML_MALWARE_DETECTION', sophos_type: 'Event::Endpoint::CoreDetection', alert_title: 'ML/PE-A',
      created_at: '2026-10-28T10:00:01.000Z',
      sha256: '3f2a9c1e5b7d4a8e9c0b1d2e3f4a5b6c7d8e9f00112233445566778899aabbcc',
      endpoint_id: 'bb90527d-73a8-4e6e-85c6-20c2e0c5bc6f',
    });
    expect(d.evidence_hostnames).toEqual(['WIN-LAB01']);
    expect(d.evidence_filepaths).toEqual([BIN]);
    expect(d.evidence_filenames).toEqual([BIN_NAME]);
  });

  it('extracts AMSI process paths', () => {
    const d = transformSiemEvent(fx('siem-core-detection-amsi'))!;
    expect(d.evidence_filepaths).toContain(BIN);
    expect(d.evidence_filenames).toContain(BIN_NAME);
  });

  it('returns null for non-detection noise types', () => {
    expect(transformSiemEvent({ id: 'n', type: 'Event::Endpoint::OutOfDate', when: '2026-10-28T10:00:00Z' })).toBeNull();
    expect(transformSiemEvent({ id: 'n', type: 'Event::Endpoint::Threat::HIPSDismissed' })).toBeNull();
    for (const t of ['CleanedUp', 'CleanupFailed', 'PuaCleanupFailed', 'HIPSCleanupFailed']) {
      expect(transformSiemEvent({ id: 'n', type: `Event::Endpoint::Threat::${t}` })).toBeNull();
    }
    expect(transformSiemEvent(fx('siem-threat-cleanedup'))).toBeNull();
    expect(transformSiemEvent(fx('siem-threat-cleanup-failed'))).toBeNull();
    expect(transformSiemEvent({})).toBeNull();
  });

  it('maps severity NONE to informational', () => {
    expect(transformSiemEvent({ id: 'e', type: 'Event::Endpoint::CoreDetection', severity: 'NONE' })!.severity).toBe('informational');
    expect(transformSiemEvent({ id: 'e', type: 'Event::Endpoint::CoreDetection', severity: 'CRITICAL' })!.severity).toBe('critical');
  });

  it('is tolerant of absent optional fields', () => {
    expect(() => transformSiemEvent({ id: 'e', type: 'Event::Endpoint::CoreDetection' })).not.toThrow();
  });
});

describe('siemPreventionAction', () => {
  const base = { type: 'Event::Endpoint::CoreDetection', when: '2026-10-28T10:00:00Z', created_at: '2026-10-28T10:00:02Z' };
  const items = (...i: Array<[string, string]>) => ({ core_remedy_items: { items: i.map(([type, result]) => ({ type, result })) } });

  it('process + SUCCESS -> process_killed', () => {
    expect(siemPreventionAction({ ...base, ...items(['process', 'SUCCESS']) })).toBe('process_killed');
  });
  it('file + SUCCESS|DELETED -> quarantined', () => {
    expect(siemPreventionAction({ ...base, ...items(['file', 'SUCCESS']) })).toBe('quarantined');
    expect(siemPreventionAction({ ...base, ...items(['file', 'DELETED']) })).toBe('quarantined');
    expect(siemPreventionAction(fx('siem-core-detection-ml'))).toBe('quarantined');
  });
  it('no remedy items with a blocking origin -> blocked', () => {
    for (const origin of ['AMSI_DETECTION', 'BLOCKLISTED_BY_ADMIN', 'HMPA_DETECTION']) {
      expect(siemPreventionAction({ ...base, origin })).toBe('blocked');
    }
    expect(siemPreventionAction(fx('siem-core-detection-amsi'))).toBe('blocked');
    expect(siemPreventionAction({ ...base, origin: 'ML_MALWARE_DETECTION' })).toBeUndefined();
  });
  it('Threat::CleanedUp -> blocked', () => {
    expect(siemPreventionAction(fx('siem-threat-cleanedup'))).toBe('blocked');
  });
  it('FAILED_TO_DELETE or Threat::CleanupFailed -> kill_failed', () => {
    expect(siemPreventionAction({ ...base, ...items(['file', 'FAILED_TO_DELETE']) })).toBe('kill_failed');
    expect(siemPreventionAction(fx('siem-threat-cleanup-failed'))).toBe('kill_failed');
    expect(siemPreventionAction({ ...base, type: 'Event::Endpoint::Threat::CleanupFailed' })).toBe('kill_failed');
  });
  it('WHITELISTED|NOT_FOUND -> undefined', () => {
    expect(siemPreventionAction({ ...base, ...items(['file', 'WHITELISTED']) })).toBeUndefined();
    expect(siemPreventionAction({ ...base, ...items(['file', 'NOT_FOUND']), origin: 'AMSI_DETECTION' })).toBeUndefined();
  });
  it('a Core Detection event uploaded hours late still yields its remedy action (created_at is never used)', () => {
    const late = { ...base, created_at: '2026-10-28T16:00:00Z' };
    expect(siemPreventionAction({ ...late, ...items(['file', 'DELETED']) })).toBe('quarantined');
    expect(siemPreventionAction({ ...late, origin: 'AMSI_DETECTION' })).toBe('blocked');
    expect(SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS).toBe(15 * 60 * 1000);
  });
  it('a CleanedUp event more than 15 minutes after the passed detectedAt is undefined', () => {
    const e = { type: 'Event::Endpoint::Threat::CleanedUp', when: '2026-10-28T10:20:00Z' };
    expect(siemPreventionAction(e, '2026-10-28T10:00:00Z')).toBeUndefined();
    expect(siemPreventionAction({ ...e, when: '2026-10-28T10:15:00Z' }, '2026-10-28T10:00:00Z')).toBe('blocked');
  });
  it('the same CleanedUp without detectedAt counts as blocked', () => {
    expect(siemPreventionAction({ type: 'Event::Endpoint::Threat::CleanedUp', when: '2026-10-28T10:20:00Z' })).toBe('blocked');
  });
  it('tolerates garbage', () => {
    expect(siemPreventionAction(null)).toBeUndefined();
    expect(siemPreventionAction({})).toBeUndefined();
  });
});

describe('transformGraphqlDetection', () => {
  it('maps metadata, techniques, entities and event ids', () => {
    const d = transformGraphqlDetection(fx('graphql-detection'));
    expect(d).toMatchObject({
      source_type: 'xdr_detection', alert_id: 'alert:3f1c2d4e-0000-4000-8000-000000000001',
      alert_title: 'Suspicious process launched from C:\\F0', severity: 'high', severity_raw: 0.65, status: 'open',
      created_at: '2026-10-28T10:00:07.000Z', updated_at: '2026-10-28T10:05:00.500Z', timestamp: '2026-10-28T10:05:00.500Z', resolved_at: null, event_ids: ['evt-0001', 'evt-0002'],
      sha256: '3f2a9c1e5b7d4a8e9c0b1d2e3f4a5b6c7d8e9f00112233445566778899aabbcc',
    });
    expect(d.mitre_techniques).toEqual(['T1059.001', 'T1105', 'T1204.002']);
    expect(d.evidence_hostnames).toEqual(['WIN-LAB01']);
    expect(d.evidence_filepaths).toEqual([BIN]);
    expect(d.evidence_filenames).toEqual([BIN_NAME]);
  });
  it('reads the entity prefixes a live tenant returns (computerName, bare fileName)', () => {
    // Shape captured from a live Sophos XDR tenant (values neutralized).
    const d = transformGraphqlDetection({
      id: 'x',
      entities: {
        entities: [
          'fileName:powershell.exe', 'fileName:a1b2c3d4-0000-4000-8000-000000000001.exe',
          'computerName:WIN-LAB01', 'userName:LAB\\analyst', 'hostId:h-1', 'sensorHostId:s-1',
          'sensorId:s-2', 'sensorType:ENDPOINT_SOPHOS',
        ],
      },
    });
    expect(d.evidence_hostnames).toEqual(['WIN-LAB01']);
    expect(d.evidence_filenames).toEqual(['powershell.exe', 'a1b2c3d4-0000-4000-8000-000000000001.exe']);
    expect(d.evidence_filepaths).toEqual([]);
  });
  it.each([[0.8, 'critical'], [0.79, 'high'], [0.6, 'high'], [0.59, 'medium'], [0.4, 'medium'], [0.39, 'low'], [0.2, 'low'], [0.19, 'informational'], [0, 'informational']])(
    'severity %s -> %s', (sev, want) => {
      expect(transformGraphqlDetection({ id: 'x', metadata: { severity: sev } }).severity).toBe(want);
    });
  it('missing severity is unknown; resolved status sets resolved_at', () => {
    expect(transformGraphqlDetection({ id: 'x' }).severity).toBe('unknown');
    const d = transformGraphqlDetection({ id: 'x', status: 'FALSE_POSITIVE', metadata: { updated_at: '2026-10-28T11:00:00Z' } });
    expect(d.status).toBe('false_positive');
    expect(d.resolved_at).toBe('2026-10-28T11:00:00.000Z');
  });
});

describe('transformV1Detection', () => {
  it('maps the REST v1 detection', () => {
    const d = transformV1Detection(fx('v1-detection'));
    expect(d).toMatchObject({
      source_type: 'xdr_detection', alert_id: '0a1b2c3d_4e5f-6071', alert_title: 'WIN-EXE-DM-SUS-STAGING-1',
      severity: 'high', severity_raw: 7, category: 'Defense Evasion', created_at: '2026-10-28T10:00:09.604Z',
    });
    expect(d.mitre_techniques).toEqual(['T1059', 'T1204.002']);
    expect(d.evidence_hostnames).toEqual(['WIN-LAB01']);
    expect(d.evidence_filepaths).toContain(BIN);
    expect(d.evidence_filenames).toContain(BIN_NAME);
  });
  it.each([[10, 'critical'], [8, 'critical'], [7, 'high'], [6, 'high'], [5, 'medium'], [4, 'medium'], [3, 'low'], [2, 'low'], [1, 'informational']])(
    'severity %s -> %s', (sev, want) => {
      expect(transformV1Detection({ id: 'x', severity: sev }).severity).toBe(want);
    });
});

describe('XDR detections take prevention only from Sophos block / cleanup detections', () => {
  const STAGE = 'c37d6a01-3934-4e72-9cb1-3dae284b937b-t1105.exe';

  it('a live "Cleanup succeeded" detection is quarantined and names the stage process', () => {
    const d = transformGraphqlDetection(fx('graphql-detection-cleanup-live'));
    expect(d.prevention_action).toBe('quarantined');
    expect(d.evidence_hostnames).toEqual(['HOST-006']);
    expect(d.evidence_filenames).toEqual(expect.arrayContaining([STAGE, 'tailcat.exe']));
    expect(d.evidence_filepaths).toEqual(expect.arrayContaining([`c:\\f0\\${STAGE}`, 'c:\\f0\\tailcat.exe']));
  });

  it('a live "File activity blocked" detection is blocked and names the stage process', () => {
    const d = transformGraphqlDetection(fx('graphql-detection-blocked-live'));
    expect(d.prevention_action).toBe('blocked');
    expect(d.evidence_hostnames).toEqual(['HOST-004']);
    expect(d.evidence_filenames).toEqual(expect.arrayContaining([STAGE, 'tailcat.exe']));
  });

  it('reads the stage process from processImagePath alone', () => {
    const d = transformGraphqlDetection({
      id: 'x', metadata: { title: 'Tailcat: File activity blocked (C:\\F0\\tailcat.exe)' },
      entities: { entities: ['computerName:host-004', 'processImagePath:C:\\F0\\' + STAGE, 'programName:' + STAGE] },
    });
    expect(d.evidence_filepaths).toEqual([`c:\\f0\\${STAGE}`]);
    expect(d.evidence_filenames).toEqual([STAGE]);
  });

  it.each([
    'Cleanup failed: File cleanup result: Failed (C:\\F0\\tailcat.exe)',
    'Cleanup succeeded: File cleanup result: Not found (C:\\F0\\tailcat.exe)',
    'LockBit Ransomware RansomNote',
    'Suspicious process launched from C:\\F0 (file activity blocked elsewhere)',
  ])('"%s" is detected only', (title) => {
    expect(transformGraphqlDetection({ id: 'x', metadata: { title } }).prevention_action).toBeUndefined();
  });

  it('ignores whatever prevention fields the payload claims', () => {
    expect(transformGraphqlDetection({ ...fx('graphql-detection'), prevention_action: 'blocked', core_remedy_items: { items: [{ type: 'file', result: 'DELETED' }] } }).prevention_action).toBeUndefined();
    expect(transformV1Detection({ ...fx('v1-detection'), prevention_action: 'quarantined' }).prevention_action).toBeUndefined();
    expect('prevention_action' in transformV1Detection(fx('v1-detection'))).toBe(false);
  });
});

describe('join + merge', () => {
  const alert = () => transformAlert(fx('common-alert'));
  const event = () => transformSiemEvent(fx('siem-core-detection-ml'))!;

  it('matches on host + threat name within 2 minutes', () => {
    expect(siemEventMatchesAlert(event(), alert())).toBe(true);
  });
  it('matches on SHA-256 when the name is not in the description', () => {
    const a = { ...alert(), description: 'something else', sha256: event().sha256 };
    expect(siemEventMatchesAlert(event(), a)).toBe(true);
  });
  it('rejects a different host, a different threat, or a time gap over 2 minutes', () => {
    expect(siemEventMatchesAlert(event(), { ...alert(), evidence_hostnames: ['OTHER'] })).toBe(false);
    expect(siemEventMatchesAlert(event(), { ...alert(), alert_title: 'other', description: 'other', sha256: undefined })).toBe(false);
    expect(siemEventMatchesAlert(event(), { ...alert(), created_at: '2026-10-28T10:02:02.000Z' })).toBe(false);
    expect(siemEventMatchesAlert(event(), { ...alert(), created_at: '2026-10-28T10:02:01.000Z' })).toBe(true);
    expect(siemEventMatchesAlert(event(), { ...alert(), created_at: null })).toBe(false);
  });

  it('mergeSiemIntoAlert keeps the alert id and adds evidence + prevention_action', () => {
    const a = alert();
    const e = event();
    const m = mergeSiemIntoAlert(a, e);
    expect(m.alert_id).toBe(a.alert_id);
    expect(m.source_type).toBe('alert');
    expect(m.prevention_action).toBe('quarantined');
    expect(m.merged_siem_event_ids).toEqual([e.alert_id]);
    expect(m.origin).toBe('ML_MALWARE_DETECTION');
    expect(m.sha256).toBe(e.sha256);
    expect(m.evidence_filepaths).toEqual([BIN]);
    expect(m.evidence_hostnames).toEqual(['WIN-LAB01']);
    expect(a.prevention_action).toBeUndefined(); // input not mutated
    expect(mergeSiemIntoAlert(m, e).merged_siem_event_ids).toEqual([e.alert_id]); // idempotent
  });
});

describe('review fixes', () => {
  const alert = () => transformAlert(fx('common-alert'));
  const core = () => transformSiemEvent(fx('siem-core-detection-ml'))!;

  it('GraphQL Timestamp objects and numeric epochs parse', () => {
    const d = transformGraphqlDetection({ id: 'x', metadata: { created_at: { seconds: 1793181607, nanos: 250000000 } } });
    expect(d.created_at).toBe('2026-10-28T10:00:07.250Z');
    expect(d.timestamp).toBe('2026-10-28T10:00:07.250Z');
    expect(transformGraphqlDetection({ id: 'x', metadata: { created_at: 1793181607 } }).created_at).toBe('2026-10-28T10:00:07.000Z');
    expect(transformGraphqlDetection({ id: 'x', metadata: { created_at: { seconds: '1793181607', nanos: 0 } } }).created_at).toBe('2026-10-28T10:00:07.000Z');
  });

  it('a dateless input yields timestamp null, never an empty string', () => {
    expect(transformAlert({}).timestamp).toBeNull();
    expect(transformSiemEvent({ id: 'e', type: 'Event::Endpoint::CoreDetection' })!.timestamp).toBeNull();
    expect(transformGraphqlDetection({ id: 'x' }).timestamp).toBeNull();
    expect(transformV1Detection({ id: 'x' }).timestamp).toBeNull();
  });

  it('NaN severity is unknown', () => {
    expect(transformGraphqlDetection({ id: 'x', metadata: { severity: NaN } }).severity).toBe('unknown');
    expect(transformV1Detection({ id: 'x', severity: NaN }).severity).toBe('unknown');
  });

  describe('join', () => {
    it('does not cross-attribute two stages caught under the same generic name', () => {
      const stage2 = transformAlert({
        ...fx('common-alert'), id: 'other',
        description: "Malware detected: 'ML/PE-A' at 'C:\\F0\\tasks\\task-4821-x7k2\\7659eeba-f315-440e-9882-4aa015d68b27-CH-DEF-002.exe'",
      });
      expect(siemEventMatchesAlert(core(), stage2)).toBe(false);
      expect(siemEventMatchesAlert(core(), alert())).toBe(true);
    });
    it('requires an exact threat-name token, not a substring', () => {
      const a = { ...alert(), alert_title: 'x', description: "Malware detected: 'ML/PE-AB'", evidence_filenames: [], sha256: undefined };
      expect(siemEventMatchesAlert(core(), a)).toBe(false);
      expect(siemEventMatchesAlert(core(), { ...a, description: 'Malware ML/PE-A blocked' })).toBe(true);
      expect(siemEventMatchesAlert(core(), { ...a, description: "Malware detected: 'ML/PE-A'" })).toBe(true);
    });
  });

  describe('merge precedence', () => {
    const cleanedUp = () => parseLegacyCleanup(fx('siem-threat-cleanedup'))!;
    const failed = () => parseLegacyCleanup(fx('siem-threat-cleanup-failed'))!;
    it('quarantined beats a later CleanupFailed in either order', () => {
      const a = alert();
      const one = mergeSiemIntoAlert(mergeSiemIntoAlert(a, core()), failed());
      const two = mergeSiemIntoAlert(mergeSiemIntoAlert(a, failed()), core());
      expect(one.prevention_action).toBe('quarantined');
      expect(two.prevention_action).toBe('quarantined');
    });
    it('process_killed > blocked > kill_failed', () => {
      const a = alert();
      const killed = { ...core(), prevention_action: 'process_killed' as const };
      const blocked = { ...core(), prevention_action: 'blocked' as const };
      const kf = { ...core(), prevention_action: 'kill_failed' as const };
      expect(mergeSiemIntoAlert({ ...a, prevention_action: 'blocked' }, killed).prevention_action).toBe('process_killed');
      expect(mergeSiemIntoAlert({ ...a, prevention_action: 'kill_failed' }, blocked).prevention_action).toBe('blocked');
      expect(mergeSiemIntoAlert({ ...a, prevention_action: 'blocked' }, kf).prevention_action).toBe('blocked');
    });
    it('origin and sha256 keep the first non-empty value', () => {
      const m = mergeSiemIntoAlert({ ...alert(), origin: 'FIRST', sha256: 'a'.repeat(64) }, core());
      expect(m.origin).toBe('FIRST');
      expect(m.sha256).toBe('a'.repeat(64));
    });
    it('cleanup events are merged only when matching the target', () => {
      const a = alert();
      expect(mergeSiemIntoAlert(a, cleanedUp()).prevention_action).toBe('blocked');
      expect(mergeSiemIntoAlert(a, { ...cleanedUp(), when: '2026-10-28T10:20:05.250Z' }).prevention_action).toBeUndefined();
    });
  });

  describe('legacy cleanup events', () => {
    it('parseLegacyCleanup returns the minimal shape; detections and noise are null', () => {
      const c = parseLegacyCleanup(fx('siem-threat-cleanedup'))!;
      expect(c).toMatchObject({ host: 'WIN-LAB01', name: 'ML/PE-A', when: '2026-10-28T10:10:01.000Z', prevention_action: 'blocked' });
      expect(parseLegacyCleanup(fx('siem-threat-cleanup-failed'))!.prevention_action).toBe('kill_failed');
      expect(parseLegacyCleanup(fx('siem-core-detection-ml'))).toBeNull();
      expect(parseLegacyCleanup({})).toBeNull();
    });
    it('a cleanup 10 minutes after the target matches; 20 minutes after, or before, does not', () => {
      const a = alert(); // raised 10:00:05.250
      const c = parseLegacyCleanup(fx('siem-threat-cleanedup'))!;
      expect(legacyCleanupMatches(c, a)).toBe(true);
      expect(legacyCleanupMatches({ ...c, when: '2026-10-28T10:20:05.251Z' }, a)).toBe(false);
      expect(legacyCleanupMatches({ ...c, when: '2026-10-28T10:15:05.250Z' }, a)).toBe(true);
      expect(legacyCleanupMatches({ ...c, when: '2026-10-28T09:58:35.250Z' }, a)).toBe(true); // 90 s before raisedAt
      expect(mergeSiemIntoAlert(a, { ...c, when: '2026-10-28T09:58:35.250Z' }).prevention_action).toBe('blocked');
      expect(legacyCleanupMatches({ ...c, when: '2026-10-28T09:57:05.250Z' }, a)).toBe(false); // 3 min before
      expect(legacyCleanupMatches({ ...c, host: 'OTHER' }, a)).toBe(false);
    });
    it('can also attach to a Core detection row', () => {
      const c = parseLegacyCleanup({ ...fx('siem-threat-cleanedup'), when: '2026-10-28T10:05:00Z' })!;
      expect(legacyCleanupMatches(c, core())).toBe(true);
    });
  });

  describe('SIEM detection name', () => {
    it('comes from the first quoted token of name; threat is the correlation id', () => {
      const d = core();
      expect(d.alert_title).toBe('ML/PE-A');
      expect(d.threat_id).toBe('6b0f2c1d-9a3e-4f57-8c21-0d5e7a9b1c33');
    });
    it('falls back to threat only when it does not look like an id', () => {
      expect(transformSiemEvent({ id: 'e', type: 'Event::Endpoint::CoreDetection', name: 'no quotes', threat: 'Troj/Foo-A' })!.alert_title).toBe('Troj/Foo-A');
      expect(transformSiemEvent({ id: 'e', type: 'Event::Endpoint::CoreDetection', name: 'no quotes', threat: '6b0f2c1d-9a3e-4f57-8c21-0d5e7a9b1c33' })!.alert_title).toBe('no quotes');
    });
  });

  describe('Common Alert description paths', () => {
    it('extracts the unquoted path in the spec example', () => {
      const d = transformAlert({ id: 'x', description: 'Generic reputation PUA detected C:\\Temp\\WinExeSvc.exe' });
      expect(d.evidence_filepaths).toEqual(['c:\\temp\\winexesvc.exe']);
      expect(d.evidence_filenames).toEqual(['winexesvc.exe']);
    });
    it('extracts unquoted POSIX paths and never puts a bare file name in filepaths', () => {
      expect(transformAlert({ id: 'x', description: 'Detected /opt/f0/tasks/abc/x.bin.' }).evidence_filepaths).toEqual(['/opt/f0/tasks/abc/x.bin']);
      expect(transformAlert({ id: 'x', description: "Malware detected: 'Foo' at 'svchost.exe'" }).evidence_filepaths).toEqual([]);
    });
  });

  describe('remedy and type edge cases', () => {
    const base = { type: 'Event::Endpoint::CoreDetection', when: '2026-10-28T10:00:00Z' };
    it('FAILED_TO_DELETE_SYSTEM_PROTECTED and Pua/HIPS CleanupFailed -> kill_failed', () => {
      expect(siemPreventionAction({ ...base, core_remedy_items: { items: [{ type: 'file', result: 'FAILED_TO_DELETE_SYSTEM_PROTECTED' }] } })).toBe('kill_failed');
      expect(siemPreventionAction({ type: 'Event::Endpoint::Threat::PuaCleanupFailed' })).toBe('kill_failed');
      expect(siemPreventionAction({ type: 'Event::Endpoint::Threat::HIPSCleanupFailed' })).toBe('kill_failed');
    });
    it('IPS inbound/outbound events are detection rows', () => {
      for (const t of ['IpsInboundDetection', 'IpsOutboundDetection']) {
        expect(transformSiemEvent({ id: 'e', type: `Event::Endpoint::Threat::${t}`, when: '2026-10-28T10:00:00Z' })).not.toBeNull();
      }
    });
  });
});

describe('SIEM event -> XDR detection join (live Tailcat block)', () => {
  // Live pilot: Sophos blocked C:\F0\tailcat.exe dropped by a test stage and
  // raised, for the same host within seconds, an XDR detection and a SIEM
  // CorePuaDetection + CorePuaClean pair. All three describe one block.
  const xdr = () => transformGraphqlDetection(fx('graphql-detection-blocked-live'));
  const clean = () => transformSiemEvent(fx('siem-pua-clean-live'))!;
  const detection = () => transformSiemEvent(fx('siem-pua-detection-live'))!;
  const at = (iso: string, deltaMs: number) => new Date(Date.parse(iso) + deltaMs).toISOString();

  it('the live fixtures are marked captured first', () => {
    for (const n of ['siem-pua-clean-live', 'siem-pua-detection-live']) {
      const raw = JSON.parse(readFileSync(join(dir, 'fixtures', `${n}.json`), 'utf8'));
      expect(Object.keys(raw)[0]).toBe('_captured');
    }
  });

  it('normalizes the live SIEM pair: the clean event is quarantined, the detection carries no prevention', () => {
    expect(clean()).toMatchObject({ source_type: 'siem_event', alert_title: 'Tailcat', evidence_hostnames: ['HOST-004'], evidence_filepaths: ['c:\\f0\\tailcat.exe'], prevention_action: 'quarantined' });
    expect(detection()).toMatchObject({ source_type: 'siem_event', alert_title: 'Tailcat', evidence_filepaths: ['c:\\f0\\tailcat.exe'] });
    expect(detection().prevention_action).toBeUndefined();
  });

  it('matches both live SIEM events to the XDR detection (same host, file path among its evidence, seconds apart)', () => {
    expect(siemEventMatchesXdr(clean(), xdr())).toBe(true);
    expect(siemEventMatchesXdr(detection(), xdr())).toBe(true);
  });

  it('matches within the join window either way, not beyond', () => {
    const x = xdr();
    const e = clean();
    // The widest live gap was +125 s (a clean event after its XDR detection): a 2-minute window misses it.
    expect(siemEventMatchesXdr({ ...e, created_at: at(x.created_at!, 125_000) }, x)).toBe(true);
    expect(siemEventMatchesXdr({ ...e, created_at: at(x.created_at!, -SOPHOS_XDR_JOIN_WINDOW_MS) }, x)).toBe(true);
    expect(siemEventMatchesXdr({ ...e, created_at: at(x.created_at!, SOPHOS_XDR_JOIN_WINDOW_MS) }, x)).toBe(true);
    expect(siemEventMatchesXdr({ ...e, created_at: at(x.created_at!, SOPHOS_XDR_JOIN_WINDOW_MS + 1) }, x)).toBe(false);
    expect(siemEventMatchesXdr({ ...e, created_at: at(x.created_at!, -SOPHOS_XDR_JOIN_WINDOW_MS - 1) }, x)).toBe(false);
    expect(siemEventMatchesXdr({ ...e, created_at: null }, x)).toBe(false);
    expect(siemEventMatchesXdr(e, { ...x, created_at: null })).toBe(false);
  });

  it('the window is 5 minutes, inside the 15-minute autonomous-response window, so a merged SIEM remedy is never a late action', () => {
    expect(SOPHOS_XDR_JOIN_WINDOW_MS).toBe(5 * 60_000);
    expect(SOPHOS_XDR_JOIN_WINDOW_MS).toBeLessThan(SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS);
  });

  it('never matches across hosts or different files', () => {
    expect(siemEventMatchesXdr({ ...clean(), evidence_hostnames: ['HOST-006'] }, xdr())).toBe(false);
    expect(siemEventMatchesXdr({ ...clean(), evidence_filepaths: ['c:\\f0\\other.exe'], evidence_filenames: ['other.exe'] }, xdr())).toBe(false);
    // The same file name in another folder is another file.
    expect(siemEventMatchesXdr({ ...clean(), evidence_filepaths: ['c:\\users\\u\\tailcat.exe'] }, xdr())).toBe(false);
  });

  it('every SIEM file path must be on the XDR detection: sharing only the stage binary is not enough', () => {
    const stage = 'c:\\f0\\c37d6a01-3934-4e72-9cb1-3dae284b937b-t1105.exe';
    expect(siemEventMatchesXdr({ ...clean(), evidence_filepaths: [stage, 'c:\\f0\\other.exe'] }, xdr())).toBe(false);
    expect(siemEventMatchesXdr({ ...clean(), evidence_filepaths: [stage, 'c:\\f0\\tailcat.exe'] }, xdr())).toBe(true);
  });

  it('a SIEM event with no file path never matches', () => {
    expect(siemEventMatchesXdr({ ...clean(), evidence_filepaths: [] }, xdr())).toBe(false);
  });

  it('compares paths case-insensitively', () => {
    expect(siemEventMatchesXdr({ ...clean(), evidence_filepaths: ['C:\\F0\\TAILCAT.EXE'] }, xdr())).toBe(true);
  });

  it('two different SHA-256 values are two different files', () => {
    const a = 'a'.repeat(64);
    expect(siemEventMatchesXdr({ ...clean(), sha256: a }, { ...xdr(), sha256: 'b'.repeat(64) })).toBe(false);
    expect(siemEventMatchesXdr({ ...clean(), sha256: a }, { ...xdr(), sha256: a })).toBe(true);
    expect(siemEventMatchesXdr({ ...clean(), sha256: a }, xdr())).toBe(true);
  });

  it('only an XDR detection is a target (a Common Alert or another SIEM row is not)', () => {
    expect(siemEventMatchesXdr(clean(), { ...xdr(), source_type: 'alert' })).toBe(false);
    expect(siemEventMatchesXdr(clean(), { ...xdr(), source_type: 'siem_event' })).toBe(false);
  });

  it('merging keeps the XDR identity and techniques, and adds the SIEM id and the stronger prevention', () => {
    const x = { ...xdr(), mitre_techniques: ['T1105'] };
    const m = mergeSiemIntoAlert(x, clean());
    expect(m).toMatchObject({ source_type: 'xdr_detection', alert_id: x.alert_id, alert_title: x.alert_title, mitre_techniques: ['T1105'], prevention_action: 'quarantined' });
    expect(m.merged_siem_event_ids).toEqual([clean().alert_id]);
    expect(m.evidence_filepaths).toEqual(x.evidence_filepaths);
  });
});
