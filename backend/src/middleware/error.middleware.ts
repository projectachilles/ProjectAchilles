import type { Request, Response, NextFunction } from 'express';

// Custom error class
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Not found handler
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
}

// Global error handler
export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Log error details server-side only (never expose to client)
  console.error('Error:', err.message);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  const statusCode = 'statusCode' in err ? err.statusCode : 500;

  // For operational errors (expected errors), show the message
  // For unexpected errors (500), show generic message to avoid info leakage
  const isOperational = 'isOperational' in err && err.isOperational;
  const message = isOperational || statusCode !== 500
    ? err.message
    : 'Internal Server Error';

  // Never expose stack traces to clients
  res.status(statusCode).json({
    success: false,
    error: message,
  });
}

// Async handler wrapper
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
