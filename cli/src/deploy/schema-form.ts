/**
 * Lightweight zod-schema introspection that turns a provider's `inputSchema()`
 * into an ordered list of form fields the Ink wizard can render. Uses zod v3's
 * stable `_def.typeName` discriminator and unwraps `.default()` / `.optional()`.
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
    const tn = current._def.typeName;
    if (tn === 'ZodDefault') {
      def = current._def.defaultValue();
      required = false;
      current = current._def.innerType;
    } else if (tn === 'ZodOptional' || tn === 'ZodNullable') {
      required = false;
      current = current._def.innerType;
    } else {
      break;
    }
  }
  return { inner: current, default: def, required };
}

export function fieldsFromSchema(schema: z.ZodTypeAny): FieldMeta[] {
  const obj = schema as any;
  const shape = typeof obj._def?.shape === 'function' ? obj._def.shape() : obj.shape;
  if (!shape) return [];

  const fields: FieldMeta[] = [];
  for (const [name, raw] of Object.entries<any>(shape)) {
    const { inner, default: def, required } = unwrap(raw);
    const tn = inner?._def?.typeName;
    if (tn === 'ZodEnum') {
      const options: string[] = inner.options ?? inner._def?.values ?? [];
      fields.push({ name, kind: 'enum', options, default: def, required });
    } else if (tn === 'ZodBoolean') {
      fields.push({ name, kind: 'boolean', default: def, required });
    } else {
      fields.push({ name, kind: 'string', default: def, required });
    }
  }
  return fields;
}
