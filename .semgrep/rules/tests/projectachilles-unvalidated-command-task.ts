import type { Request, Response } from 'express';

const db = getDatabase();

// --- Should trigger ---

function unsafeCommandDirect(req: Request, res: Response) {
  // ruleid: projectachilles-unvalidated-command-task
  db.prepare('INSERT INTO tasks (agent_id, type, payload) VALUES (?, ?, ?)').run(req.params.id, 'command', req.body.command);
}

function unsafeCommandDestructured(req: Request, res: Response) {
  // ruleid: projectachilles-unvalidated-command-task
  const { command, args } = req.body;
  db.prepare('INSERT INTO tasks (type, payload) VALUES (?, ?)').run('command', command);
}

// --- Should NOT trigger ---

function safeCommandValidated(req: Request, res: Response) {
  const { command } = req.body;
  const allowlist = ['whoami', 'hostname', 'ipconfig'];
  if (!allowlist.includes(command)) throw new Error('Invalid command');
  // ok: projectachilles-unvalidated-command-task
  db.prepare('INSERT INTO tasks (type, payload) VALUES (?, ?)').run('command', 'validated_static');
}

function safeNoCommand(req: Request, res: Response) {
  // ok: projectachilles-unvalidated-command-task
  db.prepare('INSERT INTO tasks (type, payload) VALUES (?, ?)').run('heartbeat', req.body.status);
}
