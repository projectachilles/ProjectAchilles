// Structural check of the Sophos XDR GraphQL documents against det.graphql
// (graphql-js is not a dependency): every selected field must exist on its
// parent type, object/union-typed fields need a sub-selection, leaf fields
// (scalars, enums) must not have one, and inline fragments must name a member
// of the union. The schema is a verbatim excerpt of the published det.graphql
// (schema/det-excerpt.graphql), because docs/superpowers/ is not in git.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SOPHOS_CAPTURE_DETECTION_BY_ID_QUERY,
  SOPHOS_CAPTURE_DETECTION_SEARCH_QUERY,
  SOPHOS_DETECTION_CAPTURE_FIELDS,
  SOPHOS_DETECTION_POLL_QUERY,
  SOPHOS_DETECTION_SEARCH_QUERY,
  SOPHOS_DETECTION_SYNC_FIELDS,
  detectionByIdVariables,
  detectionCql,
  detectionPollVariables,
  detectionSearchVariables,
} from '../detection-query.js';

const dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- mini schema

interface Schema {
  fields: Map<string, Map<string, string>>; // object / input / interface type -> field -> named type
  unions: Map<string, Set<string>>;
  leaves: Set<string>; // enums + scalars
}

const BUILTIN_SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);

/** Remove descriptions, comments and (possibly nested) argument / directive parentheses. */
function stripNoise(text: string): string {
  let s = text.replace(/"""[\s\S]*?"""/g, '').replace(/"(?:[^"\\\n]|\\.)*"/g, '').replace(/#[^\n]*/g, '');
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/\([^()]*\)/g, ''); }
  return s;
}

function parseSchema(sdl: string): Schema {
  const schema: Schema = { fields: new Map(), unions: new Map(), leaves: new Set() };
  const s = stripNoise(sdl);
  for (const m of s.matchAll(/^\s*union\s+(\w+)[^=]*=\s*([^\n]+)/gm)) {
    schema.unions.set(m[1], new Set(m[2].split('|').map((x) => x.trim()).filter(Boolean)));
  }
  for (const m of s.matchAll(/^\s*(?:scalar|enum)\s+(\w+)/gm)) schema.leaves.add(m[1]);
  for (const m of s.matchAll(/^\s*(?:type|input|interface)\s+(\w+)[^{]*\{([^}]*)\}/gm)) {
    const fields = new Map<string, string>();
    for (const f of m[2].matchAll(/^\s*(\w+)\s*:\s*\[*\s*(\w+)/gm)) fields.set(f[1], f[2]);
    schema.fields.set(m[1], fields);
  }
  return schema;
}

const schema = parseSchema(readFileSync(join(dir, 'schema', 'det-excerpt.graphql'), 'utf8'));

// ---------------------------------------------------------------- selection validator

function validate(document: string): string[] {
  const errors: string[] = [];
  const body = stripNoise(document).replace(/^\s*query\s+\w*/, '');
  const tokens = body.match(/\.\.\.|[{}]|\w+/g) ?? [];
  let i = 0;
  const isLeaf = (t: string) => BUILTIN_SCALARS.has(t) || schema.leaves.has(t);
  const isComposite = (t: string) => schema.fields.has(t) || schema.unions.has(t);

  function selection(typeName: string, path: string): void {
    if (tokens[i] !== '{') { errors.push(`${path}: expected '{'`); return; }
    i++;
    while (i < tokens.length && tokens[i] !== '}') {
      const tok = tokens[i++];
      if (tok === '...') {
        if (tokens[i] !== 'on') { errors.push(`${path}: only inline fragments are supported`); return; }
        const frag = tokens[i + 1];
        i += 2;
        const members = schema.unions.get(typeName);
        if (frag !== typeName && !members?.has(frag)) errors.push(`${path}: ${frag} is not a member of ${typeName}`);
        if (!schema.fields.has(frag)) errors.push(`${path}: unknown fragment type ${frag}`);
        selection(frag, `${path}<${frag}>`);
        continue;
      }
      if (tok === '__typename') continue;
      const fieldType = schema.fields.get(typeName)?.get(tok);
      const fieldPath = `${path}.${tok}`;
      if (!fieldType) {
        errors.push(`${fieldPath}: no such field on ${typeName}`);
        if (tokens[i] === '{') selection('__unknown__', fieldPath);
        continue;
      }
      if (tokens[i] === '{') {
        if (!isComposite(fieldType)) errors.push(`${fieldPath}: ${fieldType} is a leaf type and takes no selection`);
        selection(fieldType, fieldPath);
      } else if (!isLeaf(fieldType)) {
        errors.push(`${fieldPath}: ${fieldType} is an object type and needs a selection`);
      }
    }
    i++; // '}'
  }

  selection('Query', 'Query');
  if (i !== tokens.length) errors.push(`trailing tokens after the operation: ${tokens.slice(i).join(' ')}`);
  return errors;
}

/** Top-level `in` keys must exist on the operation's input type. */
function variableErrors(inputType: string, variables: { in: Record<string, unknown> }): string[] {
  const fields = schema.fields.get(inputType);
  if (!fields) return [`unknown input type ${inputType}`];
  return Object.keys(variables.in).filter((k) => !fields.has(k)).map((k) => `${inputType}.${k}: no such input field`);
}

// ---------------------------------------------------------------- tests

describe('Sophos detection GraphQL documents are valid against det.graphql', () => {
  it.each([
    ['sync detectionSearch', SOPHOS_DETECTION_SEARCH_QUERY],
    ['sync detectionPoll', SOPHOS_DETECTION_POLL_QUERY],
    ['capture detectionSearch', SOPHOS_CAPTURE_DETECTION_SEARCH_QUERY],
    ['capture detectionRetrieveById', SOPHOS_CAPTURE_DETECTION_BY_ID_QUERY],
  ])('%s', (_name, query) => {
    expect(validate(query)).toEqual([]);
    expect(query).not.toMatch(/\b(mutation|subscription)\b/);
  });

  it('variables use the documented input fields', () => {
    expect(variableErrors('SearchRequestInput', detectionSearchVariables(detectionCql(90), 0, 500))).toEqual([]);
    expect(variableErrors('PollRequestInput', detectionPollVariables('s1'))).toEqual([]);
    expect(variableErrors('GetByIDRequestInput', detectionByIdVariables(['alert:1']))).toEqual([]);
  });

  it('the capture fields are a superset of what the sync reads', () => {
    const top = (fields: string) => {
      const out: string[] = [];
      let depth = 0;
      for (const t of fields.match(/[{}]|\w+/g) ?? []) {
        if (t === '{') depth++;
        else if (t === '}') depth--;
        else if (depth === 0) out.push(t);
      }
      return out;
    };
    expect(top(SOPHOS_DETECTION_CAPTURE_FIELDS)).toEqual(expect.arrayContaining(top(SOPHOS_DETECTION_SYNC_FIELDS)));
  });

  it('detectionCql uses whole minutes, at least one', () => {
    expect(detectionCql(61.2)).toBe('from alert earliest=-62m');
    expect(detectionCql(0)).toBe('from alert earliest=-1m');
  });
});

describe('the validator itself', () => {
  const wrap = (alertFields: string) => `query Q($in: SearchRequestInput) { detectionSearch(in: $in) { alerts { list { ${alertFields} } } } }`;

  it('rejects the old capture selection (Timestamp without { seconds nanos })', () => {
    expect(validate(wrap('id metadata { title created_at origin }'))).toEqual([
      'Query.detectionSearch.alerts.list.metadata.created_at: Timestamp is an object type and needs a selection',
    ]);
  });

  it('rejects unknown fields, a selection on a leaf, a bad fragment and a union field without a fragment', () => {
    expect(validate(wrap('nope'))).toEqual(['Query.detectionSearch.alerts.list.nope: no such field on Alert2']);
    expect(validate(wrap('status { x }'))).toContain('Query.detectionSearch.alerts.list.status: ResolutionStatus is a leaf type and takes no selection');
    expect(validate(wrap('source_entities { properties { ... on Alert2 { id } } }')))
      .toContain('Query.detectionSearch.alerts.list.source_entities.properties: Alert2 is not a member of Properties');
    expect(validate(wrap('source_entities { properties { hostname } }')))
      .toContain('Query.detectionSearch.alerts.list.source_entities.properties.hostname: no such field on Properties');
    expect(validate(wrap('entities'))).toEqual(['Query.detectionSearch.alerts.list.entities: EntityRelationships is an object type and needs a selection']);
  });

  it('rejects unknown input fields', () => {
    expect(variableErrors('SearchRequestInput', { in: { query: 'x' } })).toEqual(['SearchRequestInput.query: no such input field']);
  });
});
