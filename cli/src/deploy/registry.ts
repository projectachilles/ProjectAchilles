/**
 * Provider registry — collects every `DeployProvider` and exposes lookup
 * helpers used by both the Ink wizard and the headless runner.
 */

import type { DeployMode, DeployProvider, ProviderId } from './types.js';
import { digitaloceanProvider } from './providers/digitalocean.js';
import { serverProvider } from './providers/server.js';
import { dockerProvider } from './providers/docker.js';
import { flyProvider } from './providers/fly.js';
import { renderProvider } from './providers/render.js';
import { vercelProvider } from './providers/vercel.js';
import { railwayProvider } from './providers/railway.js';

const providers: DeployProvider[] = [
  digitaloceanProvider,
  serverProvider,
  dockerProvider,
  flyProvider,
  renderProvider,
  vercelProvider,
  railwayProvider,
];

export function getAllProviders(): DeployProvider[] {
  return providers;
}

export function getProvider(id: string): DeployProvider | undefined {
  return providers.find((p) => p.id === id);
}

export function providersForMode(mode: DeployMode): DeployProvider[] {
  return providers.filter((p) => p.modes.includes(mode));
}

export function isProviderId(id: string): id is ProviderId {
  return providers.some((p) => p.id === id);
}
