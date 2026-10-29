import { describe, it, expect, afterEach } from 'vitest';
import { requireDeploymentScopeForEdrWrite, EDR_ENV_PREFIX } from '../edrScope.middleware.js';
import { EDR_VENDOR_KEYS } from '../../services/outcomes/vendors.js';

afterEach(() => { delete process.env.REQUIRE_ORG_ISOLATION; });

describe('requireDeploymentScopeForEdrWrite', () => {
  it('passes through outside multi-tenant mode', () => {
    let arg: unknown = 'unset';
    requireDeploymentScopeForEdrWrite({} as never, {} as never, (e?: unknown) => { arg = e; });
    expect(arg).toBeUndefined();
  });

  it("names every registry vendor's env-var family in the 403", () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    let err: { message: string; statusCode?: number } | undefined;
    requireDeploymentScopeForEdrWrite({} as never, {} as never, (e?: unknown) => { err = e as typeof err; });
    expect(err?.statusCode).toBe(403);
    expect(err?.message).toContain('Configure them with the DEFENDER_*, CROWDSTRIKE_*, SENTINELONE_* or SOPHOS_* environment variables.');
    for (const k of EDR_VENDOR_KEYS) expect(err?.message).toContain(`${EDR_ENV_PREFIX[k]}_*`);
  });
});
