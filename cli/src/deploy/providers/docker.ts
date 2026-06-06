/**
 * Docker Compose provider (self-host, fully automated).
 *
 * The simplest end-to-end path: generate secrets into `backend/.env`, bring the
 * stack up with `docker compose up -d`, then poll the backend health endpoint.
 * Optionally includes the bundled Elasticsearch via the `elasticsearch` profile.
 */

import { z } from 'zod';
import { join } from 'path';
import type { DeployProvider, ExecContext, LogLine, Prereq, Step } from '../types.js';
import { commandExists, probe, run, scriptPath } from '../run.js';

const HEALTH_URL = 'http://localhost:3000/api/health';

const inputSchema = z.object({
  /** Include the bundled Elasticsearch + synthetic seed (needs ≥4 GB RAM). */
  elasticsearch: z.boolean().default(false),
});

async function checkPrereqs(): Promise<Prereq[]> {
  const hasDocker = await commandExists('docker');
  let composeOk = false;
  if (hasDocker) {
    const res = await probe('docker', ['compose', 'version']);
    composeOk = res.ok;
  }
  return [
    {
      id: 'docker',
      label: 'docker installed',
      ok: hasDocker,
      required: true,
      hint: 'Install Docker: https://docs.docker.com/get-docker/',
    },
    {
      id: 'compose',
      label: 'docker compose available',
      ok: composeOk,
      required: true,
      hint: 'Docker Compose v2 ships with Docker Desktop / docker-ce-compose-plugin.',
    },
  ];
}

function plan(inputs: Record<string, unknown>): Step[] {
  const { elasticsearch } = inputSchema.parse(inputs);
  const steps: Step[] = [
    {
      id: 'secrets',
      title: 'Generate deployment secrets → backend/.env',
      kind: 'automated',
    },
    {
      id: 'up',
      title: elasticsearch
        ? 'docker compose up -d (with Elasticsearch)'
        : 'docker compose up -d',
      kind: 'automated',
    },
    {
      id: 'health',
      title: 'Wait for backend health check',
      kind: 'automated',
    },
  ];
  return steps;
}

async function* execute(step: Step, ctx: ExecContext): AsyncIterable<LogLine> {
  const { elasticsearch } = inputSchema.parse(ctx.inputs);

  switch (step.id) {
    case 'secrets': {
      const envPath = join(ctx.repoRoot, 'backend', '.env');
      yield* run(scriptPath('generate-secrets.sh'), [
        '--target',
        'docker',
        '--env-file',
        envPath,
      ]);
      yield { stream: 'info', text: `Secrets written to ${envPath}` };
      return;
    }
    case 'up': {
      const args = ['compose'];
      if (elasticsearch) args.push('--profile', 'elasticsearch');
      args.push('up', '-d');
      yield* run('docker', args);
      return;
    }
    case 'health': {
      yield* pollHealth(ctx.headless);
      return;
    }
    default:
      yield { stream: 'err', text: `Unknown step: ${step.id}` };
  }
}

/** Poll the backend health endpoint until it responds 200 or we give up. */
async function* pollHealth(headless: boolean): AsyncIterable<LogLine> {
  const maxAttempts = headless ? 30 : 60; // ~1–2 min
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        yield { stream: 'info', text: `Backend healthy at ${HEALTH_URL}` };
        return;
      }
      yield { stream: 'out', text: `Attempt ${attempt}: HTTP ${res.status}, retrying…` };
    } catch {
      yield { stream: 'out', text: `Attempt ${attempt}: not ready yet, retrying…` };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  yield {
    stream: 'err',
    text: `Backend did not become healthy at ${HEALTH_URL}. Check: docker compose logs backend`,
  };
}

export const dockerProvider: DeployProvider = {
  id: 'docker',
  label: 'Docker Compose',
  summary: 'One-command local stack (backend + frontend, optional Elasticsearch)',
  modes: ['self-host'],
  automation: 'automated',
  checkPrereqs,
  inputSchema: () => inputSchema,
  plan,
  execute,
};
