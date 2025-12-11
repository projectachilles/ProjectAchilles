/**
 * Authentication API Routes
 */

import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../../services/endpoints/auth.service.js';
import {
  setCredentials,
  clearCredentials,
  setCurrentOrganization,
} from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { credentialStore } from '../../services/endpoints/credential-store.service.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Validation schemas
const loginSchema = z.object({
  oid: z.string()
    .min(1, 'Organization ID is required')
    .max(256, 'Organization ID too long')
    .regex(/^[a-zA-Z0-9-_]+$/, 'Invalid organization ID format'),
  apiKey: z.string()
    .min(1, 'API Key is required')
    .max(512, 'API Key too long'),
  orgName: z.string()
    .max(256, 'Organization name too long')
    .optional(),
  saveCredentials: z.boolean().optional().default(false),
});

const switchOrgSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
});

/**
 * POST /api/auth/login
 * Login with LimaCharlie credentials
 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);

    // Validate credentials
    const credentials = { oid: body.oid, apiKey: body.apiKey };
    const isValid = await authService.validateCredentials(credentials);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Failed to authenticate with LimaCharlie',
      });
    }

    // Store credentials securely (not in session)
    const credentialId = credentialStore.store(
      credentials,
      req.session.id,
      body.saveCredentials ? undefined : 4 * 60 * 60 * 1000 // 4 hours for non-saved
    );

    // Create organization entry (without API key)
    const orgId = uuidv4();
    const orgName = body.orgName || `Org-${body.oid.substring(0, 8)}`;

    const organization = {
      id: orgId,
      name: orgName,
      oid: body.oid,
      credentialId, // Store reference, not the actual API key
    };

    // Save to session
    if (body.saveCredentials) {
      if (!req.session.organizations) {
        req.session.organizations = [];
      }

      // Check if org already exists
      const existingIndex = req.session.organizations.findIndex(
        (org) => org.oid === body.oid
      );

      if (existingIndex >= 0) {
        // Remove old credential from store
        const oldOrg = req.session.organizations[existingIndex];
        credentialStore.remove(oldOrg.credentialId);
        // Update existing
        req.session.organizations[existingIndex] = organization;
      } else {
        // Add new
        req.session.organizations.push(organization);
      }
    } else {
      // Just save this org temporarily
      req.session.organizations = [organization];
    }

    // Set as current org
    req.session.currentOrgId = orgId;
    setCredentials(req, credentials);

    res.json({
      success: true,
      data: {
        sessionId: req.session.id,
        organizations: req.session.organizations.map((org) => ({
          id: org.id,
          name: org.name,
          oid: org.oid,
        })),
        currentOrg: {
          id: organization.id,
          name: organization.name,
          oid: organization.oid,
        },
      },
    });
  })
);

/**
 * POST /api/auth/logout
 * Logout and clear session
 */
router.post('/logout', (req, res) => {
  clearCredentials(req);
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: 'Logout failed',
        message: err.message,
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  });
});

/**
 * GET /api/auth/session
 * Get current session info
 */
router.get('/session', (req, res) => {
  if (!req.session.credentials) {
    return res.json({
      success: true,
      data: {
        authenticated: false,
      },
    });
  }

  const currentOrg = req.session.organizations?.find(
    (org) => org.id === req.session.currentOrgId
  );

  res.json({
    success: true,
    data: {
      authenticated: true,
      organizations: req.session.organizations?.map((org) => ({
        id: org.id,
        name: org.name,
        oid: org.oid,
      })),
      currentOrg: currentOrg
        ? {
            id: currentOrg.id,
            name: currentOrg.name,
            oid: currentOrg.oid,
          }
        : null,
    },
  });
});

/**
 * POST /api/auth/switch-org
 * Switch to a different saved organization
 */
router.post(
  '/switch-org',
  asyncHandler(async (req, res) => {
    const body = switchOrgSchema.parse(req.body);

    const success = setCurrentOrganization(req, body.orgId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
        message: 'The specified organization ID was not found in your session',
      });
    }

    const currentOrg = req.session.organizations?.find(
      (org) => org.id === body.orgId
    );

    res.json({
      success: true,
      data: {
        currentOrg: currentOrg
          ? {
              id: currentOrg.id,
              name: currentOrg.name,
              oid: currentOrg.oid,
            }
          : null,
      },
    });
  })
);

/**
 * POST /api/auth/validate
 * Validate credentials without logging in
 */
router.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);

    const credentials = { oid: body.oid, apiKey: body.apiKey };
    const isValid = await authService.validateCredentials(credentials);

    res.json({
      success: true,
      data: {
        valid: isValid,
      },
    });
  })
);

export default router;
