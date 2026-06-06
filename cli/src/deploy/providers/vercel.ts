/**
 * Vercel provider (self-host, guided).
 *
 * Vercel uses backend-serverless/ (Turso + Vercel Blob, signing keys via env).
 * Secret generation for the serverless target is automated via
 * generate-secrets.sh; Turso/Blob/project setup is dashboard/CLI-driven and
 * guided from docs/deployment/VERCEL.md.
 */

import { z } from 'zod';
import type { DeployProvider, ExecContext, LogLine, Step } from '../types.js';
import { commandExists, run, scriptPath } from '../run.js';
import { emitManual } from '../manual.js';

const inputSchema = z.object({});

async function checkPrereqs() {
  return [
    {
      id: 'vercel',
      label: 'vercel CLI installed (optional — dashboard works too)',
      ok: await commandExists('vercel'),
      required: false,
      hint: 'Install: npm i -g vercel',
    },
    {
      id: 'turso',
      label: 'turso CLI installed (for the database)',
      ok: await commandExists('turso'),
      required: false,
      hint: 'Install: curl -sSfL https://get.tur.so/install.sh | bash',
    },
  ];
}

function plan(): Step[] {
  return [
    {
      id: 'secrets',
      title: 'Generate serverless secrets (incl. Ed25519 signing keys)',
      kind: 'automated',
    },
    {
      id: 'turso',
      title: 'Create the Turso database',
      kind: 'manual',
      instructions: 'Create the libSQL database and an auth token; save both values.',
      commands: [
        'turso auth login',
        'turso db create projectachilles',
        'turso db show projectachilles --url     # → TURSO_DATABASE_URL',
        'turso db tokens create projectachilles  # → TURSO_AUTH_TOKEN',
      ],
    },
    {
      id: 'blob',
      title: 'Add Vercel Blob storage',
      kind: 'manual',
      instructions:
        'Vercel Dashboard → Storage → Create Database → Blob. Link it to the backend\n' +
        'project after creation; BLOB_READ_WRITE_TOKEN is injected automatically.',
    },
    {
      id: 'projects',
      title: 'Create the two Vercel projects',
      kind: 'manual',
      instructions:
        'Two projects on the same repo: backend root = backend-serverless, frontend root = frontend.',
      commands: [
        'cd backend-serverless && vercel link && cd ..',
        'cd frontend && vercel link && cd ..',
      ],
    },
    {
      id: 'env',
      title: 'Set environment variables',
      kind: 'manual',
      instructions:
        'In each project (Settings → Environment Variables), set CLERK_*, TURSO_*,\n' +
        'ENCRYPTION_SECRET, CLI_AUTH_SECRET, and the SIGNING_*_B64 values from the secrets step.',
    },
    {
      id: 'deploy',
      title: 'Deploy both projects to production',
      kind: 'manual',
      instructions: 'Deploy to production once env vars are in place.',
      commands: [
        'cd backend-serverless && vercel --prod && cd ..',
        'cd frontend && vercel --prod && cd ..',
      ],
    },
  ];
}

async function* execute(step: Step, _ctx: ExecContext): AsyncIterable<LogLine> {
  if (step.id === 'secrets') {
    yield { stream: 'info', text: 'Generating serverless secrets (printed below — copy into Vercel):' };
    yield* run(scriptPath('generate-secrets.sh'), ['--target', 'vercel']);
    return;
  }
  yield* emitManual(step);
}

export const vercelProvider: DeployProvider = {
  id: 'vercel',
  label: 'Vercel (serverless)',
  summary: 'backend-serverless on Turso + Blob. Guided: Turso/Blob/projects + env',
  modes: ['self-host'],
  automation: 'guided',
  checkPrereqs,
  inputSchema: () => inputSchema,
  plan,
  execute,
};
