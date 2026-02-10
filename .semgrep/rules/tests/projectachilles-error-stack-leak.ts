import type { Request, Response } from 'express';

function unsafeErrorHandler(err: Error, req: Request, res: Response) {
  // ruleid: projectachilles-error-stack-leak
  res.json({ error: err.message, stack: err.stack });
}

function unsafeErrorHandler2(error: Error, req: Request, res: Response) {
  // ruleid: projectachilles-error-stack-leak
  res.send({ message: error.message, stack: error.stack });
}

function safeErrorHandler(err: Error, req: Request, res: Response) {
  if (process.env.NODE_ENV === 'development') {
    // ok: projectachilles-error-stack-leak
    res.json({ error: err.message, stack: err.stack });
  }
}
