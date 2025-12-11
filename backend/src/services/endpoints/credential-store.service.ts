/**
 * Secure Credential Store
 *
 * This service manages API credentials securely, keeping them separate from session storage.
 * In production, this should be replaced with a proper secrets management solution
 * (e.g., HashiCorp Vault, AWS Secrets Manager, encrypted database, etc.)
 *
 * Current implementation uses in-memory storage with TTL for development.
 * For production: Use encrypted storage with proper access controls.
 */

import { Credentials } from '../../types/endpoints.js';
import { createHash } from 'crypto';

interface StoredCredential {
  credentials: Credentials;
  createdAt: Date;
  expiresAt: Date;
}

class CredentialStore {
  private store: Map<string, StoredCredential> = new Map();
  private readonly DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval to remove expired credentials
    this.startCleanup();
  }

  /**
   * Generate a secure credential ID from OID
   * Uses a hash to prevent direct exposure of organizational identifiers
   */
  private generateCredentialId(oid: string, sessionId: string): string {
    const hash = createHash('sha256');
    hash.update(`${oid}:${sessionId}:${Date.now()}`);
    return hash.digest('hex');
  }

  /**
   * Store credentials securely
   * Returns a credential ID that can be safely stored in session
   */
  store(credentials: Credentials, sessionId: string, ttl?: number): string {
    const credentialId = this.generateCredentialId(credentials.oid, sessionId);
    const expiresAt = new Date(Date.now() + (ttl || this.DEFAULT_TTL));

    this.store.set(credentialId, {
      credentials,
      createdAt: new Date(),
      expiresAt,
    });

    return credentialId;
  }

  /**
   * Retrieve credentials by credential ID
   * Returns null if not found or expired
   */
  retrieve(credentialId: string): Credentials | null {
    const stored = this.store.get(credentialId);

    if (!stored) {
      return null;
    }

    // Check if expired
    if (new Date() > stored.expiresAt) {
      this.store.delete(credentialId);
      return null;
    }

    return stored.credentials;
  }

  /**
   * Remove credentials from store
   */
  remove(credentialId: string): void {
    this.store.delete(credentialId);
  }

  /**
   * Update TTL for existing credential
   */
  refresh(credentialId: string, ttl?: number): boolean {
    const stored = this.store.get(credentialId);

    if (!stored) {
      return false;
    }

    stored.expiresAt = new Date(Date.now() + (ttl || this.DEFAULT_TTL));
    return true;
  }

  /**
   * Clean up expired credentials
   */
  private cleanup(): void {
    const now = new Date();

    for (const [id, stored] of this.store.entries()) {
      if (now > stored.expiresAt) {
        this.store.delete(id);
      }
    }
  }

  /**
   * Start periodic cleanup of expired credentials
   */
  private startCleanup(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  /**
   * Stop cleanup interval (for testing)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get store size (for monitoring)
   */
  size(): number {
    return this.store.size;
  }
}

// Singleton instance
export const credentialStore = new CredentialStore();
