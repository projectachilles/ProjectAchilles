/**
 * config-writer tests — correct KEY=value emission, ordering, omission of
 * undefined values, and that the file lands at mode 0600 (secrets on disk).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'fs';
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
});
