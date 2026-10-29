import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS,
  transformAlert,
  transformSiemEvent,
  transformGraphqlDetection,
  transformV1Detection,
  siemPreventionAction,
  siemEventMatchesAlert,
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
  it('is undefined when the response came more than 15 minutes after when', () => {
    expect(SOPHOS_AUTONOMOUS_RESPONSE_WINDOW_MS).toBe(15 * 60 * 1000);
    const late = { ...base, created_at: '2026-10-28T10:15:01Z' };
    expect(siemPreventionAction({ ...late, ...items(['file', 'DELETED']) })).toBeUndefined();
    expect(siemPreventionAction({ ...late, origin: 'AMSI_DETECTION' })).toBeUndefined();
    expect(siemPreventionAction({ ...base, created_at: '2026-10-28T10:15:00Z', ...items(['file', 'DELETED']) })).toBe('quarantined');
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
      created_at: '2026-10-28T10:00:07.000Z', resolved_at: null, event_ids: ['evt-0001', 'evt-0002'],
      sha256: '3f2a9c1e5b7d4a8e9c0b1d2e3f4a5b6c7d8e9f00112233445566778899aabbcc',
    });
    expect(d.mitre_techniques).toEqual(['T1059.001', 'T1105', 'T1204.002']);
    expect(d.evidence_hostnames).toEqual(['WIN-LAB01']);
    expect(d.evidence_filepaths).toEqual([BIN]);
    expect(d.evidence_filenames).toEqual([BIN_NAME]);
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

describe('XDR detections never set prevention_action', () => {
  it('neither GraphQL nor v1, whatever the payload claims', () => {
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
