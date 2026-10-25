// Execution report response parsers (spec §5.2). Pure: turn the raw search
// responses of reportQueries.ts into payload pieces. No I/O.

import { classifyStage, countsFromFiltersAgg, getSourceField, isHighImpact, STAGE_OUTCOMES } from './stageOutcome.js';
import { OTHER_LANE } from './reportQueries.js';
import { techniqueInfo } from '../../data/attackTechniques.js';
import { tacticName, tacticRank } from '../../data/attackTactics.js';
import type {
  OutcomeCounts, ReportActor, ReportHost, ReportRun, ReportRunStage, ReportStage,
  ReportTechnique, ReportTest, ReportTimelineBucket,
} from '../../types/reports.js';

/** Above this many runs the HyperLogLog count is approximate. */
export const APPROXIMATE_ABOVE = 10_000;

// Raw ES aggregation JSON; shapes are pinned by reportQueries.ts and its tests.
type Agg = any;

const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === '' ? [] : [String(v)];
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isoOf = (metric: Agg): string | null =>
  typeof metric?.value === 'number' ? new Date(metric.value).toISOString() : null;
const buckets = (a: Agg): Agg[] => a?.buckets ?? [];
const firstSource = (topHits: Agg): Record<string, unknown> => topHits?.hits?.hits?.[0]?._source ?? {};

export interface ParsedScope {
  outcomes: OutcomeCounts;
  stageResults: number;
  runs: number;
  runsApproximate: boolean;
  endpoints: number;
  tests: number;
  tactics: number;
  highImpactUnprotected: number;
  firstExecution: string | null;
  lastExecution: string | null;
  hosts: ReportHost[];
  /** More hosts are in scope than `hosts` lists (the terms aggregation hit its size). */
  hostsCapped: boolean;
  techniques: ReportTechnique[];
  actors: ReportActor[];
}

/**
 * Display tactic for a technique. ES `f0rtika.tactics` is a doc-level array, not paired with
 * techniques, so its buckets only help when they name one of ATT&CK's own tactics for the technique.
 */
function techniqueTactic(id: string, esTactics: string[]): string | null {
  const info = techniqueInfo(id);
  const official = new Set(
    (info?.tactics ?? []).map((t) => tacticName(t)).filter((n): n is string => n !== null),
  );
  const esNames = esTactics.map((k) => tacticName(k));
  return esNames.find((n): n is string => n !== null && official.has(n))
    ?? tacticName(info?.tactics[0])
    ?? tacticName(esTactics[0])
    ?? null;
}

export function parseScope(response: Agg): ParsedScope {
  const a = response?.aggregations ?? {};
  const outcomes = countsFromFiltersAgg(a.outcomes);
  const runs = a.runs?.value ?? 0;
  const techniques: ReportTechnique[] = buckets(a.techniques).map((b) => {
    const id = String(b.key);
    const info = techniqueInfo(id);
    return {
      id,
      name: info?.name ?? null,
      tactic: techniqueTactic(id, buckets(b.tactics).map((t) => String(t.key))),
      outcomes: countsFromFiltersAgg(b.outcomes),
      testKeys: buckets(b.tests).map((t) => String(t.key)),
    };
  });
  techniques.sort((x, y) => tacticRank(x.tactic) - tacticRank(y.tactic) || x.id.localeCompare(y.id));

  return {
    outcomes,
    stageResults: STAGE_OUTCOMES.filter((k) => k !== 'skipped').reduce((sum, k) => sum + outcomes[k], 0),
    runs,
    runsApproximate: runs > APPROXIMATE_ABOVE,
    endpoints: a.endpoints?.value ?? 0,
    tests: a.tests?.value ?? 0,
    tactics: a.tactics?.value ?? 0,
    highImpactUnprotected: a.high_impact?.doc_count ?? 0,
    firstExecution: isoOf(a.first),
    lastExecution: isoOf(a.last),
    hosts: buckets(a.hosts).map((b) => ({
      hostname: String(b.key), runs: b.runs?.value ?? 0, outcomes: countsFromFiltersAgg(b.outcomes),
    })),
    hostsCapped: (a.hosts?.sum_other_doc_count ?? 0) > 0,
    techniques,
    actors: buckets(a.actors).map((b) => ({
      name: String(b.key),
      runs: b.runs?.value ?? 0,
      testKeys: buckets(b.tests).map((t) => String(t.key)),
      outcomes: countsFromFiltersAgg(b.outcomes),
    })),
  };
}

const STAGE_NUMBER = /stage\s*(\d+)/i;

/** Intel-driven bundles label controls "Stage N"; everything else sorts by control id. */
export function stageSortKey(validator: unknown, controlId: string | null): [number, string] {
  const m = String(validator ?? '').match(STAGE_NUMBER);
  return [m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER, controlId ?? ''];
}

function sortByStage<T extends { validator: unknown; controlId: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const [an, ac] = stageSortKey(a.validator, a.controlId);
    const [bn, bc] = stageSortKey(b.validator, b.controlId);
    return an - bn || ac.localeCompare(bc);
  });
}

export function parseTests(response: Agg): ReportTest[] {
  const tests: ReportTest[] = buckets(response?.aggregations?.tests).map((b) => {
    const testKey = String(b.key);
    const meta = firstSource(b.meta);
    const isBundle = getSourceField(meta, 'f0rtika.is_bundle_control') === true;
    const outcomes = countsFromFiltersAgg(b.outcomes);
    const name = (isBundle ? str(getSourceField(meta, 'f0rtika.bundle_name')) : null)
      ?? str(getSourceField(meta, 'f0rtika.test_name'))
      ?? testKey;

    const raw: { controlId: string | null; name: string; validator: unknown; techniques: string[]; tactics: string[]; outcomes: OutcomeCounts }[] = isBundle
      ? buckets(b.stages).map((s) => {
          const sm = firstSource(s.meta);
          return {
            controlId: String(s.key),
            name: str(getSourceField(sm, 'f0rtika.test_name')) ?? String(s.key),
            validator: getSourceField(sm, 'f0rtika.control_validator'),
            techniques: strArray(getSourceField(sm, 'f0rtika.techniques')),
            tactics: strArray(getSourceField(sm, 'f0rtika.tactics')),
            outcomes: countsFromFiltersAgg(s.outcomes),
          };
        })
      : [{
          controlId: null,
          name,
          validator: null,
          techniques: strArray(getSourceField(meta, 'f0rtika.techniques')),
          tactics: strArray(getSourceField(meta, 'f0rtika.tactics')),
          outcomes,
        }];

    const stages: ReportStage[] = sortByStage(raw).map((s, i) => ({
      controlId: s.controlId,
      name: s.name,
      order: i + 1,
      techniques: s.techniques,
      tactics: s.tactics,
      outcomes: s.outcomes,
      alerts: { defender: 0, crowdstrike: 0, sentinelone: 0 },
    }));

    return {
      testKey,
      name,
      isBundle,
      category: str(getSourceField(meta, 'f0rtika.category')),
      subcategory: str(getSourceField(meta, 'f0rtika.subcategory')),
      severity: str(getSourceField(meta, 'f0rtika.severity')),
      score: num(getSourceField(meta, 'f0rtika.score')),
      target: strArray(getSourceField(meta, 'f0rtika.target')),
      complexity: str(getSourceField(meta, 'f0rtika.complexity')),
      threatActor: str(getSourceField(meta, 'f0rtika.threat_actor')),
      tags: strArray(getSourceField(meta, 'f0rtika.tags')),
      description: null,
      runs: b.runs?.value ?? 0,
      endpoints: b.endpoints?.value ?? 0,
      lastRun: isoOf(b.last_run),
      outcomes,
      stages,
    };
  });
  return tests.sort((x, y) => y.runs - x.runs || x.name.localeCompare(y.name));
}

export function parseTimeline(response: Agg, laneKeys: string[]): ReportTimelineBucket[] {
  return buckets(response?.aggregations?.timeline).map((b) => ({
    start: new Date(b.key).toISOString(),
    lanes: [...laneKeys, OTHER_LANE].flatMap((k) => {
      const lane = b.lanes?.buckets?.[k];
      return lane && lane.doc_count > 0
        ? [{ testKey: k, runs: lane.runs?.value ?? 0, outcomes: countsFromFiltersAgg(lane.outcomes) }]
        : [];
    }),
  }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<task_id>` or `<task_id>::<control_id>` → task id; legacy `<bundle_id>::<control_id>` → null. */
export function taskIdFromDocId(docId: string, testKey: string): string | null {
  const prefix = docId.split('::')[0];
  return UUID_RE.test(prefix) && prefix !== testKey ? prefix : null;
}

export function parseRuns(response: Agg): ReportRun[] {
  return buckets(response?.aggregations?.runs).map((b) => {
    const key = String(b.key);
    const [kind, testKey = '', hostname = '', epoch = ''] = key.split('::');
    const hits: Agg[] = b.members?.hits?.hits ?? [];
    const first: Record<string, unknown> = hits[0]?._source ?? {};

    const raw = hits.map((h) => {
      const s: Record<string, unknown> = h._source ?? {};
      const outcome = classifyStage(s);
      const tactics = strArray(getSourceField(s, 'f0rtika.tactics'));
      return {
        controlId: str(getSourceField(s, 'f0rtika.control_id')),
        name: str(getSourceField(s, 'f0rtika.test_name')) ?? 'Unknown stage',
        validator: getSourceField(s, 'f0rtika.control_validator'),
        outcome,
        exitCode: num(getSourceField(s, 'event.ERROR')),
        techniques: strArray(getSourceField(s, 'f0rtika.techniques')),
        tactics,
        highImpact: isHighImpact(outcome, tactics),
      };
    });
    const stages: ReportRunStage[] = sortByStage(raw).map((s, i) => ({
      controlId: s.controlId,
      name: s.name,
      order: i + 1,
      outcome: s.outcome,
      exitCode: s.exitCode,
      techniques: s.techniques,
      tactics: s.tactics,
      highImpact: s.highImpact,
    }));

    const testName = (kind === 'bundle' ? str(getSourceField(first, 'f0rtika.bundle_name')) : null)
      ?? str(getSourceField(first, 'f0rtika.test_name'))
      ?? testKey;

    return {
      key,
      testKey,
      testName,
      hostname,
      completedAt: isoOf(b.completed) ?? new Date(Number(epoch)).toISOString(),
      startedAt: null,
      taskId: taskIdFromDocId(String(hits[0]?._id ?? ''), testKey),
      stages,
      moreStages: Math.max(0, (b.doc_count ?? hits.length) - hits.length),
      alerts: [],
      alertsChecked: false,
    };
  });
}
