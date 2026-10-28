/**
 * A tag as stored: trimmed, lowercased, 1-32 characters of a-z 0-9 . _ : -
 * starting with a letter or digit, so "Finance " and "finance" are one group.
 * Null when the input can't be a tag.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._:-]{0,31}$/.test(tag) ? tag : null;
}
