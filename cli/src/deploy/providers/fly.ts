/**
 * Fly.io provider (self-host, guided).
 *
 * Automated where the repo already supports it (existing backend/fly.toml +
 * frontend/fly.toml, generate-secrets, flyctl deploy); manual for the bits that
 * are dashboard/DNS-only. Manual step text is sourced from
 * docs/deployment/FLY.md so the doc and the tool stay conceptually in sync.
 */

import { z } from 'zod';
import type { DeployProvider, ExecContext, LogLine, Prereq, Step } from '../types.js';
import { commandExists, probe, run } from '../run.js';
import { emitManual } from '../manual.js';

const inputSchema = z.object({
  backendApp: z.string().default('achilles-backend'),
  frontendApp: z.string().default('achilles-frontend'),
  region: z.string().default('cdg'),
});

type FlyInputs = z.infer<typeof inputSchema>;

async function checkPrereqs(): Promise<Prereq[]> {
  const hasFlyctl = await commandExists('flyctl');
  let authed = false;
  if (hasFlyctl) {
    const res = await probe('flyctl', ['auth', 'whoami']);
    authed = res.ok;
  }
  return [
    {
      id: 'flyctl',
      label: 'flyctl installed',
      ok: hasFlyctl,
      required: true,
      hint: 'Install flyctl: https://fly.io/docs/flyctl/install/',
    },
    {
      id: 'flyctl-auth',
      label: 'flyctl authenticated',
      ok: authed,
      required: true,
      hint: 'Run: flyctl auth login',
    },
  ];
}

function plan(inputs: Record<string, unknown>): Step[] {
  const i = inputSchema.parse(inputs);
  return [
    {
      id: 'create-apps',
      title: 'Create Fly apps',
      kind: 'automated',
    },
    {
      id: 'volume',
      title: 'Create persistent volume',
      kind: 'automated',
    },
    {
      id: 'secrets',
      title: 'Set backend secrets (Clerk + ES + repos)',
      kind: 'manual',
      instructions:
        `Set the backend secrets on Fly. ENCRYPTION_SECRET is REQUIRED on Fly — without it the\n` +
        `backend derives a key from the (changing) hostname and corrupts encrypted settings.\n` +
        `Fill in your Clerk keys, frontend/backend URLs, repo URLs, and Elastic Cloud values.`,
      commands: [
        `# Generate the random secrets quickly:`,
        `${'./scripts/generate-secrets.sh'} --target fly --format flyctl`,
        ``,
        `flyctl secrets set \\`,
        `  CLERK_PUBLISHABLE_KEY="pk_live_..." \\`,
        `  CLERK_SECRET_KEY="sk_live_..." \\`,
        `  SESSION_SECRET="$(openssl rand -base64 32)" \\`,
        `  ENCRYPTION_SECRET="$(openssl rand -base64 32)" \\`,
        `  CLI_AUTH_SECRET="$(openssl rand -base64 32)" \\`,
        `  CORS_ORIGIN="https://${i.frontendApp}.fly.dev" \\`,
        `  AGENT_SERVER_URL="https://${i.backendApp}.fly.dev" \\`,
        `  ELASTICSEARCH_CLOUD_ID="<from Elastic Cloud console>" \\`,
        `  ELASTICSEARCH_API_KEY="<from Elastic Cloud console>" \\`,
        `  --app ${i.backendApp}`,
      ],
    },
    {
      id: 'frontend-secrets',
      title: 'Set frontend secrets',
      kind: 'manual',
      instructions: 'Point the frontend at the backend and pass the Clerk publishable key.',
      commands: [
        `flyctl secrets set \\`,
        `  CLERK_PUBLISHABLE_KEY="pk_live_..." \\`,
        `  VITE_API_URL="https://${i.backendApp}.fly.dev" \\`,
        `  --app ${i.frontendApp}`,
      ],
    },
    {
      id: 'deploy',
      title: 'Deploy backend + frontend',
      kind: 'automated',
    },
    {
      id: 'verify',
      title: 'Verify deployment',
      kind: 'manual',
      instructions: 'Confirm the backend is healthy and the frontend loads the Clerk sign-in.',
      commands: [
        `curl https://${i.backendApp}.fly.dev/api/health`,
        `# Expected: {"status":"ok","service":"ProjectAchilles",...}`,
        `# Then open https://${i.frontendApp}.fly.dev and sign in.`,
      ],
    },
  ];
}

async function* execute(step: Step, ctx: ExecContext): AsyncIterable<LogLine> {
  const i = inputSchema.parse(ctx.inputs) as FlyInputs;

  switch (step.id) {
    case 'create-apps':
      yield { stream: 'info', text: `Creating ${i.backendApp}…` };
      yield* run('flyctl', ['apps', 'create', i.backendApp, '--org', 'personal']);
      yield { stream: 'info', text: `Creating ${i.frontendApp}…` };
      yield* run('flyctl', ['apps', 'create', i.frontendApp, '--org', 'personal']);
      return;
    case 'volume':
      yield* run('flyctl', [
        'volumes',
        'create',
        'achilles_data',
        '--app',
        i.backendApp,
        '--region',
        i.region,
        '--size',
        '1',
      ]);
      return;
    case 'deploy':
      yield { stream: 'info', text: 'Deploying backend (first build is slow — Go toolchain)…' };
      yield* run('flyctl', ['deploy', '--app', i.backendApp], { cwd: `${ctx.repoRoot}/backend` });
      yield { stream: 'info', text: 'Deploying frontend…' };
      yield* run('flyctl', ['deploy', '--app', i.frontendApp], { cwd: `${ctx.repoRoot}/frontend` });
      return;
    default:
      // Manual steps: surface instructions + commands as log lines.
      yield* emitManual(step);
  }
}

export const flyProvider: DeployProvider = {
  id: 'fly',
  label: 'Fly.io',
  summary: 'Cheapest always-on PaaS (~$8/mo). Guided: flyctl + dashboard/DNS steps',
  modes: ['self-host'],
  automation: 'guided',
  checkPrereqs,
  inputSchema: () => inputSchema,
  plan,
  execute,
};
