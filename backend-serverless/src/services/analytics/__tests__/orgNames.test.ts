import { describe, it, expect, afterEach, vi } from 'vitest';
import { orgName, orgShortName, parseOrgNames } from '../orgNames.js';

describe('orgNames', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('accepts a short name or a short + full name per org UUID', () => {
    expect(parseOrgNames('{"u1": "ACME", "u2": {"shortName": "GLOBEX", "fullName": "Globex Corporation"}}')).toEqual({
      u1: { shortName: 'ACME', fullName: 'ACME' },
      u2: { shortName: 'GLOBEX', fullName: 'Globex Corporation' },
    });
  });

  it('ignores entries without a usable short name', () => {
    expect(parseOrgNames('{"u1": "", "u2": {"fullName": "No short"}, "u3": 7, "u4": " ACME "}')).toEqual({
      u4: { shortName: 'ACME', fullName: 'ACME' },
    });
  });

  it('treats unset, invalid or non-object values as no names, with a warning for bad input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseOrgNames(undefined)).toEqual({});
    expect(parseOrgNames('  ')).toEqual({});
    expect(warn).not.toHaveBeenCalled();
    expect(parseOrgNames('{not json')).toEqual({});
    expect(parseOrgNames('["u1"]')).toEqual({});
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('reads ORG_NAMES from the environment, following changes', () => {
    vi.stubEnv('ORG_NAMES', '{"u1": "ACME"}');
    expect(orgShortName('u1')).toBe('ACME');
    expect(orgShortName('u2')).toBeUndefined();
    expect(orgName(null)).toBeUndefined();
    vi.stubEnv('ORG_NAMES', '{"u1": {"shortName": "ACME", "fullName": "Acme Corporation"}}');
    expect(orgName('u1')).toEqual({ shortName: 'ACME', fullName: 'Acme Corporation' });
  });

  it('ships without any built-in names', () => {
    vi.stubEnv('ORG_NAMES', '');
    expect(orgShortName('aaaaaaaa-1111-4111-8111-111111111111')).toBeUndefined();
  });
});
