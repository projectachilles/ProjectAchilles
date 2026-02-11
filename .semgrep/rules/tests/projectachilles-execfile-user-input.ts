import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Request, Response } from 'express';

const execFileAsync = promisify(execFile);

function unsafeExec(req: Request, res: Response) {
  // ruleid: projectachilles-execfile-user-input
  execFile('go', ['build', '-o', req.params.name], {}, (err) => {});
}

async function unsafeExecAsync(req: Request, res: Response) {
  // ruleid: projectachilles-execfile-user-input
  await execFileAsync('go', ['build', req.query.target as string], {});
}

function safeExec(validatedUuid: string) {
  // ok: projectachilles-execfile-user-input
  execFile('go', ['build', '-o', validatedUuid], {}, (err) => {});
}

async function safeExecAsync(uuid: string) {
  // ok: projectachilles-execfile-user-input
  await execFileAsync('bash', ['build_all.sh'], { cwd: '/tmp' });
}
