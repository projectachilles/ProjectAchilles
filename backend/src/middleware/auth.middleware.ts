/**
 * Authentication Middleware
 * Manages session-based authentication and credentials
 */

import { Request, Response, NextFunction } from 'express';
import { Credentials } from '../types/endpoints.js';
import { credentialStore } from '../services/endpoints/credential-store.service.js';

/**
 * Require authentication middleware
 * Ensures that the user has valid credentials in their session
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.credentials) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please provide LimaCharlie credentials',
    });
    return;
  }

  // Validate credentials format
  const { oid, apiKey } = req.session.credentials;
  if (!oid || !apiKey) {
    res.status(401).json({
      success: false,
      error: 'Invalid credentials',
      message: 'Credentials are missing required fields (oid, apiKey)',
    });
    return;
  }

  next();
}

/**
 * Optional auth middleware
 * Allows requests to proceed even without authentication
 */
export function optionalAuth(_req: Request, _res: Response, next: NextFunction): void {
  // Just pass through, credentials will be checked in route handlers if needed
  next();
}

/**
 * Get credentials from session
 * Retrieves credentials from secure store using session reference
 */
export function getCredentials(req: Request): Credentials | null {
  // First check if credentials are directly in session (for backward compatibility)
  if (req.session.credentials) {
    return req.session.credentials;
  }

  // Otherwise, retrieve from secure credential store
  const currentOrg = getCurrentOrganization(req);
  if (!currentOrg || !currentOrg.credentialId) {
    return null;
  }

  return credentialStore.retrieve(currentOrg.credentialId);
}

/**
 * Set credentials in session
 */
export function setCredentials(req: Request, credentials: Credentials): void {
  req.session.credentials = credentials;
}

/**
 * Clear credentials from session
 */
export function clearCredentials(req: Request): void {
  delete req.session.credentials;
  delete req.session.currentOrgId;
}

/**
 * Get current organization from session
 */
export function getCurrentOrganization(req: Request) {
  if (!req.session.organizations || !req.session.currentOrgId) {
    return null;
  }

  return req.session.organizations.find(
    (org) => org.id === req.session.currentOrgId
  );
}

/**
 * Set current organization in session
 */
export function setCurrentOrganization(req: Request, orgId: string): boolean {
  if (!req.session.organizations) {
    return false;
  }

  const org = req.session.organizations.find((o) => o.id === orgId);
  if (!org) {
    return false;
  }

  req.session.currentOrgId = orgId;

  // Retrieve credentials from secure store
  const credentials = credentialStore.retrieve(org.credentialId);
  if (credentials) {
    req.session.credentials = credentials;
  }

  return true;
}
