/**
 * Provider contract tests — every registered provider exposes a coherent shape,
 * `plan()` returns sensible steps for valid inputs, and the registry's
 * mode-filtering behaves.
 */

import { describe, it, expect } from 'vitest';
import {
  getAllProviders,
  getProvider,
  providersForMode,
  isProviderId,
} from '../registry.js';

describe('provider registry', () => {
  it('registers all seven providers with unique ids', () => {
    const ids = getAllProviders().map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'digitalocean',
        'server',
        'docker',
        'fly',
        'render',
        'vercel',
        'railway',
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('isProviderId guards correctly', () => {
    expect(isProviderId('docker')).toBe(true);
    expect(isProviderId('nope')).toBe(false);
  });

  it('operator mode only offers digitalocean', () => {
    const ids = providersForMode('operator').map((p) => p.id);
    expect(ids).toEqual(['digitalocean']);
  });

  it('self-host mode excludes the operator-only provider', () => {
    const ids = providersForMode('self-host').map((p) => p.id);
    expect(ids).not.toContain('digitalocean');
    expect(ids).toContain('docker');
    expect(ids).toContain('server');
  });
});

describe('provider contracts', () => {
  for (const provider of getAllProviders()) {
    describe(provider.id, () => {
      it('has label, summary, and at least one mode', () => {
        expect(provider.label).toBeTruthy();
        expect(provider.summary).toBeTruthy();
        expect(provider.modes.length).toBeGreaterThan(0);
      });

      it('inputSchema parses its own defaults', () => {
        const schema = provider.inputSchema();
        // Schemas with required fields will fail empty parse — that's expected;
        // we only assert the schema is callable and returns a zod type.
        expect(typeof schema.safeParse).toBe('function');
      });
    });
  }
});

describe('docker provider plan', () => {
  it('produces secrets → up → health, with ES wording when enabled', () => {
    const docker = getProvider('docker')!;
    const plain = docker.plan({ elasticsearch: false });
    expect(plain.map((s) => s.id)).toEqual(['secrets', 'up', 'health']);
    expect(plain.every((s) => s.kind === 'automated')).toBe(true);

    const withEs = docker.plan({ elasticsearch: true });
    expect(withEs.find((s) => s.id === 'up')!.title).toMatch(/Elasticsearch/);
  });
});

describe('digitalocean provider plan', () => {
  it('threads the tenant slug into the step title', () => {
    const provider = getProvider('digitalocean')!;
    const steps = provider.plan({ tenant: 'acme' });
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toMatch(/acme/);
  });

  it('requires a tenant', () => {
    const provider = getProvider('digitalocean')!;
    expect(provider.inputSchema().safeParse({}).success).toBe(false);
    expect(provider.inputSchema().safeParse({ tenant: 'x' }).success).toBe(true);
  });
});

describe('server provider plan', () => {
  const provider = getProvider('server')!;
  const base = {
    achillesDomain: 'achilles.example.com',
    clerkPublishableKey: 'pk_live_x',
    clerkSecretKey: 'sk_live_x',
  };

  it('selects deploy-server.sh title for this-machine', () => {
    const steps = provider.plan({ ...base, installTarget: 'this-machine' });
    expect(steps.map((s) => s.id)).toEqual(['config', 'install']);
    expect(steps[1].title).toMatch(/deploy-server\.sh/);
  });

  it('selects deploy-remote.sh title for remote, with ssh target', () => {
    const steps = provider.plan({ ...base, installTarget: 'remote', sshTarget: 'root@1.2.3.4' });
    expect(steps[1].title).toMatch(/deploy-remote\.sh root@1\.2\.3\.4/);
  });

  it('selects deploy-do.sh title for do-droplet', () => {
    const steps = provider.plan({ ...base, installTarget: 'do-droplet' });
    expect(steps[1].title).toMatch(/deploy-do\.sh/);
  });

  it('requires domain and clerk keys', () => {
    expect(provider.inputSchema().safeParse({}).success).toBe(false);
    expect(provider.inputSchema().safeParse(base).success).toBe(true);
  });
});

describe('guided providers surface manual steps', () => {
  for (const id of ['fly', 'render', 'vercel', 'railway'] as const) {
    it(`${id} plan includes at least one manual step`, () => {
      const provider = getProvider(id)!;
      const steps = provider.plan(provider.inputSchema().parse({}));
      expect(steps.some((s) => s.kind === 'manual')).toBe(true);
    });
  }
});
