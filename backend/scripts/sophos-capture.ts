// Sophos Central PoC capture kit. Owner-run, read-only, not wired into the product.
//
//   cd backend && SOPHOS_CLIENT_ID=... SOPHOS_CLIENT_SECRET=... \
//     npx tsx scripts/sophos-capture.ts --out ./sophos-capture-1
//
// Calls each read endpoint once, redacts the results with consistent
// pseudonyms and writes <endpoint>.json plus manifest.json. The credentials
// are read from the environment only and are never printed or written. The
// client is created in read_only mode, which refuses every write locally.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { siemFromSeconds } from '../src/services/sophos/capture/window.js';
import { SophosClient, SophosApiError, SophosGraphQLError } from '../src/services/sophos/sophos-client.js';
import { redactCaptureSet } from '../src/services/sophos/capture/redact.js';
// Shared with the sync service and validated against det.graphql in
// src/services/sophos/__tests__/detection-query.test.ts.
import {
  SOPHOS_CAPTURE_DETECTION_BY_ID_QUERY,
  SOPHOS_CAPTURE_DETECTION_SEARCH_QUERY,
  detectionByIdVariables,
  detectionCql,
  detectionSearchVariables,
} from '../src/services/sophos/detection-query.js';

const USAGE = `Sophos Central PoC capture (read-only)

Usage:
  SOPHOS_CLIENT_ID=<id> SOPHOS_CLIENT_SECRET=<secret> npx tsx scripts/sophos-capture.ts --out <dir>

Run from the backend/ directory. Use a Service Principal Read-Only credential.

Options:
  --out <dir>   Output directory (created if missing). Required.
  --days <n>    Look-back window for alerts/detections (default 7).
  --help        Show this message.

Output: one redacted <endpoint>.json per call plus manifest.json
(endpoint -> status, item count). No write calls are made and the secret is
never printed. Skim the output for customer-identifying text before sending.
`;

interface ManifestEntry { status: number | 'ok' | 'skipped' | 'error'; items?: number; note?: string }

function parseArgs(argv: string[]): { out?: string; days: number; help: boolean } {
  const res: { out?: string; days: number; help: boolean } = { days: 7, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') res.help = true;
    else if (a === '--out') res.out = argv[++i];
    else if (a === '--days') res.days = Math.max(1, Math.min(90, Number(argv[++i]) || 7));
  }
  return res;
}

const countOf = (v: unknown): number | undefined => {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items.length;
    if (Array.isArray(o.list)) return o.list.length;
  }
  return undefined;
};

/** Credentials to strip from any error text; set once main() has read them. */
let secrets: string[] = [];
const scrubError = (msg: string) => secrets.reduce((m, sec) => (sec ? m.split(sec).join('[redacted]') : m), msg).slice(0, 300);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(USAGE); return; }
  const clientId = process.env.SOPHOS_CLIENT_ID;
  const clientSecret = process.env.SOPHOS_CLIENT_SECRET;
  if (!args.out || !clientId || !clientSecret) {
    const missing = [!clientId && 'SOPHOS_CLIENT_ID', !clientSecret && 'SOPHOS_CLIENT_SECRET', !args.out && '--out <dir>'].filter(Boolean).join(', ');
    process.stderr.write(`Missing: ${missing}\n\n${USAGE}`);
    process.exit(2);
  }
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });

  const client = new SophosClient({ client_id: clientId, client_secret: clientSecret, permission_mode: 'read_only' });
  const raw: Record<string, unknown> = {};
  const manifest: Record<string, ManifestEntry> = {};

  secrets = [clientSecret, clientId];

  async function step(name: string, fn: () => Promise<unknown>): Promise<unknown> {
    try {
      const data = await fn();
      raw[name] = data;
      manifest[name] = { status: 'ok', items: countOf(data) };
      process.stdout.write(`ok       ${name}\n`);
      return data;
    } catch (err) {
      const status = err instanceof SophosApiError ? err.statusCode : 'error';
      const note = scrubError(err instanceof SophosGraphQLError || err instanceof Error ? err.message : String(err));
      manifest[name] = { status, note };
      process.stdout.write(`${String(status).padEnd(8)} ${name}\n`);
      return undefined;
    }
  }

  const now = new Date();
  const from = new Date(now.getTime() - args.days * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  await step('whoami', () => client.whoami());
  const alerts = await step('alerts', () => client.listAlerts({ from: from.toISOString(), pageSize: 100 }));
  const firstAlert = (alerts as { items?: Array<{ id?: unknown }> } | undefined)?.items?.[0];
  if (typeof firstAlert?.id === 'string') await step('alert-by-id', () => client.getAlert(firstAlert.id as string));
  else manifest['alert-by-id'] = { status: 'skipped', note: 'no alerts in window' };

  await step('siem-events', () => client.siemEvents({ fromDate: siemFromSeconds(now.getTime(), args.days), limit: 200 }));

  type Search = { detectionSearch?: { alerts?: { list?: Array<{ id?: unknown }> } } };
  const search = (await step('xdr-detection-search', () =>
    client.graphql<Search>(SOPHOS_CAPTURE_DETECTION_SEARCH_QUERY, detectionSearchVariables(detectionCql(args.days * 1440), 0, 50)))) as Search | undefined;
  const firstDet = search?.detectionSearch?.alerts?.list?.[0];
  if (typeof firstDet?.id === 'string') {
    await step('xdr-detection-by-id', () => client.graphql(SOPHOS_CAPTURE_DETECTION_BY_ID_QUERY, detectionByIdVariables([firstDet.id as string])));
  } else manifest['xdr-detection-by-id'] = { status: 'skipped', note: 'no detections in window' };

  await step('detections-v1', () => client.detectionsV1({ from: from.toISOString(), to: now.toISOString() }));
  await step('health-check', () => client.healthCheck());
  await step('health-history', () => client.healthHistory({ startDate: day(new Date(now.getTime() - 30 * 86_400_000)), endDate: day(now) }));
  await step('endpoints', async () => {
    const page = await client.listEndpoints({});
    return page.items;
  });

  const policies = await step('policies-threat-protection', () => client.listPolicies('threat-protection'));
  await step('policies-server-threat-protection', () => client.listPolicies('server-threat-protection'));
  const firstPolicy = (policies as Array<{ id?: unknown }> | undefined)?.[0];
  if (typeof firstPolicy?.id === 'string') await step('policy-settings', () => client.getPolicySettings(firstPolicy.id as string));
  else manifest['policy-settings'] = { status: 'skipped', note: 'no threat-protection policy listed' };

  await step('scanning-exclusions', () => client.listScanningExclusions());
  await step('allowed-items', () => client.listAllowedItems());

  // One redaction pass over everything so pseudonyms are consistent across files.
  const both = redactCaptureSet(raw, manifest);
  const redacted = both.raw;
  const redactedManifest = both.manifest;
  for (const [name, data] of Object.entries(redacted)) {
    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(redactedManifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`\nWrote ${Object.keys(redacted).length} redacted files + manifest.json to ${outDir}\nSkim them for customer-identifying text before sending.\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Capture failed: ${err instanceof Error ? scrubError(err.message) : 'unknown error'}\n`);
  process.exit(1);
});
