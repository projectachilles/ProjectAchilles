/**
 * schema-form introspection tests — zod schemas map to the right field kinds,
 * unwrap defaults/optionals, and preserve order.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { fieldsFromSchema } from '../schema-form.js';

describe('fieldsFromSchema', () => {
  it('classifies string, enum, and boolean fields with defaults', () => {
    const schema = z.object({
      domain: z.string().min(1),
      tlsMode: z.enum(['acme-http', 'internal']).default('acme-http'),
      seed: z.boolean().default(false),
      token: z.string().default(''),
    });
    const fields = fieldsFromSchema(schema);

    expect(fields.map((f) => f.name)).toEqual(['domain', 'tlsMode', 'seed', 'token']);

    const domain = fields.find((f) => f.name === 'domain')!;
    expect(domain.kind).toBe('string');
    expect(domain.required).toBe(true);

    const tls = fields.find((f) => f.name === 'tlsMode')!;
    expect(tls.kind).toBe('enum');
    expect(tls.options).toEqual(['acme-http', 'internal']);
    expect(tls.default).toBe('acme-http');
    expect(tls.required).toBe(false);

    const seed = fields.find((f) => f.name === 'seed')!;
    expect(seed.kind).toBe('boolean');
    expect(seed.default).toBe(false);
  });

  it('returns [] for an empty object schema', () => {
    expect(fieldsFromSchema(z.object({}))).toEqual([]);
  });

  it('treats optional fields as not required', () => {
    const fields = fieldsFromSchema(z.object({ x: z.string().optional() }));
    expect(fields[0].required).toBe(false);
  });
});
