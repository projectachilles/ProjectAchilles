/**
 * Railway provider (self-host, guided).
 *
 * Railway is entirely dashboard/Git-driven (root directories + reference
 * variables), so this provider is a guided checklist sourced from
 * docs/deployment/RAILWAY.md. Use generate-secrets.sh locally for the secrets.
 */

import { z } from 'zod';
import type { DeployProvider, ExecContext, LogLine, Step } from '../types.js';
import { run, scriptPath } from '../run.js';
import { emitManual } from '../manual.js';

const inputSchema = z.object({});

async function checkPrereqs() {
  // No required local tooling — Railway is dashboard/Git-driven.
  return [];
}

function plan(): Step[] {
  return [
    {
      id: 'secrets',
      title: 'Generate secrets to paste into Railway',
      kind: 'automated',
    },
    {
      id: 'project',
      title: 'Create the Railway project',
      kind: 'manual',
      instructions: 'railway.com → New Project → Empty Project.',
    },
    {
      id: 'backend',
      title: 'Deploy the backend service',
      kind: 'manual',
      instructions:
        '+ New → GitHub Repo → your repo. Set Root Directory = backend (railway.toml auto-detects\n' +
        'the Dockerfile). Add a volume at /root/.projectachilles, set the env vars, and generate a\n' +
        'public domain. ENCRYPTION_SECRET is REQUIRED (machine-derived key changes across deploys).',
      commands: [
        'NODE_ENV=production',
        'PORT=3000',
        'CLERK_PUBLISHABLE_KEY=pk_live_...',
        'CLERK_SECRET_KEY=sk_live_...',
        'CORS_ORIGIN=https://${{ frontend.RAILWAY_PUBLIC_DOMAIN }}',
        'AGENT_SERVER_URL=https://${{ backend.RAILWAY_PUBLIC_DOMAIN }}',
        'TESTS_REPO_URL=https://github.com/your-org/f0_library.git',
        'AGENT_REPO_URL=https://github.com/your-org/ProjectAchilles.git',
        'GITHUB_TOKEN=ghp_...',
        'ELASTICSEARCH_CLOUD_ID=<from Elastic Cloud console>',
        'ELASTICSEARCH_API_KEY=<from Elastic Cloud console>',
      ],
    },
    {
      id: 'frontend',
      title: 'Deploy the frontend service',
      kind: 'manual',
      instructions:
        '+ New → GitHub Repo → same repo. Set Root Directory = frontend, set the vars below,\n' +
        'and generate a public domain. Update the backend CORS_ORIGIN to match it.',
      commands: [
        'CLERK_PUBLISHABLE_KEY=pk_live_...',
        'BACKEND_HOST=backend.railway.internal',
        'BACKEND_PORT=3000',
      ],
    },
    {
      id: 'verify',
      title: 'Verify',
      kind: 'manual',
      instructions: 'Wait for both builds, then check the backend health and the frontend sign-in.',
      commands: ['curl https://<backend-domain>/api/health'],
    },
  ];
}

async function* execute(step: Step, _ctx: ExecContext): AsyncIterable<LogLine> {
  if (step.id === 'secrets') {
    yield { stream: 'info', text: 'Generating secrets (printed below — paste into Railway variables):' };
    yield* run(scriptPath('generate-secrets.sh'), ['--target', 'railway', '--format', 'railway']);
    return;
  }
  yield* emitManual(step);
}

export const railwayProvider: DeployProvider = {
  id: 'railway',
  label: 'Railway',
  summary: 'Dashboard/Git-driven PaaS. Guided checklist + generated secrets',
  modes: ['self-host'],
  automation: 'guided',
  checkPrereqs,
  inputSchema: () => inputSchema,
  plan,
  execute,
};
