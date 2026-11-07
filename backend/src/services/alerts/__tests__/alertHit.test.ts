import { describe, it, expect } from 'vitest';
import { classifyAttribution, projectAlertHit } from '../alertHit.js';

const UUID = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';

describe('classifyAttribution', () => {
  it('attributes the first stage binary it finds', () => {
    expect(classifyAttribution([`${UUID}.exe`, `${UUID}-T1486.exe`, `${UUID}-T1003.001.exe`], UUID))
      .toEqual({ attribution: 'stage', attributed_control_id: 't1486' });
  });

  it('keeps variant suffixes', () => {
    expect(classifyAttribution([`${UUID}-T1211-cfapi.exe`], UUID).attributed_control_id).toBe('t1211-cfapi');
  });

  it('matches case-insensitively', () => {
    expect(classifyAttribution([`${UUID.toUpperCase()}-T1486.EXE`], UUID).attribution).toBe('stage');
  });

  it('treats orchestrator-only, foreign-bundle and UUID-less evidence as bundle-level', () => {
    expect(classifyAttribution([`${UUID}.exe`], UUID)).toEqual({ attribution: 'bundle' });
    expect(classifyAttribution(['aaaaaaaa-0000-0000-0000-000000000000-T1486.exe'], UUID)).toEqual({ attribution: 'bundle' });
    expect(classifyAttribution(['powershell.exe'], UUID)).toEqual({ attribution: 'bundle' });
    expect(classifyAttribution([`${UUID}-T1486.exe`], '')).toEqual({ attribution: 'bundle' });
  });
});

describe('projectAlertHit', () => {
  const base = {
    alert_id: 'a1',
    alert_title: 'ProcRansomware',
    severity: 'high',
    status: 'new',
    created_at: '2026-10-12T12:48:51Z',
    updated_at: '2026-10-12T12:48:51Z',
    mitre_techniques: ['T1486'],
    evidence_filenames: [`${UUID}-T1486.exe`],
  };

  it('projects prevention, portal and auto-resolve fields when present', () => {
    const p = projectAlertHit({
      ...base,
      prevention_action: 'blocked',
      portal_url: 'https://falcon.example/a1',
      f0rtika: { auto_resolved_at: '2026-10-12T13:02:10Z', auto_resolve_mode: 'enabled' },
    }, UUID);
    expect(p).toMatchObject({
      alert_id: 'a1',
      attribution: 'stage',
      attributed_control_id: 't1486',
      prevention_action: 'blocked',
      portal_url: 'https://falcon.example/a1',
      auto_resolved_at: '2026-10-12T13:02:10Z',
      resolved_at: null,
    });
  });

  it('omits optional fields that are absent and defaults strings to empty', () => {
    const p = projectAlertHit(base, UUID);
    expect(p).not.toHaveProperty('prevention_action');
    expect(p).not.toHaveProperty('portal_url');
    expect(p).not.toHaveProperty('auto_resolved_at');
    expect(p.description).toBe('');
    expect(p.mitre_techniques).toEqual(['T1486']);
  });

  describe('auto_resolved_at only reports real resolutions', () => {
    const receipt = (f0rtika: Record<string, unknown>) => projectAlertHit({ ...base, f0rtika }, UUID);

    it('omits it for a dry-run receipt (no PATCH was made)', () => {
      const p = receipt({ auto_resolved: true, auto_resolved_at: '2026-10-12T13:02:10Z', auto_resolve_mode: 'dry_run' });
      expect(p).not.toHaveProperty('auto_resolved_at');
    });

    it('omits it for an enabled receipt that carries an error', () => {
      const p = receipt({
        auto_resolved: true,
        auto_resolved_at: '2026-10-12T13:02:10Z',
        auto_resolve_mode: 'enabled',
        auto_resolve_error: 'Graph PATCH failed: 403',
      });
      expect(p).not.toHaveProperty('auto_resolved_at');
    });

    it('omits it when the receipt has no mode', () => {
      const p = receipt({ auto_resolved: true, auto_resolved_at: '2026-10-12T13:02:10Z' });
      expect(p).not.toHaveProperty('auto_resolved_at');
    });

    it('reports it for an enabled receipt without an error', () => {
      const p = receipt({ auto_resolved: true, auto_resolved_at: '2026-10-12T13:02:10Z', auto_resolve_mode: 'enabled' });
      expect(p.auto_resolved_at).toBe('2026-10-12T13:02:10Z');
    });

    it('treats an empty error string as no error', () => {
      const p = receipt({
        auto_resolved_at: '2026-10-12T13:02:10Z',
        auto_resolve_mode: 'enabled',
        auto_resolve_error: '',
      });
      expect(p.auto_resolved_at).toBe('2026-10-12T13:02:10Z');
    });

    it('reads the dotted-key form of an enabled receipt', () => {
      const p = projectAlertHit({
        ...base,
        'f0rtika.auto_resolved_at': '2026-10-12T13:02:10Z',
        'f0rtika.auto_resolve_mode': 'enabled',
      }, UUID);
      expect(p.auto_resolved_at).toBe('2026-10-12T13:02:10Z');
    });

    it('omits it for dotted-key dry-run and dotted-key error receipts', () => {
      expect(projectAlertHit({
        ...base,
        'f0rtika.auto_resolved_at': '2026-10-12T13:02:10Z',
        'f0rtika.auto_resolve_mode': 'dry_run',
      }, UUID)).not.toHaveProperty('auto_resolved_at');
      expect(projectAlertHit({
        ...base,
        'f0rtika.auto_resolved_at': '2026-10-12T13:02:10Z',
        'f0rtika.auto_resolve_mode': 'enabled',
        'f0rtika.auto_resolve_error': 'boom',
      }, UUID)).not.toHaveProperty('auto_resolved_at');
    });
  });
});

describe('projectAlertHit: multi-test alerts are never stage-attributed', () => {
  // Defender "A suspicious file was observed" lists leftover binaries of several tests.
  const OTHER = '26a8b54e-0000-4000-8000-000000000001';
  it('an alert naming this stage AND another test is bundle-level', () => {
    const p = projectAlertHit({ alert_id: 'a', evidence_filenames: [`${UUID}-T1486.exe`, `${OTHER}.exe`] }, UUID);
    expect(p.attribution).toBe('bundle');
    expect(p.attributed_control_id).toBeUndefined();
  });

  it('the same stage binary alone stays stage-attributed', () => {
    const p = projectAlertHit({ alert_id: 'a', evidence_filenames: [`${UUID}-T1486.exe`, `${UUID}.exe`, 'powershell.exe'] }, UUID);
    expect(p).toMatchObject({ attribution: 'stage', attributed_control_id: 't1486' });
  });
});
