import { put, del, head, list } from '@vercel/blob';

/**
 * Thin wrapper around Vercel Blob storage.
 * Provides a key-value interface with path-like prefixes.
 *
 * Key naming convention:
 *   settings/analytics.json
 *   settings/tests.json
 *   settings/agent-settings.json
 *   certs/cert-<timestamp>/cert.pfx
 *   certs/cert-<timestamp>/cert-meta.json
 *   certs/active-cert.txt
 *   binaries/<os>-<arch>/<filename>
 *   builds/<uuid>/build-meta.json
 */

export async function blobWrite(key: string, data: Buffer | string): Promise<string> {
  const blob = await put(key, data, { access: 'public', addRandomSuffix: false });
  return blob.url;
}

export async function blobRead(key: string): Promise<Buffer | null> {
  try {
    const metadata = await head(key);
    if (!metadata) return null;
    const response = await fetch(metadata.url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

export async function blobReadText(key: string): Promise<string | null> {
  const data = await blobRead(key);
  return data ? data.toString('utf-8') : null;
}

export async function blobExists(key: string): Promise<boolean> {
  try {
    const metadata = await head(key);
    return !!metadata;
  } catch {
    return false;
  }
}

export async function blobDelete(key: string): Promise<void> {
  try {
    await del(key);
  } catch {
    // Ignore delete errors for non-existent keys
  }
}

export async function blobHead(key: string): Promise<{ size: number; url: string } | null> {
  try {
    const metadata = await head(key);
    if (!metadata) return null;
    return { size: metadata.size, url: metadata.url };
  } catch {
    return null;
  }
}

export async function blobList(prefix: string): Promise<{ key: string; url: string; size: number }[]> {
  const result = await list({ prefix });
  return result.blobs.map(b => ({
    key: b.pathname,
    url: b.url,
    size: b.size,
  }));
}

export async function blobUrl(key: string): Promise<string | null> {
  try {
    const metadata = await head(key);
    return metadata?.url ?? null;
  } catch {
    return null;
  }
}
