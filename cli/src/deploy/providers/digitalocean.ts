/**
 * DigitalOcean operator provider (automated, resumable).
 *
 * Thin wrapper over the existing 9-phase state machine at
 * scripts/deploy-do/deploy.sh. Resumability is delegated entirely to that
 * script's state file (~/.config/projectachilles-deploy/<tenant>.state.json) —
 * re-running the same tenant picks up after the last completed phase. We do not
 * reimplement any of the phase logic here.
 */

import { z } from 'zod';
import { join } from 'path';
import type { DeployProvider, ExecContext, LogLine, Prereq, Step } from '../types.js';
import { commandExists, probe, run, findRepoRoot } from '../run.js';

const inputSchema = z.object({
  /** Tenant slug — keys the resumable state file and DNS/droplet names. */
  tenant: z.string().min(1, 'Tenant slug is required'),
});

async function checkPrereqs(): Promise<Prereq[]> {
  const hasDoctl = await commandExists('doctl');
  let authed = false;
  if (hasDoctl) {
    const res = await probe('doctl', ['account', 'get']);
    authed = res.ok;
  }
  return [
    {
      id: 'doctl',
      label: 'doctl installed',
      ok: hasDoctl,
      required: true,
      hint: 'Install doctl: https://docs.digitalocean.com/reference/doctl/how-to/install/',
    },
    {
      id: 'doctl-auth',
      label: 'doctl authenticated',
      ok: authed,
      required: true,
      hint: 'Run: doctl auth init',
    },
  ];
}

function deployScript(): string {
  return join(findRepoRoot(), 'scripts', 'deploy-do', 'deploy.sh');
}

function plan(inputs: Record<string, unknown>): Step[] {
  const { tenant } = inputSchema.parse(inputs);
  return [
    {
      id: 'deploy',
      title: `Run 9-phase DigitalOcean deploy for tenant "${tenant}" (resumable)`,
      kind: 'automated',
    },
  ];
}

async function* execute(step: Step, ctx: ExecContext): AsyncIterable<LogLine> {
  const { tenant } = inputSchema.parse(ctx.inputs);
  if (step.id !== 'deploy') {
    yield { stream: 'err', text: `Unknown step: ${step.id}` };
    return;
  }
  yield* run(deployScript(), ['--tenant', tenant]);
}

export const digitaloceanProvider: DeployProvider = {
  id: 'digitalocean',
  label: 'DigitalOcean (operator)',
  summary: 'Full multi-droplet automation: backend+Caddy, private ES, DNS, agent build',
  modes: ['operator'],
  automation: 'automated',
  checkPrereqs,
  inputSchema: () => inputSchema,
  plan,
  execute,
};
