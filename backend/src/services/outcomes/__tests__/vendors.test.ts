import { describe, it, expect } from 'vitest';
import {
  EDR_VENDORS,
  EDR_VENDOR_KEYS,
  PREVENTION_ACTION_PRECEDENCE,
  edrFlagField,
  edrVendor,
} from '../vendors.js';

describe('EDR vendor registry', () => {
  it('has unique keys', () => {
    expect(new Set(EDR_VENDOR_KEYS).size).toBe(EDR_VENDORS.length);
  });

  it('lists keys in registry order', () => {
    expect(EDR_VENDOR_KEYS).toEqual(['defender', 'crowdstrike', 'sentinelone', 'sophos']);
  });

  it('prevention-action precedence is a permutation of the keys', () => {
    expect([...PREVENTION_ACTION_PRECEDENCE].sort()).toEqual([...EDR_VENDOR_KEYS].sort());
    expect(PREVENTION_ACTION_PRECEDENCE).toEqual(['crowdstrike', 'sentinelone', 'sophos', 'defender']);
  });

  it('builds result-doc flag fields', () => {
    expect(edrFlagField('sentinelone', 'prevention_action')).toBe('f0rtika.sentinelone_prevention_action');
    expect(edrFlagField('defender', 'stage_detected')).toBe('f0rtika.defender_stage_detected');
  });

  it('keeps every display name verbatim', () => {
    expect(EDR_VENDORS.map((v) => [v.key, v.name, v.label, v.productName, v.abbrev, v.reportName])).toEqual([
      ['defender', 'Defender', 'Microsoft Defender', 'Microsoft Defender for Endpoint', 'MDE', 'Defender'],
      ['crowdstrike', 'CrowdStrike', 'CrowdStrike Falcon', 'CrowdStrike Falcon', 'CS', 'Falcon'],
      ['sentinelone', 'SentinelOne', 'SentinelOne Singularity', 'SentinelOne Singularity', 'S1', 'SentinelOne'],
      ['sophos', 'Sophos', 'Sophos Intercept X', 'Sophos Intercept X', 'SX', 'Sophos'],
    ]);
    expect(edrVendor('crowdstrike').reportName).toBe('Falcon');
  });
});

describe('registry-derived ES helpers', () => {
  it('lists every flag field per vendor', async () => {
    const { edrFlagSourceFields } = await import('../vendors.js');
    expect(edrFlagSourceFields()).toHaveLength(4 * EDR_VENDOR_KEYS.length);
    expect(edrFlagSourceFields(['detected'])).toEqual([
      'f0rtika.defender_detected',
      'f0rtika.crowdstrike_detected',
      'f0rtika.sentinelone_detected',
      'f0rtika.sophos_detected',
    ]);
  });

  it('builds one detected term per vendor', async () => {
    const { edrDetectedTerms } = await import('../vendors.js');
    expect(edrDetectedTerms()).toEqual([
      { term: { 'f0rtika.defender_detected': true } },
      { term: { 'f0rtika.crowdstrike_detected': true } },
      { term: { 'f0rtika.sentinelone_detected': true } },
      { term: { 'f0rtika.sophos_detected': true } },
    ]);
  });
});
