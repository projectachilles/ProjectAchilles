// Authentication service for LimaCharlie endpoints

import axios from 'axios';
import type { JWTResponse, JWTPayload } from '../../types/endpoints.js';

const JWT_URL = process.env.LC_JWT_URL || 'https://jwt.limacharlie.io';
const TOKEN_EXPIRY_BUFFER_SECONDS = 60;

export class AuthService {
  private tokenCache: Map<string, { jwt: string; expiry: Date }> = new Map();

  /**
   * Get JWT token for credentials (with caching)
   */
  async getJWT(oid: string, apiKey: string): Promise<string> {
    const cacheKey = `${oid}:${apiKey}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && this.isTokenValid(cached.expiry)) {
      return cached.jwt;
    }

    const response = await axios.post<JWTResponse>(
      JWT_URL,
      new URLSearchParams({
        oid,
        secret: apiKey,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const jwt = response.data.jwt;
    const expiry = this.extractExpiryFromJWT(jwt);

    this.tokenCache.set(cacheKey, { jwt, expiry });

    return jwt;
  }

  /**
   * Get Authorization header value
   */
  async getAuthHeader(oid: string, apiKey: string): Promise<string> {
    const jwt = await this.getJWT(oid, apiKey);
    return `Bearer ${jwt}`;
  }

  /**
   * Validate credentials by attempting to get JWT
   */
  async validateCredentials(
    oid: string,
    apiKey: string
  ): Promise<{ valid: boolean; orgName?: string; error?: string }> {
    try {
      await this.getJWT(oid, apiKey);
      return { valid: true, orgName: oid };
    } catch (error) {
      const message =
        axios.isAxiosError(error)
          ? error.response?.data?.message || error.message
          : 'Validation failed';
      return { valid: false, error: message };
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
      const parts = jwt.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
      const parsed: JWTPayload = JSON.parse(payload);

      if (!parsed.exp) {
        throw new Error('JWT does not contain expiry');
      }

      return new Date(parsed.exp * 1000);
    } catch {
      // Default to 5 minutes if parsing fails
      return new Date(Date.now() + 5 * 60 * 1000);
    }
  }

  /**
   * Clear cached token
   */
  clearToken(oid: string, apiKey: string): void {
    const cacheKey = `${oid}:${apiKey}`;
    this.tokenCache.delete(cacheKey);
  }

  /**
   * Check if error is auth error (401)
   */
  isAuthError(error: any): boolean {
    return axios.isAxiosError(error) && error.response?.status === 401;
  }
}
