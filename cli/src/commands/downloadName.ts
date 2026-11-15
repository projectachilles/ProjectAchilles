/**
 * The local file name for a download, from the server's Content-Disposition.
 *
 * The header comes from the server, so it is a name to display, never a path
 * to trust: a compromised or impersonated server could send `/home/me/.bashrc`
 * or `../../somewhere`. Only the last path segment is kept, and anything that
 * is not a plain file name falls back to `fallback`.
 */
export function safeDownloadName(disposition: string | null | undefined, fallback: string): string {
  const raw = disposition?.match(/filename="?([^";]+)"?/i)?.[1]?.trim();
  if (!raw) return fallback;

  // Last segment under both separators, so `C:\Users\me\x` is cut down too.
  const name = raw.split(/[\\/]/).pop() ?? '';
  const plain = /^[A-Za-z0-9][A-Za-z0-9._ ()+-]{0,199}$/.test(name) && !name.includes('..');
  return plain ? name : fallback;
}
