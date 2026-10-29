import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { alertProvesKill, type KillCandidateTask, type KillEvidenceAlert } from '../../edr/agent-kill-evidence.js';
import { mergeSiemIntoAlert, transformAlert, transformGraphqlDetection, transformSiemEvent, type SophosAlertDoc } from '../normalize.js';

// Documents CURRENT behaviour, so a change is deliberate: Sophos supplies no
// evidence for the EDR-killed-agent conversion. alertProvesKill needs a
// qualifying prevention_action AND an ATT&CK technique overlap on the same
// alert. Sophos rows that carry prevention (Common Alerts, SIEM events) have
// no techniques; XDR detections carry techniques but never prevention. A
// watchdog-failed task stays an error even when Sophos killed the agent.
// Follow-up: accept technique overlap from a same-host XDR detection in the
// window as a companion to a prevention row.

const dir = dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fx = (n: string) => JSON.parse(readFileSync(join(dir, 'fixtures', `${n}.json`), 'utf8')) as Record<string, any>;

/** What agent-kill-reconcile.service.ts reads from an alert doc. */
const asEvidence = (doc: SophosAlertDoc): KillEvidenceAlert => ({
  id: doc.alert_id,
  vendor: 'sophos',
  createdAt: doc.created_at,
  evidenceHostnames: doc.evidence_hostnames,
  mitreTechniques: doc.mitre_techniques,
  preventionAction: doc.prevention_action,
  achillesMitigated: false,
});

const prevented = mergeSiemIntoAlert(transformAlert(fx('common-alert')), transformSiemEvent(fx('siem-core-detection-ml'))!);
const xdr = transformGraphqlDetection(fx('graphql-detection'));

const task = (hostname: string, techniques: string[]): KillCandidateTask => ({
  taskId: 't-1',
  testUuid: '7659eeba-f315-440e-9882-4aa015d68b27',
  hostname,
  assignedAtMs: Date.parse('2026-01-01T00:00:00Z'),
  failedAtMs: Date.parse('2027-12-31T00:00:00Z'),
  techniques,
});

describe('Sophos agent-kill evidence (current behaviour: none)', () => {
  it('a Sophos alert/SIEM row with a prevention action has no techniques, so it proves no kill', () => {
    expect(prevented.prevention_action).toBe('quarantined');
    expect(prevented.mitre_techniques).toEqual([]);
    const t = task(prevented.evidence_hostnames[0], ['T1059.001', 'T1486']);
    expect(alertProvesKill(t, asEvidence(prevented))).toBe(false);
    // Only the missing techniques stop it: the same row with a technique overlap would prove the kill.
    expect(alertProvesKill(t, { ...asEvidence(prevented), mitreTechniques: ['T1059.001'] })).toBe(true);
  });

  it('an XDR detection has techniques but never a prevention action, so it proves no kill either', () => {
    expect(xdr.mitre_techniques.length).toBeGreaterThan(0);
    expect(xdr.prevention_action).toBeUndefined();
    expect(alertProvesKill(task(xdr.evidence_hostnames[0] ?? 'host', xdr.mitre_techniques), asEvidence(xdr))).toBe(false);
  });
});
