import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AppError, asyncHandler, errorHandler, notFoundHandler } from '../error.middleware.js';

// Helper to build a mock Express response
function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('AppError', () => {
  it('creates an error with message and default 500 status', () => {
    const err = new AppError('Something broke');
    expect(err.message).toBe('Something broke');
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  it('creates an error with custom status code', () => {
    const err = new AppError('Not found', 404);
    expect(err.statusCode).toBe(404);
  });

  it('captures a stack trace', () => {
    const err = new AppError('test');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('error.middleware.test');
  });
});

describe('notFoundHandler', () => {
  it('returns 404 with method and URL in message', () => {
    const req = { method: 'GET', originalUrl: '/api/missing' } as Request;
    const res = mockRes();

    notFoundHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Not Found',
      message: 'Cannot GET /api/missing',
    });
  });

  it('handles POST method correctly', () => {
    const req = { method: 'POST', originalUrl: '/api/data' } as Request;
    const res = mockRes();

    notFoundHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Cannot POST /api/data' })
    );
  });
});

describe('errorHandler', () => {
  it('returns statusCode from AppError', () => {
    const err = new AppError('Forbidden', 403);
    const res = mockRes();

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Forbidden' })
    );
  });

  it('defaults to 500 for plain Error objects', () => {
    const err = new Error('unexpected');
    const res = mockRes();

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('includes stack trace in non-production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const err = new AppError('debug error', 400);
    const res = mockRes();

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    const body = (res.json as any).mock.calls[0][0];
    expect(body.stack).toBeDefined();

    process.env.NODE_ENV = originalEnv;
  });

  it('excludes stack trace in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const err = new AppError('prod error', 400);
    const res = mockRes();

    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);

    const body = (res.json as any).mock.calls[0][0];
    expect(body.stack).toBeUndefined();

    process.env.NODE_ENV = originalEnv;
  });
});

describe('asyncHandler', () => {
  it('calls the handler and resolves normally', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    const req = {} as Request;
    const res = mockRes();
    const next = vi.fn();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards thrown errors to next()', async () => {
    const error = new AppError('async failure', 500);
    const handler = vi.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(handler);

    const next = vi.fn();
    await wrapped({} as Request, mockRes(), next);

    // Wait for the microtask (Promise.resolve().catch)
    await new Promise((r) => setTimeout(r, 0));

    expect(next).toHaveBeenCalledWith(error);
  });
});
