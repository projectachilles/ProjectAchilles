/**
 * API key authentication middleware for external integrations.
 *
 * Validates X-API-Key header against stored hashed keys.
 * Returns 401 if missing or invalid.
 */

import type { Request, Response, NextFunction } from 'express';
import { validateApiKey } from '../services/auth/apikey.service.js';

export function requireApiKey() {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-api-key'] as string | undefined;

    if (!key) {
      res.status(401).json({ error: 'Missing X-API-Key header' });
      return;
    }

    const stored = validateApiKey(key);
    if (!stored) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // Attach key metadata for logging/auditing
    (req as any).apiKey = stored;
    next();
  };
}
