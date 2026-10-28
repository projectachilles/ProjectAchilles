/**
 * Deep copy of an ES query/clause tree with order-insensitive parts sorted, so
 * a snapshot taken before a refactor still matches when a list is rebuilt in a
 * different order. Sorted: every array under a `should` key and every `terms`
 * value array. Everything else (filter order, field names, values) must match.
 */
export function normalizeClauses(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeClauses);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'should' && Array.isArray(v)) {
      out[k] = sortByJson(v.map(normalizeClauses));
    } else if (k === 'terms' && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([field, vals]) => [
          field,
          Array.isArray(vals) ? sortByJson(vals) : normalizeClauses(vals),
        ]),
      );
    } else {
      out[k] = normalizeClauses(v);
    }
  }
  return out;
}

function sortByJson(values: unknown[]): unknown[] {
  return [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
