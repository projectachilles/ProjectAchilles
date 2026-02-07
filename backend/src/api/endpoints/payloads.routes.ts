/**
 * Payloads API Routes
 */

import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { payloadsService } from '../../services/endpoints/payloads.service.js';
import { requireAuth, getCredentials } from '../../middleware/auth.middleware.js';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const ALLOWED_UPLOAD_DIR = path.join(os.homedir(), '.projectachilles', 'builds');

const router = Router();

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/lc-uploads',
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
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

    // C1: Confine file reads to the builds directory to prevent arbitrary file read
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(ALLOWED_UPLOAD_DIR + path.sep) && resolvedPath !== ALLOWED_UPLOAD_DIR) {
      throw new AppError('File path must be within the builds directory', 403);
    }

    const result = await payloadsService.uploadPayload(credentials, resolvedPath);

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

    // H3: Sanitize name to prevent path traversal in temp file path
    const safeName = path.basename(req.params.name);
    const tempPath = path.join('/tmp', `lc-download-${Date.now()}-${safeName}`);

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
