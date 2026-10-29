import { describe, it, expect } from 'vitest';
import { redactCapture, redactCaptureSet } from '../redact.js';

const text = (v: unknown) => JSON.stringify(v);

describe('redactCapture', () => {
  it('pseudonymises a hostname consistently across fields', () => {
    const out = redactCapture({
      endpoint: { hostname: 'LAPTOP-ACME42', id: 'x' },
      alert: { managedAgent: { name: 'LAPTOP-ACME42' }, description: 'Malware found on laptop-acme42 today' },
      xdr: { entities: [{ properties: { hostname: 'LAPTOP-ACME42', hostname_fqdn: 'laptop-acme42.corp.acme.local' } }] },
      other: { hostname: 'SERVER-9' },
    }) as any;
    expect(out.endpoint.hostname).toBe('host-001');
    expect(out.other.hostname).toBe('host-002');
    expect(out.alert.description).toBe('Malware found on host-001 today');
    expect(out.xdr.entities[0].properties.hostname).toBe('host-001');
    expect(out.xdr.entities[0].properties.hostname_fqdn).toBe('host-001.example.test');
    expect(text(out)).not.toMatch(/acme/i);
  });

  it('keeps C:\\F0 file names and ATT&CK ids', () => {
    const input = {
      location: 'C:\\F0\\7659eeba-f315-440e-9882-4aa015d68b27-T1486.exe',
      linux: '/opt/f0/tasks/7659eeba-f315-440e-9882-4aa015d68b27/stage1.bin',
      attack_technique_ids: ['T1486', 'T1059.001'],
      type: 'Event::Endpoint::Threat::Detected',
      origin: 'Sophos',
      remedy: { result: '0x00000000' },
      severity: 'high',
      raisedAt: '2026-10-28T12:34:56.789Z',
    };
    expect(redactCapture(input)).toEqual(input);
  });

  it('replaces emails and IPs', () => {
    const out = redactCapture({
      associatedPerson: { name: 'Jane Smith', viaLogin: 'CORP\\jsmith' },
      ipv4Addresses: ['10.20.30.40', '10.20.30.41'],
      ipv6Addresses: ['fe80::1c2d:3e4f:5a6b:7c8d'],
      macAddresses: ['AA:BB:CC:DD:EE:FF'],
      description: 'Mail from jane.smith@acme.com via 10.20.30.40 and 2a01:4b00:1::7',
      version: '10.0.19045.0',
    }) as any;
    const s = text(out);
    expect(out.associatedPerson.viaLogin).toBe('domain-001\\user-002');
    expect(out.ipv4Addresses).toEqual(['192.0.2.1', '192.0.2.2']);
    expect(out.ipv6Addresses[0]).toMatch(/^2001:db8::[0-9a-f]+$/);
    expect(out.description).toMatch(/^Mail from user-\d{3}@example\.test via 192\.0\.2\.1 and 2001:db8::[0-9a-f]+$/);
    expect(out.version).toBe('10.0.19045.0');
    for (const leak of ['jsmith', 'Jane', 'acme', '10.20.30', 'fe80', 'AA:BB', '2a01']) expect(s).not.toContain(leak);
  });

  it('never leaves a value from the redaction map in free text', () => {
    const map = new Map<string, string>();
    const out = redactCapture({
      first: { description: 'Seen on DESKTOP-QQ77 by Bob.Builder with C:\\Users\\bobb\\file.txt' },
      later: { hostname: 'DESKTOP-QQ77', username: 'Bob.Builder', tenant_id: '11772', host_id: 'abcdef0123456789' },
      uuid: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', note: 'tenant 3f2504e0-4f89-41d3-9a0c-0305e82c3301 id alert://priv:sophos:11772:99' },
    }, map) as any;
    const s = text(out);
    expect(map.size).toBeGreaterThan(0);
    for (const original of map.keys()) expect(s.toLowerCase()).not.toContain(original.toLowerCase());
    expect(s).not.toContain('bobb');
    expect(out.uuid.id).toBe(out.uuid.note.match(/[0-9a-f-]{36}/)[0]);
    expect(out.uuid.id).not.toContain('3f2504e0');
    // the same map reused for a second capture stays consistent
    const again = redactCapture({ hostname: 'DESKTOP-QQ77' }, map) as any;
    expect(again.hostname).toBe(out.later.hostname);
  });
});

describe('redactCapture XDR entity keys', () => {
  it('redacts user_name and domain_name keys consistently', () => {
    const out = redactCapture({ a: { user_name: 'bob', domain_name: 'CORP' }, b: { description: 'bob logged on to CORP' } }) as any;
    expect(out.a).toEqual({ user_name: 'user-001', domain_name: 'domain-001' });
    expect(out.b.description).toBe('user-001 logged on to domain-001');
  });
});

describe('redactCapture review leaks', () => {
  const NONE = (out: unknown, ...leaks: string[]) => {
    const s = JSON.stringify(out);
    for (const l of leaks) expect(s.toLowerCase(), `leaked ${l}`).not.toContain(l.toLowerCase());
  };

  it('learns hosts, users, orgs and admins from non-obvious keys (default-deny names)', () => {
    const out = redactCapture({
      alert: { id: 'a', managedAgent: { id: 'e', name: 'ACME-LT-01' }, tenant: { id: 't', name: 'Acme Corporation' }, severity: 'high' },
      siem: { dhost: 'ACME-SRV-02', location: 'ACME-LT-03', source: 'ACME\\bsmith', duser: 'ACME\\cjones', suser: 'dlee' },
      endpoint: { id: 'x', group: { name: 'Acme Finance Laptops' }, os: { name: 'Windows 10' } },
      policies: [{ id: 'p', name: 'Acme Strict Policy' }],
      items: { 'allowed-items': [{ createdBy: { name: 'Pat Admin' }, comment: 'AcmeERP share' }] },
      note: { description: 'bsmith and cjones on ACME-SRV-02 at Acme Corporation' },
    }) as any;
    NONE(out, 'acme', 'bsmith', 'cjones', 'dlee', 'Pat Admin');
    expect(out.alert.severity).toBe('high');
    expect(out.endpoint.os.name).toBe('Windows 10');
  });

  it('scrubs exclusion and allowed-item paths but keeps system dirs and C:\\F0', () => {
    const out = redactCapture({
      'scanning-exclusions': [
        { type: 'path', value: 'C:\\Program Files\\AcmeERP\\', comment: 'AcmeERP share' },
        { type: 'path', value: 'C:\\F0\\*.exe' },
        { type: 'process', value: '/opt/acme/bin/erp' },
      ],
    }) as any;
    NONE(out, 'acme');
    expect(out['scanning-exclusions'][0].value).toMatch(/^C:\\Program Files\\dir-\d+\\$/);
    expect(out['scanning-exclusions'][1].value).toBe('C:\\F0\\*.exe');
  });

  it('does not leak the FQDN suffix when only the short host was learned', () => {
    const out = redactCapture({ hostname: 'laptop-acme42', description: 'on laptop-acme42.corp.acme.local now' });
    NONE(out, 'acme', 'corp');
  });

  it('learns the domain suffix of an FQDN', () => {
    const out = redactCapture({ hostname_fqdn: 'a1.corp.acme.local', note: 'join corp.acme.local' });
    NONE(out, 'acme', 'corp');
  });

  it('does not let the C:\\F0 keep rule swallow trailing data', () => {
    const out = redactCapture({ cmd: 'C:\\F0\\a.exe;ACME\\bsmith@10.1.2.3 x', u: { user_name: 'bsmith' } }) as any;
    NONE(out, 'bsmith', '10.1.2.3');
    expect(out.cmd.startsWith('C:\\F0\\a.exe;')).toBe(true);
  });

  it('pseudonymises SIDs but keeps well-known ones', () => {
    const sid = 'S-1-5-21-1111111111-2222222222-3333333333-1105';
    const out = redactCapture({ a: sid, b: `HKU\\${sid}\\Software`, c: 'S-1-5-18', d: 'S-1-5-32-544' }) as any;
    NONE(out, '1111111111', '1105');
    expect(out.a).toBe(out.b.split('\\')[1]);
    expect(out.c).toBe('S-1-5-18');
    expect(out.d).toBe('S-1-5-32-544');
  });

  it('handles numeric ids and object keys', () => {
    const out = redactCapture({
      tenant_id: 11772, severity: 5, total: 2000, score: 87,
      byHost: { 'ACME-LT-01': 1 }, hostname: 'ACME-LT-01', byTenant: { '11772': 3 },
    }) as any;
    NONE(out, '11772', 'acme');
    expect(typeof out.tenant_id).toBe('number');
    expect(out.severity).toBe(5);
    expect(out.total).toBe(2000);
    expect(out.score).toBe(87);
  });
});

describe('redactCapture: vendor product names', () => {
  const endpoints = () => [{
    id: 'a1b2c3d4-0000-4000-8000-aaaaaaaaaaaa',
    type: 'computer',
    hostname: 'LAPTOP-ACME42',
    health: { overall: 'good', services: { status: 'good', serviceDetails: [{ name: 'Sophos MCS Agent', status: 'running' }, { name: 'Sophos Endpoint Defense Service', status: 'running' }] } },
    os: { platform: 'windows', name: 'Windows 11 Pro' },
    associatedPerson: { name: 'ACME\\jdoe', viaLogin: 'ACME\\jdoe', id: 'f1f1f1f1-0000-4000-8000-bbbbbbbbbbbb' },
    assignedProducts: [{ code: 'xdr', version: '1.0', status: 'installed' }, { code: 'coreAgent', version: '2.0', status: 'installed' }],
    packages: { protection: { assignedId: 'XDR', name: 'xdr', available: [{ id: 'XDRSensor', name: 'xdr' }, { id: 'interceptX', name: 'Intercept X Advanced' }] } },
    note: 'xdr sensor on LAPTOP-ACME42',
  }];

  it('keeps product codes, product names and enum tokens; still pseudonymises customer data', () => {
    const out = redactCapture(endpoints()) as any;
    const e = out[0];
    expect(e.assignedProducts.map((p: any) => p.code)).toEqual(['xdr', 'coreAgent']);
    expect(e.packages.protection.name).toBe('xdr');
    expect(e.packages.protection.available[1].name).toBe('Intercept X Advanced');
    expect(e.health.services.serviceDetails[0].name).toBe('Sophos MCS Agent');
    expect(e.os).toEqual({ platform: 'windows', name: 'Windows 11 Pro' });
    expect(e.type).toBe('computer');
    expect(e.hostname).toBe('host-001');
    expect(e.note).toBe('xdr sensor on host-001');
    expect(text(out)).not.toMatch(/acme|jdoe|a1b2c3d4/i);
  });

  it('never learns short or well-known tokens from a default-deny name key', () => {
    const out = redactCapture({ widget: { name: 'xdr' }, other: { name: 'Mtr' }, text: 'xdr and mtr stay; ab too' }) as any;
    expect(out.text).toBe('xdr and mtr stay; ab too');
  });
});

describe('redactCaptureSet', () => {
  it('keeps output file names and manifest keys, redacts values only', () => {
    const out = redactCaptureSet(
      { 'xdr-detection-search': { widget: { name: 'xdr' }, hostname: 'PC-1234' } },
      { 'xdr-detection-search': { status: 'ok', note: 'PC-1234 xdr' } },
    );
    expect(Object.keys(out.raw)).toEqual(['xdr-detection-search']);
    expect(Object.keys(out.manifest)).toEqual(['xdr-detection-search']);
    expect(text(out)).not.toMatch(/PC-1234/i);
  });
});

describe('redactCapture: product exemption is confined to product containers', () => {
  it('still pseudonymises person/host-like names below product-ish ancestors', () => {
    const out = redactCapture({
      packages: { x: { owner: { name: 'Jane Doe' } } },
      platform: { name: 'ACME-SRV-9' },
      features: [{ name: 'Acme Corp VPN' }],
      services: { serviceDetails: [{ name: 'jdoe-laptop' }] },
      note: 'Jane Doe uses ACME-SRV-9 with Acme Corp VPN on jdoe-laptop',
    }) as any;
    expect(text(out)).not.toMatch(/jane|doe|acme|jdoe/i);
  });

  it('keeps real-capture shapes: Sophos services, OS names, package tokens', () => {
    const out = redactCapture({
      os: { name: 'Windows 11 Pro ' },
      health: { services: { serviceDetails: [{ name: 'Sophos MCS Agent' }, { name: 'HitmanPro.Alert service' }] } },
      packages: { ztna: { name: 'ZTNA', available: [{ id: 'z', name: 'ZTNA' }] } },
      modules: [{ name: 'interceptX' }],
    }) as any;
    expect(out.os.name).toBe('Windows 11 Pro ');
    expect(out.health.services.serviceDetails.map((s: any) => s.name)).toEqual(['Sophos MCS Agent', 'HitmanPro.Alert service']);
    expect(out.packages.ztna.name).toBe('ZTNA');
    expect(out.modules[0].name).toBe('interceptX');
  });
});

describe('redactCaptureSet pseudonym sharing', () => {
  it('uses one pseudonym for a value in raw and manifest', () => {
    const out = redactCaptureSet({ a: { hostname: 'PC-1234' } }, { a: { status: 'ok', note: 'failed on PC-1234' } });
    expect((out.raw.a as any).hostname).toBe('host-001');
    expect(out.manifest.a.note).toBe('failed on host-001');
  });
});
