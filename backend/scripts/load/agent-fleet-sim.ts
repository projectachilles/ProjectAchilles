/**
 * Synthetic agent fleet load test.
 *
 *   npx tsx scripts/load/agent-fleet-sim.ts --base http://localhost:3000 \
 *     --db <path-to-agents.db> --agents N --minutes M [--seed-only] [--legacy-bcrypt]
 *
 * Seed mode inserts N active agents with their own random key and bcrypt hash
 * (cost 12, hashed in parallel on worker threads) and writes `sim-keys.json`
 * (mode 0600) next to the DB. Without --legacy-bcrypt it also writes the
 * agent_key_digests rows (what a fleet looks like after the digest fix has run
 * once); with it, only bcrypt hashes exist (a fleet from before that fix).
 *
 * Run mode simulates the fleet against a real backend: each agent polls
 * GET /api/agent/tasks every 30 s +/- 5 s and POSTs /api/agent/heartbeat every
 * 60 s +/- 5 s, starting at a random offset. It prints per-minute latency
 * percentiles, non-2xx counts and how many agents have not been heard from in
 * 180 s (the backend's offline threshold). When --db is given it also samples
 * the number of agent_key_digests rows (read-only).
 *
 * Never point --db at a real installation: seeding writes to it.
 */
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { Worker } from 'worker_threads';
import Database from 'better-sqlite3';
import { initializeTables } from '../../src/services/agent/database.js';
import { digestAgentKey } from '../../src/services/agent/agentKeyDigest.js';

interface Args {
  base: string;
  db: string;
  agents: number;
  minutes: number;
  seedOnly: boolean;
  legacyBcrypt: boolean;
  singleIp: boolean;
  samplesOut: string;
}

interface SimKey {
  id: string;
  hostname: string;
  key: string;
}

const BCRYPT_COST = 12;
const POLL_MS = 30_000;
const HEARTBEAT_MS = 60_000;
const JITTER_MS = 5_000;
const OFFLINE_AFTER_MS = 180_000;
const SIM_ORG = 'sim-org';

function parseArgs(argv: string[]): Args {
  const out: Args = { base: 'http://localhost:3000', db: '', agents: 100, minutes: 5, seedOnly: false, legacyBcrypt: false, singleIp: false, samplesOut: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--base') out.base = next();
    else if (a === '--db') out.db = path.resolve(next());
    else if (a === '--agents') out.agents = parseInt(next(), 10);
    else if (a === '--minutes') out.minutes = parseFloat(next());
    else if (a === '--seed-only') out.seedOnly = true;
    else if (a === '--legacy-bcrypt') out.legacyBcrypt = true;
    else if (a === '--samples-out') out.samplesOut = path.resolve(next());
    else if (a === '--single-ip') out.singleIp = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!Number.isInteger(out.agents) || out.agents < 1) throw new Error('--agents must be a positive integer');
  if (!(out.minutes > 0)) throw new Error('--minutes must be > 0');
  if (out.seedOnly || out.legacyBcrypt) {
    if (!out.db) throw new Error('--db is required for seeding');
  }
  return out;
}

// ── Seeding ──────────────────────────────────────────────────────────────

const WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const bcrypt = require(workerData.bcryptPath);
parentPort.on('message', (job) => {
  if (job === 'done') { process.exit(0); }
  parentPort.postMessage({ i: job.i, hash: bcrypt.hashSync(job.key, workerData.cost) });
});
`;

async function hashAll(keys: SimKey[]): Promise<string[]> {
  const bcryptPath = createRequire(import.meta.url).resolve('bcryptjs');
  const nWorkers = Math.max(1, Math.min(os.cpus().length - 2, 16));
  const hashes = new Array<string>(keys.length);
  let next = 0;
  let done = 0;
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const workers: Worker[] = [];
    const feed = (w: Worker): void => {
      if (next < keys.length) {
        const i = next++;
        w.postMessage({ i, key: keys[i].key });
      } else {
        w.postMessage('done');
      }
    };
    for (let k = 0; k < nWorkers; k++) {
      const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { bcryptPath, cost: BCRYPT_COST } });
      w.on('message', (m: { i: number; hash: string }) => {
        hashes[m.i] = m.hash;
        done++;
        if (done % 250 === 0 || done === keys.length) {
          console.log(`  hashed ${done}/${keys.length} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
        }
        if (done === keys.length) resolve();
        else feed(w);
      });
      w.on('error', reject);
      workers.push(w);
      feed(w);
    }
  });
  return hashes;
}

async function seed(args: Args): Promise<SimKey[]> {
  fs.mkdirSync(path.dirname(args.db), { recursive: true });
  const keys: SimKey[] = [];
  for (let i = 0; i < args.agents; i++) {
    keys.push({
      id: crypto.randomUUID(),
      hostname: `sim-${i}`,
      key: 'ak_' + crypto.randomBytes(32).toString('hex'),
    });
  }
  console.log(`Hashing ${keys.length} keys (bcrypt cost ${BCRYPT_COST}) on worker threads...`);
  const hashes = await hashAll(keys);

  const database = new Database(args.db);
  database.pragma('journal_mode = WAL');
  initializeTables(database);
  const now = new Date().toISOString();
  const insertAgent = database.prepare(`
    INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, enrolled_at, enrolled_by)
    VALUES (?, ?, ?, 'windows', 'amd64', '0.0.0-sim', ?, 'active', ?, 'agent-fleet-sim')
  `);
  const insertDigest = database.prepare(`
    INSERT INTO agent_key_digests (agent_id, api_key_hash, key_digest, verified_at) VALUES (?, ?, ?, ?)
  `);
  database.transaction(() => {
    keys.forEach((k, i) => {
      insertAgent.run(k.id, SIM_ORG, k.hostname, hashes[i], now);
      if (!args.legacyBcrypt) insertDigest.run(k.id, hashes[i], digestAgentKey(k.key, hashes[i]), now);
    });
  })();
  database.close();

  const keysFile = path.join(path.dirname(args.db), 'sim-keys.json');
  fs.writeFileSync(keysFile, JSON.stringify(keys), { mode: 0o600 });
  fs.chmodSync(keysFile, 0o600);
  console.log(`Seeded ${keys.length} agents (${args.legacyBcrypt ? 'bcrypt only' : 'bcrypt + digests'}) into ${args.db}`);
  console.log(`Keys written to ${keysFile} (mode 0600). Do not commit it.`);
  return keys;
}

// ── Run ──────────────────────────────────────────────────────────────────

interface Sample {
  atMs: number;
  latencyMs: number;
  status: number; // 0 = network error
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function jitter(base: number): number {
  return base + (Math.random() * 2 - 1) * JITTER_MS;
}

function heartbeatBody(hostname: string): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    status: 'idle',
    current_task: null,
    system: {
      hostname,
      os: 'windows',
      arch: 'amd64',
      uptime_seconds: 3600,
      cpu_percent: 5,
      memory_mb: 2048,
      disk_free_mb: 50_000,
    },
    agent_version: '0.0.0-sim',
    last_task_completed: null,
  });
}

function countDigests(dbPath: string): number | null {
  try {
    const d = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      d.pragma('busy_timeout = 2000');
      return (d.prepare('SELECT COUNT(*) AS c FROM agent_key_digests').get() as { c: number }).c;
    } finally {
      d.close();
    }
  } catch {
    return null;
  }
}

async function run(args: Args, keys: SimKey[]): Promise<void> {
  const url = new URL(args.base);
  const lib = url.protocol === 'https:' ? https : http;
  const agent = new (lib.Agent)({ keepAlive: true, maxSockets: 512 });
  const startedAt = Date.now();
  const endAt = startedAt + args.minutes * 60_000;
  const samples: Sample[] = [];
  const lastOk = new Map<string, number>();
  const ipFor = new Map<string, string>(
    keys.map((k, i) => [k.id, `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`]),
  );
  let digestsCompleteAtS = null as number | null;

  const request = (method: 'GET' | 'POST', pathname: string, k: SimKey, body?: string): Promise<void> =>
    new Promise((resolve) => {
      const t0 = Date.now();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${k.key}`,
        'X-Agent-ID': k.id,
        'X-Request-Timestamp': new Date().toISOString(),
      };
      // Each agent appears as its own client behind a reverse proxy
      // (TRUST_PROXY_HOPS=1 reads the last X-Forwarded-For entry), like a fleet
      // spread over many networks. --single-ip drops it: one NAT egress IP.
      if (!args.singleIp) headers['X-Forwarded-For'] = ipFor.get(k.id) as string;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(body));
      }
      const req = lib.request(
        { hostname: url.hostname, port: url.port, path: pathname, method, headers, agent, timeout: 60_000 },
        (res) => {
          res.resume();
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const t1 = Date.now();
            samples.push({ atMs: t1 - startedAt, latencyMs: t1 - t0, status });
            if (status >= 200 && status < 300) lastOk.set(k.id, t1);
            resolve();
          });
          res.on('error', () => {
            samples.push({ atMs: Date.now() - startedAt, latencyMs: Date.now() - t0, status: 0 });
            resolve();
          });
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => {
        samples.push({ atMs: Date.now() - startedAt, latencyMs: Date.now() - t0, status: 0 });
        resolve();
      });
      if (body !== undefined) req.write(body);
      req.end();
    });

  const loop = (every: number, fn: () => Promise<void>): void => {
    const tick = async (): Promise<void> => {
      if (Date.now() >= endAt) return;
      await fn();
      setTimeout(() => void tick(), jitter(every));
    };
    // Staggered start: a random offset within one period.
    setTimeout(() => void tick(), Math.random() * every);
  };

  for (const k of keys) {
    loop(POLL_MS, () => request('GET', '/api/agent/tasks', k));
    loop(HEARTBEAT_MS, () => request('POST', '/api/agent/heartbeat', k, heartbeatBody(k.hostname)));
  }

  console.log(`Running ${keys.length} agents against ${args.base} for ${args.minutes} min`);
  console.log('minute | reqs | p50 ms | p95 ms | max ms | non-2xx (net err) | agents >180s silent | digests');

  let digestRows: number | null = args.db ? countDigests(args.db) : null;
  const sampler = setInterval(() => {
    if (!args.db) return;
    digestRows = countDigests(args.db);
    if (digestRows !== null && digestRows >= keys.length && digestsCompleteAtS === null) {
      digestsCompleteAtS = (Date.now() - startedAt) / 1000;
      console.log(`[digests] all ${keys.length} agents have a digest after ${digestsCompleteAtS.toFixed(0)} s`);
    }
  }, 5_000);

  let reported = 0;
  const report = (minuteIdx: number): void => {
    const lo = minuteIdx * 60_000;
    const hi = lo + 60_000;
    const win = samples.filter((s) => s.atMs >= lo && s.atMs < hi);
    const sorted = win.map((s) => s.latencyMs).sort((a, b) => a - b);
    const bad = win.filter((s) => s.status < 200 || s.status >= 300);
    const netErr = win.filter((s) => s.status === 0).length;
    const now = Date.now();
    let silent = 0;
    for (const k of keys) {
      const t = lastOk.get(k.id) ?? startedAt;
      if (now - t > OFFLINE_AFTER_MS) silent++;
    }
    console.log(
      [
        String(minuteIdx + 1).padStart(6),
        String(win.length).padStart(4),
        String(percentile(sorted, 50)).padStart(6),
        String(percentile(sorted, 95)).padStart(6),
        String(sorted.length ? sorted[sorted.length - 1] : 0).padStart(6),
        `${bad.length} (${netErr})`.padStart(17),
        String(silent).padStart(19),
        digestRows === null ? '-' : String(digestRows),
      ].join(' | '),
    );
  };

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const elapsedMin = Math.floor((Date.now() - startedAt) / 60_000);
      while (reported < elapsedMin) report(reported++);
      if (Date.now() >= endAt + 1_000) {
        clearInterval(timer);
        resolve();
      }
    }, 1_000);
  });
  const total = Math.ceil(args.minutes);
  while (reported < total) report(reported++);
  clearInterval(sampler);
  if (args.samplesOut) {
    fs.writeFileSync(args.samplesOut, 'at_ms,latency_ms,status\n' + samples.map((x) => `${x.atMs},${x.latencyMs},${x.status}`).join('\n') + '\n');
  }
  agent.destroy();
  const nonOk = samples.filter((s) => s.status < 200 || s.status >= 300).length;
  console.log(`Done: ${samples.length} requests, ${nonOk} non-2xx, digests complete at ${digestsCompleteAtS === null ? 'n/a' : digestsCompleteAtS.toFixed(0) + ' s'}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.seedOnly) {
    await seed(args);
    return;
  }
  const keysFile = args.db ? path.join(path.dirname(args.db), 'sim-keys.json') : '';
  if (!keysFile || !fs.existsSync(keysFile)) {
    throw new Error('sim-keys.json not found next to --db; run with --seed-only first');
  }
  const keys = (JSON.parse(fs.readFileSync(keysFile, 'utf8')) as SimKey[]).slice(0, args.agents);
  await run(args, keys);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
