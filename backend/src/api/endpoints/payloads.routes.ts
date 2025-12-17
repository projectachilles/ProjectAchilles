/**
 * Payloads API Routes
 */

import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import crypto from 'crypto';
import { payloadsService } from '../../services/endpoints/payloads.service.js';
import { requireAuth, getCredentials } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const router = Router();

// Secure temp directory setup
const TEMP_DIR = path.join(os.tmpdir(), 'projectachilles-uploads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { mode: 0o700, recursive: true });
}

// Configure multer for file uploads with secure settings
const UPLOAD_SIZE_LIMIT = parseInt(process.env.UPLOAD_SIZE_LIMIT_MB || '50', 10) * 1024 * 1024;
const upload = multer({
  dest: TEMP_DIR,
  limits: {
    fileSize: UPLOAD_SIZE_LIMIT, // Default 50MB, configurable via env
  },
  // Use cryptographically random file names
  storage: multer.diskStorage({
    destination: TEMP_DIR,
    filename: (_req, _file, cb) => {
      const randomName = crypto.randomBytes(16).toString('hex');
      cb(null, `upload-${randomName}`);
    },
  }),
});

// Apply auth middleware to all routes
router.use(requireAuth);

/**
 * POST /api/endpoints/payloads/upload
 * Upload payload to LimaCharlie storage
 */
router.post(
  '/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided',
        message: 'Please provide a file to upload',
      });
    }

    try {
      // Read file buffer
      const fileBuffer = fs.readFileSync(req.file.path);

      // Upload to LimaCharlie
      const result = await payloadsService.uploadPayloadFromBuffer(
        credentials,
        req.file.originalname,
        fileBuffer
      );

      // Clean up temp file
      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        data: {
          name: result.name,
          message: `Payload '${result.name}' uploaded successfully`,
        },
      });
    } catch (error) {
      // Clean up temp file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      throw error;
    }
  })
);

// Allowed directories for upload-from-path (configurable)
const ALLOWED_UPLOAD_DIRS = (process.env.ALLOWED_UPLOAD_DIRS || '/tmp,/var/uploads').split(',').map(d => d.trim());

/**
 * Validate file path to prevent path traversal attacks
 */
function isPathAllowed(filePath: string): boolean {
  // Resolve to absolute path and normalize
  const resolvedPath = path.resolve(filePath);

  // Check for path traversal patterns
  if (filePath.includes('..') || filePath.includes('\0')) {
    return false;
  }

  // Check if path is within allowed directories
  return ALLOWED_UPLOAD_DIRS.some(allowedDir => {
    const resolvedAllowed = path.resolve(allowedDir);
    return resolvedPath.startsWith(resolvedAllowed + path.sep) || resolvedPath === resolvedAllowed;
  });
}

/**
 * POST /api/endpoints/payloads/upload-from-path
 * Upload payload from server file path (for internal use)
 */
router.post(
  '/upload-from-path',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { filePath } = z
      .object({
        filePath: z.string().min(1, 'File path is required'),
      })
      .parse(req.body);

    // Validate path to prevent traversal attacks
    if (!isPathAllowed(filePath)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file path',
        message: 'File path must be within allowed directories and cannot contain path traversal sequences',
      });
    }

    // Reject symbolic links to prevent symlink attacks
    try {
      const stats = fs.lstatSync(filePath);
      if (stats.isSymbolicLink()) {
        return res.status(400).json({
          success: false,
          error: 'Symbolic links not allowed',
        });
      }
    } catch {
      // File doesn't exist - let uploadPayload handle this error
    }

    const result = await payloadsService.uploadPayload(credentials, filePath);

    res.json({
      success: true,
      data: {
        name: result.name,
        message: `Payload '${result.name}' uploaded successfully`,
      },
    });
  })
);

/**
 * GET /api/endpoints/payloads/:name/download-url
 * Get download URL for payload
 */
router.get(
  '/:name/download-url',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const result = await payloadsService.getDownloadUrl(
      credentials,
      req.params.name
    );

    res.json({
      success: true,
      data: {
        url: result.url,
        name: req.params.name,
      },
    });
  })
);

/**
 * GET /api/endpoints/payloads/:name/download
 * Download payload (proxied through backend)
 */
router.get(
  '/:name/download',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Create secure temp download path with random name
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const tempPath = path.join(TEMP_DIR, `download-${randomSuffix}`);

    try {
      const filePath = await payloadsService.downloadPayload(
        credentials,
        req.params.name,
        tempPath
      );

      // Send file to client
      res.download(filePath, req.params.name, (err) => {
        // Clean up temp file after download
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        if (err) {
          console.error('Download error:', err);
        }
      });
    } catch (error) {
      // Clean up temp file on error
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  })
);

/**
 * GET /api/endpoints/payloads
 * List all payloads
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const payloads = await payloadsService.listPayloads(credentials);

    res.json({
      success: true,
      data: {
        payloads,
        count: payloads.length,
      },
    });
  })
);

/**
 * DELETE /api/endpoints/payloads/:name
 * Delete payload
 */
router.delete(
  '/:name',
  asyncHandler(async (req, res) => {
    const credentials = getCredentials(req);
    if (!credentials) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    await payloadsService.deletePayload(credentials, req.params.name);

    res.json({
      success: true,
      message: `Payload '${req.params.name}' deleted successfully`,
    });
  })
);

export default router;
