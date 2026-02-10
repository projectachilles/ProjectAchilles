import path from 'path';
import type { Request, Response } from 'express';

function unsafeHandler(req: Request, res: Response) {
  // ruleid: projectachilles-path-traversal-user-input
  const filePath = path.join('/uploads', req.params.filename);
  // ruleid: projectachilles-path-traversal-user-input
  const queryPath = path.resolve('/data', req.query.dir as string);
  // ruleid: projectachilles-path-traversal-user-input
  const bodyPath = path.join('/tmp', req.body.name);
  res.sendFile(filePath);
}

function safeHandler(req: Request, res: Response) {
  // ok: projectachilles-path-traversal-user-input
  const baseName = path.basename(req.params.filename);
  const filePath = path.join('/uploads', baseName);
  res.sendFile(filePath);
}

function staticHandler() {
  // ok: projectachilles-path-traversal-user-input
  const filePath = path.join('/uploads', 'static-file.txt');
}
