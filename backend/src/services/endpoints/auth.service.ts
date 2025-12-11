/**
 * Authentication Service
 * Based on internal/auth/auth.go
 */

import axios from 'axios';
import { Credentials, JWTResponse, JWTPayload } from '../../types/endpoints.js';

const JWT_URL = process.env.LC_JWT_URL || 'https://jwt.limacharlie.io';
const TOKEN_EXPIRY_BUFFER_SECONDS = 60; // Refresh token 60 seconds before expiry

export class AuthService {
  private tokenCache: Map<string, { jwt: string; expiry: Date }> = new Map();

  /**
   * Get JWT token for credentials (with caching)
   */
  async getJWT(credentials: Credentials): Promise<string> {
    const cacheKey = `${credentials.oid}:${credentials.apiKey}`;
    const cached = this.tokenCache.get(cacheKey);

    // Return cached token if still valid
    if (cached && this.isTokenValid(cached.expiry)) {
      return cached.jwt;
    }

    // Get new JWT token
    try {
      const response = await axios.post<JWTResponse>(
        JWT_URL,
        new URLSearchParams({
          oid: credentials.oid,
          secret: credentials.apiKey,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const jwt = response.data.jwt;
      const expiry = this.extractExpiryFromJWT(jwt);

      // Cache the token
      this.tokenCache.set(cacheKey, { jwt, expiry });

      return jwt;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to obtain JWT token: ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Get Authorization header value
   */
  async getAuthHeader(credentials: Credentials): Promise<string> {
    const jwt = await this.getJWT(credentials);
    return `Bearer ${jwt}`;
  }

  /**
   * Validate credentials by attempting to get JWT
   */
  async validateCredentials(credentials: Credentials): Promise<boolean> {
    try {
      await this.getJWT(credentials);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if token is still valid
   */
  private isTokenValid(expiry: Date): boolean {
    const now = new Date();
    const expiryWithBuffer = new Date(
      expiry.getTime() - TOKEN_EXPIRY_BUFFER_SECONDS * 1000
    );
    return now < expiryWithBuffer;
  }

  /**
   * Extract expiry timestamp from JWT payload
   */
  private extractExpiryFromJWT(jwt: string): Date {
    try {
      // JWT format: header.payload.signature
      const parts = jwt.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      // Decode payload (base64url)
      const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
      const parsed: JWTPayload = JSON.parse(payload);

      if (!parsed.exp) {
        throw new Error('JWT does not contain expiry');
      }

      // Convert Unix timestamp to Date
      return new Date(parsed.exp * 1000);
    } catch (error) {
      // If we can't parse expiry, set a short default (5 minutes)
      return new Date(Date.now() + 5 * 60 * 1000);
    }
  }

  /**
   * Clear cached token for credentials
   */
  clearToken(credentials: Credentials): void {
    const cacheKey = `${credentials.oid}:${credentials.apiKey}`;
    this.tokenCache.delete(cacheKey);
  }

  /**
   * Clear all cached tokens
   */
  clearAllTokens(): void {
    this.tokenCache.clear();
  }

  /**
   * Check if error is an authentication error (401)
   */
  isAuthError(error: any): boolean {
    return axios.isAxiosError(error) && error.response?.status === 401;
  }
}

// Singleton instance
export const authService = new AuthService();
