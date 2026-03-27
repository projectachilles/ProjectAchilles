/**
 * Zod request body validation middleware.
 * Wraps a Zod schema into Express middleware that validates req.body
 * and returns a consistent 400 error on failure.
 *
 * Usage:
 *   import { validate } from '../middleware/validation.js';
 *   import { mySchema } from '../schemas/myDomain.js';
 *   router.post('/foo', validate(mySchema), asyncHandler(async (req, res) => { ... }));
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Returns Express middleware that validates `req.body` against the given Zod schema.
 * On success, replaces `req.body` with the parsed (and coerced/stripped) value.
 * On failure, responds with 400 and a structured error.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const formatted = formatZodError(result.error);
      res.status(400).json({
        success: false,
        error: formatted.message,
        details: formatted.issues,
      });
      return;
    }

    // Replace body with parsed value (applies defaults, strips unknown keys)
    req.body = result.data;
    next();
  };
}

/**
 * Same as validate() but for query parameters instead of body.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const formatted = formatZodError(result.error);
      res.status(400).json({
        success: false,
        error: formatted.message,
        details: formatted.issues,
      });
      return;
    }

    // Overwrite query with parsed values
    (req as any).query = result.data;
    next();
  };
}

function formatZodError(error: ZodError): { message: string; issues: Array<{ path: string; message: string }> } {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

  // Build a human-readable summary from the first few issues
  const summary = issues
    .slice(0, 3)
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .join('; ');

  return {
    message: `Validation failed: ${summary}`,
    issues,
  };
}
