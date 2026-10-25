/**
 * Lightweight zod-schema introspection that turns a provider's `inputSchema()`
 * into an ordered list of form fields the Ink wizard can render. Uses zod v4's
 * `_def.type` discriminator and unwraps `.default()` / `.optional()`.
 */

import type { z } from 'zod';

export interface FieldMeta {
  name: string;
  kind: 'string' | 'enum' | 'boolean';
  /** For enum fields, the allowed values. */
  options?: string[];
  default?: unknown;
  required: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function unwrap(schema: any): { inner: any; default: unknown; required: boolean } {
  let current = schema;
  let def: unknown;
  let required = true;
  while (current?._def) {
    const type = current._def.type;
    if (type === 'default') {
      def = current._def.defaultValue;
      required = false;
      current = current._def.innerType;
    } else if (type === 'optional' || type === 'nullable') {
      required = false;
      current = current._def.innerType;
    } else {
      break;
    }
  }
  return { inner: current, default: def, required };
}

export function fieldsFromSchema(schema: z.ZodType): FieldMeta[] {
  const shape = (schema as any).shape;
  if (!shape) return [];

  const fields: FieldMeta[] = [];
  for (const [name, raw] of Object.entries<any>(shape)) {
    const { inner, default: def, required } = unwrap(raw);
    const type = inner?._def?.type;
    if (type === 'enum') {
      const options: string[] = inner.options ?? [];
      fields.push({ name, kind: 'enum', options, default: def, required });
    } else if (type === 'boolean') {
      fields.push({ name, kind: 'boolean', default: def, required });
    } else {
      fields.push({ name, kind: 'string', default: def, required });
    }
  }
  return fields;
}
