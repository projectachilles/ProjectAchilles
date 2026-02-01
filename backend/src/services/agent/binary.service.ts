import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Response } from 'express';
import { AppError } from '../../middleware/error.middleware.js';

const BUILDS_DIR = path.join(os.homedir(), '.projectachilles', 'builds');

export interface BinaryInfo {
  path: string;
  sha256: string;
  size: number;
  name: string;
}

/**
 * Resolve a test binary, verify it exists, and compute its SHA256 hash and size.
 */
export async function getBinaryInfo(testUuid: string, binaryName: string): Promise<BinaryInfo> {
  // Prevent path traversal
  const safeName = path.basename(binaryName);
  const safeUuid = path.basename(testUuid);

  const binaryPath = path.join(BUILDS_DIR, safeUuid, safeName);

  if (!fs.existsSync(binaryPath)) {
    throw new AppError(`Binary not found: ${safeName}`, 404);
  }

  const stat = fs.statSync(binaryPath);
  const sha256 = await computeSha256(binaryPath);

  return {
    path: binaryPath,
    sha256,
    size: stat.size,
    name: safeName,
  };
}

/**
 * Stream a binary file to the Express response with appropriate headers.
 */
export function streamBinary(binaryPath: string, binaryName: string, res: Response): void {
  const stat = fs.statSync(binaryPath);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${binaryName}"`);

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
