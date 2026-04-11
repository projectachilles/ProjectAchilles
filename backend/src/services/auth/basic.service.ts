/**
 * Basic authentication service.
 *
 * Provides a simple username/password auth method for local/demo deployments.
 * Issues JWTs compatible with the Clerk-style req.auth interface so downstream
 * middleware (requireClerkAuth, requirePermission, etc.) works unchanged.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const USERNAME = 'achillesadm';

let generatedPassword: string | null = null;

function getPassword(): string {
  const envPassword = process.env.BASIC_AUTH_PASSWORD;
  if (envPassword) return envPassword;

  if (!generatedPassword) {
    generatedPassword = crypto.randomBytes(16).toString('base64url');
  }
  return generatedPassword;
}

function getSecret(): string {
  return process.env.SESSION_SECRET || 'achilles-dev-secret';
}

export interface BasicAuthUser {
  id: string;
  name: string;
  role: string;
}

export interface BasicTokenPayload {
  sub: string;
  name: string;
  role: string;
  type: 'basic';
  iat: number;
  exp: number;
}

/**
 * Validate username/password and return a signed JWT + user info.
 * Returns null if credentials are invalid.
 */
export function authenticateBasic(
  username: string,
  password: string,
): { token: string; user: BasicAuthUser } | null {
  if (username !== USERNAME || password !== getPassword()) {
    return null;
  }

  const payload = {
    sub: 'basic-admin',
    name: 'Admin',
    role: 'admin',
    type: 'basic' as const,
  };

  const token = jwt.sign(payload, getSecret(), {
    algorithm: 'HS256',
    issuer: 'projectachilles',
    expiresIn: '24h',
  });

  return {
    token,
    user: { id: 'basic-admin', name: 'Admin', role: 'admin' },
  };
}

/**
 * Verify a basic auth JWT. Returns the decoded payload or null.
 */
export function verifyBasicToken(token: string): BasicTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret(), {
      algorithms: ['HS256'],
      issuer: 'projectachilles',
    }) as BasicTokenPayload;
    if (decoded.type !== 'basic') return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Print the basic auth credentials to the console on startup.
 */
export function printBasicAuthCredentials(): void {
  const pw = getPassword();
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Basic Auth Credentials                                 ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║   Username: ${USERNAME.padEnd(44)}║`);
  console.log(`║   Password: ${pw.padEnd(44)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
}
