import crypto from 'crypto';
import path from 'path';
import type { Response } from 'express';
import { AppError } from '../../middleware/error.middleware.js';
import { blobRead, blobUrl } from '../storage.js';

export interface BinaryInfo {
  url: string;
  sha256: string;
  size: number;
  name: string;
}

/**
 * Resolve a test binary from Blob storage, verify it exists, and compute its SHA256 hash and size.
 */
export async function getBinaryInfo(testUuid: string, binaryName: string): Promise<BinaryInfo> {
  // Prevent path traversal
  const safeName = path.basename(binaryName);
  const safeUuid = path.basename(testUuid);

  const blobKey = `builds/${safeUuid}/${safeName}`;
  const buffer = await blobRead(blobKey);

  if (!buffer) {
    throw new AppError(`Binary not found: ${safeName}`, 404);
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const url = await blobUrl(blobKey);

  return {
    url: url!,
    sha256,
    size: buffer.length,
    name: safeName,
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
