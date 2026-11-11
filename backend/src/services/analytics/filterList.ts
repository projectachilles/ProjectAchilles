/**
 * Filter-bar list params (hostnames, tests, bundleNames, ...) travel as one
 * comma-separated string. A comma or backslash inside a value is escaped as
 * "\," / "\\", so a name such as "Wiper, Stage 2" survives the round trip;
 * unescaped lists ("a,b") parse as before. Mirrored in
 * frontend/src/lib/filterList.ts.
 */
export function splitFilterList(value: unknown): string[] {
  // A repeated query param (?tests=a&tests=b) arrives as an array: each
  // element is a list of its own. Anything that is not a string is no list.
  if (Array.isArray(value)) return value.flatMap((v) => splitFilterList(v));
  if (typeof value !== 'string' || value === '') return [];
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && (value[i + 1] === ',' || value[i + 1] === '\\')) {
      current += value[i + 1];
      i++;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((v) => v.trim()).filter(Boolean);
}

/** The inverse of splitFilterList. */
export function joinFilterList(values: readonly string[]): string {
  return values.map((v) => v.replace(/\\/g, '\\\\').replace(/,/g, '\\,')).join(',');
}
