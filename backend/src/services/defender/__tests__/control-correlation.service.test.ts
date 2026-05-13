import { describe, it, expect } from 'vitest';
import { getControlMitreTechniques, _mappingSize } from '../control-correlation.service.js';

describe('getControlMitreTechniques', () => {
  it('returns an empty array for an empty or whitespace title', () => {
    expect(getControlMitreTechniques('')).toEqual([]);
    expect(getControlMitreTechniques('   ')).toEqual([]);
  });

  it('returns an empty array for a control that is not in the curated map', () => {
    expect(getControlMitreTechniques('Some control title with no MITRE mapping')).toEqual([]);
  });

  it('matches the MFA-for-admins control to T1078 + T1110', () => {
    expect(
      getControlMitreTechniques(
        'Ensure multifactor authentication is enabled for all users in administrative roles',
      ),
    ).toEqual(['T1078', 'T1110']);
  });

  it('matches "Block executable content from email client and webmail" to phishing + execution techniques', () => {
    expect(
      getControlMitreTechniques('Block executable content from email client and webmail'),
    ).toEqual(['T1566', 'T1204']);
  });

  it('matches "Block Office applications from injecting code" to process-injection T1055', () => {
    expect(
      getControlMitreTechniques('Block Office applications from injecting code into other processes'),
    ).toEqual(['T1055']);
  });

  it('matches "Use advanced protection against ransomware" to T1486', () => {
    expect(getControlMitreTechniques('Use advanced protection against ransomware')).toEqual([
      'T1486',
    ]);
  });

  it('is case-insensitive', () => {
    expect(
      getControlMitreTechniques('BLOCK JAVASCRIPT OR VBSCRIPT FROM LAUNCHING DOWNLOADED EXECUTABLE CONTENT'),
    ).toEqual(['T1059.007', 'T1059.005']);
  });

  it('exposes a curated mapping with a reasonable number of entries', () => {
    // Sanity bound — if the mapping grows under 5 or above 50, something is off
    expect(_mappingSize()).toBeGreaterThanOrEqual(10);
    expect(_mappingSize()).toBeLessThan(50);
  });
});
