import { describe, it, expect } from 'vitest';
import { CreateApiKeySchema } from '../../schemas/apiKeys.schemas.js';

describe('CreateApiKeySchema scope', () => {
  it('accepts all three scopes', () => {
    for (const scope of ['read', 'read-write', 'admin']) {
      const parsed = CreateApiKeySchema.safeParse({ name: 'k', scope });
      expect(parsed.success, `scope ${scope} should parse`).toBe(true);
    }
  });

  it('rejects an unknown scope', () => {
    const parsed = CreateApiKeySchema.safeParse({ name: 'k', scope: 'superuser' });
    expect(parsed.success).toBe(false);
  });
});
