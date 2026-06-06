/**
 * Self-hosted server provider (Caddy single-origin, automated).
 *
 * Collects inputs into `deploy.config.env`, then shells out to one of the three
 * existing installers depending on where the user wants the stack to land:
 *   - this-machine → scripts/deploy-server.sh
 *   - remote       → scripts/deploy-remote.sh user@host
 *   - do-droplet   → scripts/deploy-do.sh   (creates a droplet, then installs)
 *
 * These scripts already handle secret generation, idempotency, and non-TTY
 * hard-fail, so this provider is a thin, friendly front-end to deploy.config.env.
 */

import { z } from 'zod';
import type { DeployProvider, ExecContext, LogLine, Prereq, Step } from '../types.js';
import { commandExists, run, scriptPath } from '../run.js';
import { writeConfig, type ConfigKey } from '../config-writer.js';

const inputSchema = z.object({
  installTarget: z.enum(['this-machine', 'remote', 'do-droplet']).default('this-machine'),
  achillesDomain: z.string().min(1, 'Domain is required'),
  acmeEmail: z.string().default(''),
  tlsMode: z.enum(['acme-http', 'acme-dns', 'internal', 'byo']).default('acme-http'),
  clerkPublishableKey: z.string().min(1, 'Clerk publishable key is required'),
  clerkSecretKey: z.string().min(1, 'Clerk secret key is required'),
  esMode: z.enum(['self', 'cloud']).default('self'),
  elasticsearchCloudId: z.string().default(''),
  elasticsearchApiKey: z.string().default(''),
  // acme-dns
  caddyDnsToken: z.string().default(''),
  // remote
  sshTarget: z.string().default(''), // user@host
  // do-droplet
  doApiToken: z.string().default(''),
  doSshKeyFingerprint: z.string().default(''),
});

type ServerInputs = z.infer<typeof inputSchema>;

async function checkPrereqs(): Promise<Prereq[]> {
  const prereqs: Prereq[] = [
    {
      id: 'docker',
      label: 'docker installed (required on the install target)',
      ok: await commandExists('docker'),
      required: false,
      hint: 'Needed on the machine that runs the stack. For remote/droplet installs the script installs it there.',
    },
    {
      id: 'doctl',
      label: 'doctl installed (only for "Create a DO droplet")',
      ok: await commandExists('doctl'),
      required: false,
      hint: 'Install + auth doctl for the do-droplet target: https://docs.digitalocean.com/reference/doctl/',
    },
  ];
  return prereqs;
}

/** Map validated inputs onto deploy.config.env keys. */
function toConfigValues(inputs: ServerInputs): Partial<Record<ConfigKey, string>> {
  const values: Partial<Record<ConfigKey, string>> = {
    ACHILLES_DOMAIN: inputs.achillesDomain,
    TLS_MODE: inputs.tlsMode,
    CLERK_PUBLISHABLE_KEY: inputs.clerkPublishableKey,
    CLERK_SECRET_KEY: inputs.clerkSecretKey,
    ES_MODE: inputs.esMode,
  };
  if (inputs.acmeEmail) values.ACME_EMAIL = inputs.acmeEmail;
  if (inputs.tlsMode === 'acme-dns' && inputs.caddyDnsToken) {
    values.CADDY_DNS_TOKEN = inputs.caddyDnsToken;
  }
  if (inputs.esMode === 'cloud') {
    values.ELASTICSEARCH_CLOUD_ID = inputs.elasticsearchCloudId;
    values.ELASTICSEARCH_API_KEY = inputs.elasticsearchApiKey;
  }
  if (inputs.installTarget === 'do-droplet') {
    if (inputs.doApiToken) values.DO_API_TOKEN = inputs.doApiToken;
    if (inputs.doSshKeyFingerprint) values.DO_SSH_KEY_FINGERPRINT = inputs.doSshKeyFingerprint;
  }
  if (inputs.installTarget === 'remote' && inputs.sshTarget) {
    const [user, host] = inputs.sshTarget.split('@');
    if (host) {
      values.SSH_USER = user;
      values.SSH_HOST = host;
    } else {
      values.SSH_HOST = user;
    }
  }
  return values;
}

function plan(inputs: Record<string, unknown>): Step[] {
  const parsed = inputSchema.parse(inputs);
  const scriptTitle = {
    'this-machine': 'Install on this machine (deploy-server.sh)',
    remote: `Install on remote host (deploy-remote.sh${parsed.sshTarget ? ` ${parsed.sshTarget}` : ''})`,
    'do-droplet': 'Create DigitalOcean droplet + install (deploy-do.sh)',
  }[parsed.installTarget];
  return [
    { id: 'config', title: 'Write deploy.config.env (0600)', kind: 'automated' },
    { id: 'install', title: scriptTitle, kind: 'automated' },
  ];
}

async function* execute(step: Step, ctx: ExecContext): AsyncIterable<LogLine> {
  const inputs = inputSchema.parse(ctx.inputs);

  switch (step.id) {
    case 'config': {
      const path = writeConfig(ctx.repoRoot, toConfigValues(inputs));
      // Never echo the values — only the path.
      yield { stream: 'info', text: `Wrote ${path} (mode 0600). Blank secrets auto-generate on install.` };
      return;
    }
    case 'install': {
      switch (inputs.installTarget) {
        case 'this-machine':
          yield* run(scriptPath('deploy-server.sh'), []);
          return;
        case 'remote': {
          const args = inputs.sshTarget ? [inputs.sshTarget] : [];
          yield* run(scriptPath('deploy-remote.sh'), args);
          return;
        }
        case 'do-droplet':
          yield* run(scriptPath('deploy-do.sh'), []);
          return;
      }
      return;
    }
    default:
      yield { stream: 'err', text: `Unknown step: ${step.id}` };
  }
}

export const serverProvider: DeployProvider = {
  id: 'server',
  label: 'Self-hosted server (Caddy + TLS)',
  summary: 'Single-origin install on your box, a remote SSH host, or a new DO droplet',
  modes: ['self-host'],
  automation: 'automated',
  checkPrereqs,
  inputSchema: () => inputSchema,
  plan,
  execute,
};
