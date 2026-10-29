// Sophos Account Health Check -> Achilles posture score.
//
// Sophos returns per-category scores (0-100) split into computer / server
// (global for exclusions). Sophos does not publish one overall number, so the
// headline is OURS: the mean over the four categories present of (the mean of
// that category's available sub-scores). A category Sophos omits is skipped,
// never counted as zero. Always labelled "Achilles average of Sophos Health
// Check scores".

export type HealthCategory = 'protection' | 'policy' | 'exclusions' | 'tamper_protection';

export interface HealthCategoryScore {
  category: HealthCategory;
  score: number | null;
  computer?: number | null;
  server?: number | null;
  global?: number | null;
}

export interface SophosHealthSnapshot {
  headline: number | null;
  categories: HealthCategoryScore[];
  items: {
    notFullyProtected: string[];
    notOnRecommended: Array<{ policy: string; settings: string[] }>;
    riskyExclusions: Array<{ value: string; type: string; scanMode?: string; reasonCode?: string }>;
    tamperDisabled: string[];
  };
}

export const HEALTH_HEADLINE_LABEL = 'Achilles average of Sophos Health Check scores';

const MAX_ITEMS = 50;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
/** A usable score: finite, clamped to 0-100. Anything else is "not reported". */
const score = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null);

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number): number => Math.round(n * 10) / 10;

function category(name: HealthCategory, parts: { computer?: unknown; server?: unknown; global?: unknown }): HealthCategoryScore | null {
  const computer = score(parts.computer);
  const server = score(parts.server);
  const global = score(parts.global);
  const available = [computer, server, global].filter((v): v is number => v !== null);
  if (available.length === 0) return null;
  const out: HealthCategoryScore = { category: name, score: round1(mean(available) as number) };
  if (computer !== null) out.computer = computer;
  if (server !== null) out.server = server;
  if (global !== null) out.global = global;
  return out;
}

/** Mean of the category scores present; null when there are none. */
export function headlineOf(categories: HealthCategoryScore[]): number | null {
  const scores = categories.map((c) => c.score).filter((s): s is number => s !== null);
  const m = mean(scores);
  return m === null ? null : round1(m);
}

/** Build a snapshot from a GET /account-health-check/v1/health-check response. */
export function computeHealthSnapshot(raw: unknown): SophosHealthSnapshot {
  const endpoint = obj(obj(raw).endpoint);
  const protection = obj(endpoint.protection);
  const policy = obj(endpoint.policy);
  const exclusions = obj(endpoint.exclusions);
  const tamper = obj(endpoint.tamperProtection);

  const policyComputer = obj(obj(policy.computer)['threat-protection']);
  const policyServer = obj(obj(policy.server)['server-threat-protection']);
  const exclGlobal = obj(exclusions.global);
  const exclPolicy = obj(exclusions.policy);
  const tamperComputer = obj(tamper.computer);
  const tamperServer = obj(tamper.server);
  const tamperGlobal = obj(tamper.globalDetail);

  const categories = [
    category('protection', { computer: obj(protection.computer).score, server: obj(protection.server).score }),
    category('policy', { computer: policyComputer.score, server: policyServer.score }),
    category('exclusions', { global: exclGlobal.score }),
    // The account-wide tamper switch only stands in when no per-type score exists.
    category('tamper_protection', {
      computer: tamperComputer.score,
      server: tamperServer.score,
      global: score(tamperComputer.score) === null && score(tamperServer.score) === null ? tamperGlobal.score : undefined,
    }),
  ].filter((c): c is HealthCategoryScore => c !== null);

  const notFullyProtected: string[] = [];
  for (const [kind, o] of [['computers', obj(protection.computer)], ['servers', obj(protection.server)]] as const) {
    const n = o.notFullyProtected;
    if (typeof n === 'number' && n > 0) notFullyProtected.push(`${n} of ${typeof o.total === 'number' ? o.total : '?'} ${kind}`);
  }

  const notOnRecommended: SophosHealthSnapshot['items']['notOnRecommended'] = [];
  for (const p of [...arr(policyComputer.policies), ...arr(policyServer.policies)]) {
    const po = obj(p);
    const name = str(po.name);
    if (!name) continue;
    const n = typeof po.notOnRecommended === 'number' ? po.notOnRecommended : 0;
    notOnRecommended.push({ policy: name, settings: [`${n} setting${n === 1 ? '' : 's'} not on recommended`] });
  }

  const riskyExclusions: SophosHealthSnapshot['items']['riskyExclusions'] = [];
  const addExclusion = (x: unknown) => {
    const xo = obj(x);
    const value = str(xo.value);
    if (value === undefined) return;
    riskyExclusions.push({
      value,
      type: str(xo.type) ?? 'unknown',
      ...(str(xo.scanMode) ? { scanMode: str(xo.scanMode) } : {}),
      ...(str(xo.reasonCode) ? { reasonCode: str(xo.reasonCode) } : {}),
    });
  };
  for (const x of arr(exclGlobal.scanningExclusions)) addExclusion(x);
  for (const side of [obj(exclPolicy.computer), obj(exclPolicy.server)]) {
    for (const pe of arr(side.exclusions)) for (const x of arr(obj(pe).scanningExclusions)) addExclusion(x);
  }

  const tamperDisabled: string[] = [];
  for (const [kind, o] of [['computers', tamperComputer], ['servers', tamperServer]] as const) {
    const n = o.disabled;
    if (typeof n === 'number' && n > 0) tamperDisabled.push(`${n} of ${typeof o.total === 'number' ? o.total : '?'} ${kind}`);
  }
  if (tamperGlobal.enabled === false) tamperDisabled.push('account-wide Tamper Protection is off');

  return {
    headline: headlineOf(categories),
    categories,
    items: {
      notFullyProtected: notFullyProtected.slice(0, MAX_ITEMS),
      notOnRecommended: notOnRecommended.slice(0, MAX_ITEMS),
      riskyExclusions: riskyExclusions.slice(0, MAX_ITEMS),
      tamperDisabled: tamperDisabled.slice(0, MAX_ITEMS),
    },
  };
}

/** Categories from one /scores/historical datapoint (same averaging as live). */
export function categoriesFromHistoryPoint(point: unknown): HealthCategoryScore[] {
  const e = obj(obj(point).endpoint);
  return [
    category('protection', { computer: e.protectionComputerScore, server: e.protectionServerScore }),
    category('policy', { computer: e.policyThreatProtectionComputerScore, server: e.policyThreatProtectionServerScore }),
    category('exclusions', { global: e.exclusionsGlobalScore }),
    category('tamper_protection', {
      computer: e.tamperProtectionComputerScore,
      server: e.tamperProtectionServerScore,
      global: score(e.tamperProtectionComputerScore) === null && score(e.tamperProtectionServerScore) === null ? e.tamperProtectionGlobalScore : undefined,
    }),
  ].filter((c): c is HealthCategoryScore => c !== null);
}

/** Last non-null headline per UTC day from time-ascending health_check hits. */
export function dailyLastHeadline(hits: Array<{ _source?: { timestamp?: string; health?: { headline?: number | null } } }>): Array<{ date: string; score: number }> {
  const byDay = new Map<string, number>();
  for (const h of hits) {
    const ts = h._source?.timestamp;
    const headline = h._source?.health?.headline;
    if (!ts || typeof headline !== 'number' || !Number.isFinite(headline) || !Number.isFinite(Date.parse(ts))) continue;
    byDay.set(new Date(ts).toISOString().slice(0, 10), headline); // later hit overwrites: last of the day
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, score]) => ({ date, score }));
}
