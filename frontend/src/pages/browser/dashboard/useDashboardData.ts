import { useEffect, useState } from 'react';
import { browserApi } from '@/services/api/browser';
import { agentApi } from '@/services/api/agent';
import type { TestMetadata } from '@/types/test';
import type { AgentTask } from '@/types/agent';

/* ── MITRE tactic catalog (the 14 ATT&CK tactics) ───────────────── */
export interface TacticBucket {
  id: string;
  name: string;
  techniqueIds: string[]; // technique IDs known to belong to this tactic
  testCount: number;      // number of catalog tests touching this tactic
}

const TACTIC_CATALOG: Array<{ id: string; name: string; prefixes: string[] }> = [
  // Each tactic has a known set of MITRE technique-ID prefixes; we bucket
  // technique IDs onto tactics by the first three digits where possible,
  // falling back to a broader prefix match.
  { id: 'IA', name: 'Initial Access',         prefixes: ['T1078', 'T1133', 'T1189', 'T1190', 'T1195', 'T1199', 'T1200', 'T1566'] },
  { id: 'EX', name: 'Execution',              prefixes: ['T1047', 'T1053', 'T1059', 'T1106', 'T1129', 'T1203', 'T1204', 'T1559', 'T1569', 'T1610', 'T1648'] },
  { id: 'PE', name: 'Persistence',            prefixes: ['T1037', 'T1098', 'T1136', 'T1137', 'T1176', 'T1197', 'T1205', 'T1505', 'T1525', 'T1542', 'T1543', 'T1546', 'T1547', 'T1554', 'T1574'] },
  { id: 'PR', name: 'Privilege Escalation',   prefixes: ['T1055', 'T1068', 'T1078', 'T1134', 'T1484', 'T1543', 'T1547', 'T1548', 'T1574', 'T1611'] },
  { id: 'DE', name: 'Defense Evasion',        prefixes: ['T1006', 'T1014', 'T1027', 'T1036', 'T1055', 'T1070', 'T1112', 'T1127', 'T1140', 'T1197', 'T1207', 'T1218', 'T1220', 'T1222', 'T1480', 'T1497', 'T1535', 'T1542', 'T1548', 'T1550', 'T1556', 'T1562', 'T1564', 'T1574', 'T1578', 'T1599', 'T1620'] },
  { id: 'CA', name: 'Credential Access',      prefixes: ['T1003', 'T1040', 'T1056', 'T1110', 'T1111', 'T1187', 'T1212', 'T1528', 'T1539', 'T1552', 'T1555', 'T1556', 'T1557', 'T1558', 'T1606', 'T1621', 'T1649'] },
  { id: 'DI', name: 'Discovery',              prefixes: ['T1007', 'T1010', 'T1012', 'T1016', 'T1018', 'T1033', 'T1046', 'T1049', 'T1057', 'T1069', 'T1082', 'T1083', 'T1087', 'T1120', 'T1124', 'T1135', 'T1201', 'T1217', 'T1482', 'T1497', 'T1518', 'T1538', 'T1580', 'T1613', 'T1614', 'T1615', 'T1619', 'T1622'] },
  { id: 'LM', name: 'Lateral Movement',       prefixes: ['T1021', 'T1072', 'T1080', 'T1091', 'T1210', 'T1534', 'T1550', 'T1563', 'T1570'] },
  { id: 'CO', name: 'Collection',             prefixes: ['T1005', 'T1025', 'T1039', 'T1056', 'T1074', 'T1113', 'T1114', 'T1115', 'T1119', 'T1123', 'T1125', 'T1185', 'T1213', 'T1530', 'T1532', 'T1557', 'T1560', 'T1602'] },
  { id: 'C2', name: 'Command & Control',      prefixes: ['T1001', 'T1008', 'T1071', 'T1090', 'T1092', 'T1095', 'T1102', 'T1104', 'T1105', 'T1132', 'T1205', 'T1219', 'T1568', 'T1571', 'T1572', 'T1573'] },
  { id: 'EF', name: 'Exfiltration',           prefixes: ['T1011', 'T1020', 'T1029', 'T1030', 'T1041', 'T1048', 'T1052', 'T1537', 'T1567'] },
  { id: 'IM', name: 'Impact',                 prefixes: ['T1485', 'T1486', 'T1489', 'T1490', 'T1491', 'T1495', 'T1496', 'T1498', 'T1499', 'T1529', 'T1531', 'T1561', 'T1565', 'T1657'] },
  { id: 'RC', name: 'Reconnaissance',         prefixes: ['T1589', 'T1590', 'T1591', 'T1592', 'T1593', 'T1594', 'T1595', 'T1596', 'T1597', 'T1598'] },
  { id: 'RD', name: 'Resource Development',   prefixes: ['T1583', 'T1584', 'T1585', 'T1586', 'T1587', 'T1588', 'T1608', 'T1650'] },
];

function tacticForTechnique(id: string): string | null {
  const bare = id.split('.')[0]; // strip sub-technique suffix (e.g. T1059.001)
  for (const t of TACTIC_CATALOG) if (t.prefixes.includes(bare)) return t.id;
  return null;
}

/* ── Severity buckets ───────────────────────────────────────────── */
export interface SeverityBuckets { critical: number; high: number; medium: number; low: number }

/* ── Category buckets ───────────────────────────────────────────── */
export interface CategoryBucket { id: string; name: string; count: number; color: string }
const CATEGORY_COLORS: Record<string, string> = {
  'cyber-hygiene': '#4f8eff',
  'intel-driven': '#a78bfa',
  'mitre-top10': '#22d3ee',
};
function colorForCategory(id: string): string {
  return CATEGORY_COLORS[id] ?? '#6b7388';
}

/* ── Aggregations on the test catalog ───────────────────────────── */
export interface DashboardData {
  loading: boolean;
  error: string | null;

  totalTests: number;
  critHighCount: number;
  techniqueCount: number;
  tacticCount: number;
  categoryCount: number;
  avgScore: number;
  testsScored: number;

  tactics: Array<{ id: string; name: string; techniques: number; covered: number }>;
  severity: SeverityBuckets;
  categories: CategoryBucket[];

  topRated: Array<{ uuid: string; name: string; severity: string; score: number }>;
  recentlyModified: Array<{ uuid: string; name: string; severity: string; when: string; modifiedAt: string | null }>;

  runQueue: Array<{ id: string; name: string; severity: string; progress: number | null; status: string }>;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

function severityFromTestName(_name: string): string {
  return 'medium';
}

function aggregate(tests: TestMetadata[], tasks: AgentTask[]): Omit<DashboardData, 'loading' | 'error'> {
  const total = tests.length;

  // Techniques + tactics
  const techniqueSet = new Set<string>();
  const tacticTechniqueMap = new Map<string, Set<string>>(); // tacticId → set of technique IDs that have a test
  for (const t of tests) {
    for (const tech of t.techniques ?? []) {
      techniqueSet.add(tech);
      const tactic = tacticForTechnique(tech);
      if (tactic) {
        if (!tacticTechniqueMap.has(tactic)) tacticTechniqueMap.set(tactic, new Set());
        tacticTechniqueMap.get(tactic)!.add(tech);
      }
    }
  }

  const tactics = TACTIC_CATALOG.map((t) => ({
    id: t.id,
    name: t.name,
    techniques: t.prefixes.length,
    covered: tacticTechniqueMap.get(t.id)?.size ?? 0,
  })).filter((t) => t.techniques > 0).slice(0, 12);

  // Severity
  const severity: SeverityBuckets = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of tests) {
    const s = (t.severity ?? severityFromTestName(t.name)).toLowerCase();
    if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') {
      severity[s] += 1;
    } else {
      severity.medium += 1;
    }
  }

  // Categories
  const catCounts = new Map<string, number>();
  for (const t of tests) {
    const c = t.category ?? 'other';
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const categories: CategoryBucket[] = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, name: id, count, color: colorForCategory(id) }));

  // Avg score — only tests with a positive score (matches the legacy
  // TestLibraryOverview behavior so the dashboard and the old Browser
  // page agree on the headline number).
  const scored = tests.filter((t) => typeof t.score === 'number' && (t.score ?? 0) > 0);
  const avgScore =
    scored.length > 0
      ? scored.reduce((sum, t) => sum + (t.score ?? 0), 0) / scored.length
      : 0;

  // Top rated: top 6 by score desc
  const topRated = [...scored]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6)
    .map((t) => ({
      uuid: t.uuid,
      name: t.name,
      severity: (t.severity ?? 'medium').toLowerCase(),
      score: Number((t.score ?? 0).toFixed(1)),
    }));

  // Recently modified: top 6 by lastModifiedDate desc
  const recentlyModified = [...tests]
    .filter((t) => t.lastModifiedDate)
    .sort((a, b) => (new Date(b.lastModifiedDate!).getTime() - new Date(a.lastModifiedDate!).getTime()))
    .slice(0, 6)
    .map((t) => ({
      uuid: t.uuid,
      name: t.name,
      severity: (t.severity ?? 'medium').toLowerCase(),
      when: relTime(t.lastModifiedDate),
      modifiedAt: t.lastModifiedDate ?? null,
    }));

  // Run queue: active tasks (pending/assigned/downloading/executing), top 5 by created_at desc
  const ACTIVE: ReadonlyArray<string> = ['pending', 'assigned', 'downloading', 'executing'];
  const runQueue = tasks
    .filter((t) => ACTIVE.includes(t.status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)
    .map((t) => {
      const isExecuting = t.status === 'executing' || t.status === 'downloading';
      return {
        id: t.id,
        name: t.payload?.test_name ?? `Task ${t.id.slice(0, 8)}`,
        severity: 'high',
        progress: isExecuting ? 50 : null,
        status: t.status,
      };
    });

  return {
    totalTests: total,
    critHighCount: severity.critical + severity.high,
    techniqueCount: techniqueSet.size,
    tacticCount: tactics.filter((t) => t.covered > 0).length,
    categoryCount: categories.length,
    avgScore,
    testsScored: scored.length,
    tactics,
    severity,
    categories,
    topRated,
    recentlyModified,
    runQueue,
  };
}

const EMPTY: Omit<DashboardData, 'loading' | 'error'> = {
  totalTests: 0,
  critHighCount: 0,
  techniqueCount: 0,
  tacticCount: 0,
  categoryCount: 0,
  avgScore: 0,
  testsScored: 0,
  tactics: [],
  severity: { critical: 0, high: 0, medium: 0, low: 0 },
  categories: [],
  topRated: [],
  recentlyModified: [],
  runQueue: [],
};

/** Caller-supplied result type — `refresh()` is exposed so the Sync button
    can force a re-aggregation after a successful test catalog sync. */
export interface UseDashboardData extends DashboardData {
  refresh: () => void;
}

export function useDashboardData(): UseDashboardData {
  const [data, setData] = useState<Omit<DashboardData, 'loading' | 'error'>>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      browserApi.getAllTests().catch(() => [] as TestMetadata[]),
      agentApi.listTasks({ limit: 50 }).then((r) => r.tasks).catch(() => [] as AgentTask[]),
    ])
      .then(([tests, tasks]) => {
        if (cancelled) return;
        setData(aggregate(tests, tasks));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { loading, error, ...data, refresh: () => setTick((n) => n + 1) };
}
