import crypto from 'crypto';
import path from 'path';
import type { Response } from 'express';
import { AppError } from '../../middleware/error.middleware.js';
import { blobRead, blobReadText, blobUrl } from '../storage.js';

export interface BinaryInfo {
  url: string;
  sha256: string;
  size: number;
  name: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A name that is one path segment: no separator, not `.` or `..`, not empty. */
function isPlainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
}

/**
 * The file names a build record offers to agents: `filename`, the older
 * `binary_name`, and each `binaries[os].filename`; `<uuid>` and `<uuid>.exe`
 * for a record that names none. Same rule as backend/ (testArtifacts.ts).
 */
export function servableBinaryNames(meta: unknown, testUuid: string): string[] {
  if (!isRecord(meta)) return [];
  const names = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && isPlainName(value) && !value.startsWith('.')) names.add(value);
  };
  add(meta.filename);
  add(meta.binary_name);
  if (isRecord(meta.binaries)) {
    for (const entry of Object.values(meta.binaries)) {
      if (isRecord(entry)) add(entry.filename);
    }
  }
  if (names.size === 0) {
    add(testUuid);
    add(`${testUuid}.exe`);
  }
  return [...names];
}

/**
 * Resolve a test binary from Blob storage, verify it exists, and compute its SHA256 hash and size.
 *
 * Only a file the build record lists is a test binary: `builds/<uuid>/` also
 * holds the record itself, and anything else stored there is answered like a
 * file that is not there.
 */
export async function getBinaryInfo(testUuid: string, binaryName: string): Promise<BinaryInfo> {
  const notFound = (): AppError => new AppError(`Binary not found: ${path.basename(binaryName)}`, 404);

  if (!isPlainName(testUuid)) throw notFound();

  let meta: unknown;
  try {
    const metaJson = await blobReadText(`builds/${testUuid}/build-meta.json`);
    meta = metaJson ? JSON.parse(metaJson) : null;
  } catch {
    throw notFound(); // unreadable record: nothing is known to be a binary
  }

  // The served name is the one from the record, found by equality: the
  // request only selects among the listed names and never becomes a key.
  const listedName = servableBinaryNames(meta, testUuid).find(name => name === binaryName);
  if (!listedName) throw notFound();

  const blobKey = `builds/${testUuid}/${listedName}`;
  const buffer = await blobRead(blobKey);

  if (!buffer) throw notFound();

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const url = await blobUrl(blobKey);

  return {
    url: url!,
    sha256,
    size: buffer.length,
    name: listedName,
  };
}

/**
 * Redirect to the Blob URL for binary download.
 * On serverless, streaming large files risks hitting response body limits,
 * so we redirect to the CDN-backed Blob URL instead.
 */
export function redirectToBinary(binaryUrl: string, binaryName: string, res: Response): void {
  const safeName = binaryName.replace(/["\r\n\\]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.redirect(302, binaryUrl);
}
