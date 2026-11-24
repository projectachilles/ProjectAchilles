import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import { AppError } from '../../middleware/error.middleware.js';
import { getBuildDir, readBuildMeta, servableBinaryNames } from './testArtifacts.js';

export interface BinaryInfo {
  path: string;
  sha256: string;
  size: number;
  name: string;
}

/**
 * Resolve a test binary, verify it exists, and compute its SHA256 hash and size.
 *
 * Only a file the build record lists is a test binary (servableBinaryNames).
 * The build folder holds other files (the record, the build marker, signing
 * leftovers, uploaded embed files): asking for one of those is answered like a
 * file that is not there.
 */
export async function getBinaryInfo(testUuid: string, binaryName: string): Promise<BinaryInfo> {
  const notFound = (): AppError => new AppError(`Binary not found: ${path.basename(binaryName)}`, 404);

  const buildDir = getBuildDir(testUuid);
  if (!buildDir) throw notFound();

  let meta: unknown;
  try {
    meta = readBuildMeta(testUuid);
  } catch {
    throw notFound(); // unreadable record: nothing is known to be a binary
  }

  // The served name is the one from the record, found by equality: the
  // request only selects among the listed names and never becomes a path.
  const listedName = servableBinaryNames(meta, testUuid).find(name => name === binaryName);
  if (!listedName) throw notFound();

  const binaryPath = path.join(buildDir, listedName);
  if (!fs.existsSync(binaryPath)) throw notFound();

  const stat = fs.statSync(binaryPath);
  const sha256 = await computeSha256(binaryPath);

  return {
    path: binaryPath,
    sha256,
    size: stat.size,
    name: listedName,
  };
}

/**
 * Stream a binary file to the Express response with appropriate headers.
 */
export function streamBinary(binaryPath: string, binaryName: string, res: Response): void {
  const stat = fs.statSync(binaryPath);

  const safeName = binaryName.replace(/["\r\n\\]/g, '_');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

  const readStream = fs.createReadStream(binaryPath);
  readStream.pipe(res);
}

/**
 * Compute SHA256 hash of a file using streaming.
 */
function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
