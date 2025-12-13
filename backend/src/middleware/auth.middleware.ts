/**
 * Authentication Middleware
 * Manages session-based authentication and credentials
 */

import { Request, Response, NextFunction } from 'express';
import { Credentials } from '../types/endpoints.js';

/**
 * Require authentication middleware (Legacy - LimaCharlie only)
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
 * Require LimaCharlie auth + Clerk auth (Dual-Auth)
 * Ensures:
 * 1. User is authenticated with Clerk (global auth)
 * 2. User has valid LimaCharlie credentials in session
 * 3. Session belongs to the authenticated Clerk user
 */
export function requireLCAuth(req: Request, res: Response, next: NextFunction): void {
  // Ensure Clerk authentication
  if (!req.auth?.userId) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please sign in to continue',
    });
    return;
  }

  // Ensure session belongs to this Clerk user (prevent session hijacking)
  if (req.session.clerkUserId && req.session.clerkUserId !== req.auth.userId) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction failed:', err);
      }
      res.status(401).json({
        success: false,
        error: 'Invalid session',
        message: 'Session does not belong to authenticated user',
      });
    });
    return;
  }

  // Ensure LimaCharlie credentials exist
  if (!req.session.credentials) {
    res.status(401).json({
      success: false,
      error: 'LimaCharlie credentials required',
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
      message: 'Credentials are missing required fields',
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
 */
export function getCredentials(req: Request): Credentials | null {
  return req.session.credentials || null;
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
  req.session.credentials = {
    oid: org.oid,
    apiKey: org.apiKey,
  };

  return true;
}
