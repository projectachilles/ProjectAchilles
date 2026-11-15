/**
 * config-writer tests — correct KEY=value emission, ordering, omission of
 * undefined values, and that the file lands at mode 0600 (secrets on disk).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { renderConfig, writeConfig } from '../config-writer.js';

describe('renderConfig', () => {
  it('emits known keys in file order and skips undefined values', () => {
    const body = renderConfig({
      CLERK_SECRET_KEY: 'sk_live_x',
      ACHILLES_DOMAIN: 'achilles.example.com',
      TLS_MODE: 'acme-http',
    });
    // Match KEY=value lines only (skip the comment banner, whose dividers
    // contain '=' too).
    const lines = body.split('\n').filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l));
    // ACHILLES_DOMAIN precedes TLS_MODE precedes CLERK_SECRET_KEY in KEY_ORDER.
    expect(lines).toEqual([
      'ACHILLES_DOMAIN=achilles.example.com',
      'TLS_MODE=acme-http',
      'CLERK_SECRET_KEY=sk_live_x',
    ]);
  });

  it('omits keys that are not provided', () => {
    const body = renderConfig({ ACHILLES_DOMAIN: 'x' });
    expect(body).not.toMatch(/SESSION_SECRET/);
    expect(body).toMatch(/ACHILLES_DOMAIN=x/);
  });
});

describe('renderConfig values the deploy scripts source', () => {
  it('leaves plain values unquoted', () => {
    const body = renderConfig({
      ACHILLES_DOMAIN: 'achilles.example.com',
      ACME_EMAIL: 'ops@example.com',
      TESTS_REPO_URL: 'https://github.com/example/tests.git',
      SSH_PORT: '22',
    });
    expect(body).toContain('ACHILLES_DOMAIN=achilles.example.com\n');
    expect(body).toContain('ACME_EMAIL=ops@example.com\n');
    expect(body).toContain('TESTS_REPO_URL=https://github.com/example/tests.git\n');
  });

  it('refuses a value with a line break, which could add its own assignment', () => {
    expect(() => renderConfig({ ACHILLES_DOMAIN: 'a.example.com\nSSH_HOST=attacker.example.com' }))
      .toThrow(/ACHILLES_DOMAIN contains a line break/);
    expect(() => renderConfig({ CADDY_DNS_TOKEN: 'abc\r' })).toThrow(/line break/);
  });
});

describe('writeConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'achilles-deploy-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes deploy.config.env at mode 0600', () => {
    const path = writeConfig(dir, { ACHILLES_DOMAIN: 'achilles.example.com' });
    expect(path).toBe(join(dir, 'deploy.config.env'));

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const content = readFileSync(path, 'utf-8');
    expect(content).toMatch(/ACHILLES_DOMAIN=achilles\.example\.com/);
  });

  it('round-trips hostile and awkward values through bash without running anything', () => {
    const marker = join(dir, 'pwned');
    const values = {
      ACHILLES_DOMAIN: `x.example.com$(touch ${marker})`,
      CADDY_DNS_TOKEN: `tok\`touch ${marker}\`; touch ${marker} #`,
      CLERK_SECRET_KEY: "it's $HOME & \"quoted\" \\ value",
      ELASTICSEARCH_API_KEY: 'has spaces and = signs',
    };
    const path = writeConfig(dir, values);

    // Exactly what the deploy scripts do: source the file, then read the values.
    const out = execFileSync('bash', ['-c', [
      'set -a; . "$1"; set +a',
      'printf "%s\\0" "$ACHILLES_DOMAIN" "$CADDY_DNS_TOKEN" "$CLERK_SECRET_KEY" "$ELASTICSEARCH_API_KEY"',
    ].join('\n'), 'bash', path], { encoding: 'utf-8' });

    expect(out.split('\0').slice(0, 4)).toEqual(Object.values(values));
    expect(() => statSync(marker)).toThrow();
  });
});
