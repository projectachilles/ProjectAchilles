// SentinelOne posture cards for the S1 analytics tab: agent health counts,
// protection policy per account / site / group (a plain table — no score), and
// missed tests that an S1 exclusion covers. All data comes from the local
// snapshot the backend posture pass stores (read-only GETs, every 6 h).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  sentineloneAnalyticsApi,
  type SentinelOneAgentHealthResponse,
  type SentinelOneExclusionGapReport,
  type SentinelOnePolicyRow,
} from '@/services/api/sentineloneAnalytics';
import type { TimeWindow } from './integrations/vendorConfig';

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

function Loading() {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
}

// ─────────────────────────────────────────────────────────────────────

export function SentinelOneAgentHealthCard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<SentinelOneAgentHealthResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    sentineloneAnalyticsApi
      .getAgentHealth(30)
      .then((r) => { if (!cancelled) { setData(r); setState('ok'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const c = data?.latest?.counts;
  const tiles: Array<[string, number | null | undefined, boolean]> = [
    ['Agents', c?.total, false],
    ['Active', c?.active, false],
    ['Infected', c?.infected, true],
    ['Detect-only', c?.detect_only, true],
    ['Outdated', c?.outdated, true],
    ['Disconnected (network)', c?.disconnected, false],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Agent health
          <span className="text-xs font-normal text-muted-foreground">
            {data?.latest ? `snapshot ${fmt(data.latest.timestamp)}` : 'from /agents/count'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state === 'loading' && <Loading />}
        {state === 'error' && <Empty>Could not load agent health.</Empty>}
        {state === 'ok' && !c && <Empty>No snapshot yet. The posture pass runs with the next sync (then every 6 hours).</Empty>}
        {state === 'ok' && c && data?.latest?.counts_error && (
          <Empty>
            SentinelOne refused the agent reads ({data.latest.counts_error}). The service user needs permission to view
            endpoints in this scope.
          </Empty>
        )}
        {state === 'ok' && c && !data?.latest?.counts_error && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Agent health counts">
            {tiles.map(([label, n, warn]) => (
              <div key={label} className="rounded border border-border p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className={`text-xl font-semibold ${warn && (n ?? 0) > 0 ? 'text-orange-500' : 'text-foreground'}`}>{num(n)}</div>
              </div>
            ))}
          </div>
        )}
        {state === 'ok' && c && !data?.latest?.counts_error && (
          <p className="mt-2 text-xs text-muted-foreground">
            Notification thresholds for these counts are under Settings → Alerts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────

function OnOff({ v }: { v: boolean | undefined }) {
  if (v === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className={v ? 'text-green-500' : 'text-orange-500'}>{v ? 'On' : 'Off'}</span>;
}

function modeLabel(m: string | undefined) {
  if (!m) return <span className="text-muted-foreground">—</span>;
  return <span className={m === 'protect' ? 'text-green-500' : 'text-orange-500'}>{m === 'protect' ? 'Protect' : m === 'detect' ? 'Detect' : m}</span>;
}

export function SentinelOnePolicyTable({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<SentinelOnePolicyRow[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    sentineloneAnalyticsApi
      .getPosturePolicies()
      .then((r) => { if (!cancelled) { setRows(r); setState('ok'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Protection policy
          <span className="text-xs font-normal text-muted-foreground">per account, site and group · as configured in SentinelOne</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state === 'loading' && <Loading />}
        {state === 'error' && <Empty>Could not load policies.</Empty>}
        {state === 'ok' && rows.length === 0 && <Empty>No policy snapshot yet. The posture pass runs with the next sync (then every 6 hours).</Empty>}
        {state === 'ok' && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Scope</th>
                  <th className="p-2">Threats</th>
                  <th className="p-2">Suspicious</th>
                  <th className="p-2">Anti-tamper</th>
                  <th className="p-2">Snapshots</th>
                  <th className="p-2">Engines off</th>
                  <th className="p-2">Engines on</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.level}-${r.scope_id}`} className="border-b border-border/50 align-top">
                    <td className="p-2">
                      <div className="font-medium text-foreground">{r.scope_name || r.scope_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.level}{r.level === 'group' && r.site_name ? ` · ${r.site_name}` : ''}
                      </div>
                    </td>
                    {r.policy_error ? (
                      <td className="p-2 text-xs text-orange-500" colSpan={6}>Not readable with this token ({r.policy_error})</td>
                    ) : r.level === 'group' && r.inherits ? (
                      <td className="p-2 text-xs text-muted-foreground" colSpan={6}>Inherits the site policy</td>
                    ) : (
                      <>
                        <td className="p-2">{modeLabel(r.mitigation_mode)}</td>
                        <td className="p-2">{modeLabel(r.mitigation_mode_suspicious)}</td>
                        <td className="p-2"><OnOff v={r.anti_tampering_on} /></td>
                        <td className="p-2"><OnOff v={r.snapshots_on} /></td>
                        <td className="p-2 text-xs text-orange-500">{r.engines_off.length ? r.engines_off.join(', ') : <span className="text-muted-foreground">none</span>}</td>
                        <td className="p-2 text-xs text-muted-foreground">{r.engines_on.join(', ') || '—'}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────

export function SentinelOneExclusionGapCard({ window, windowLabel, refreshKey }: { window: TimeWindow; windowLabel: string; refreshKey: number }) {
  const [data, setData] = useState<SentinelOneExclusionGapReport | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    sentineloneAnalyticsApi
      .getExclusionGaps(window)
      .then((r) => { if (!cancelled) { setData(r); setState('ok'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [window, refreshKey]);

  const types = Object.entries(data?.byType ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Missed tests covered by an exclusion
          <span className="text-xs font-normal text-muted-foreground">{windowLabel}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === 'loading' && <Loading />}
        {state === 'error' && <Empty>Could not load the exclusion check.</Empty>}
        {state === 'ok' && data && (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span><span className="text-muted-foreground">Exclusions</span> <span className="font-mono">{data.exclusionsTotal}</span></span>
              {types.map(([t, n]) => (
                <span key={t}><span className="text-muted-foreground">{t}</span> <span className="font-mono">{n}</span></span>
              ))}
              <span><span className="text-muted-foreground">Missed on S1 hosts</span> <span className="font-mono">{data.missedOnS1Hosts}</span></span>
              <span><span className="text-muted-foreground">Flagged</span> <span className="font-mono">{data.flagged.length}</span></span>
            </div>
            {data.flagged.length === 0 ? (
              <Empty>
                {data.missedOnS1Hosts === 0
                  ? 'No missed tests on SentinelOne hosts in this range.'
                  : 'None of the missed tests on SentinelOne hosts sit under a path exclusion.'}
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="p-2">Test</th><th className="p-2">Host</th><th className="p-2">Last run</th><th className="p-2">Exclusion</th></tr>
                  </thead>
                  <tbody>
                    {data.flagged.map((f) => (
                      <tr key={`${f.test_uuid}-${f.hostname}`} className="border-b border-border/50 align-top">
                        <td className="p-2">
                          {f.test_name ? (
                            <Link className="text-accent hover:underline" to={`/analytics?tab=executions&tests=${encodeURIComponent(f.test_name)}`}>{f.test_name}</Link>
                          ) : (
                            <span className="font-mono text-xs">{f.test_uuid}</span>
                          )}
                        </td>
                        <td className="p-2">{f.hostname} <span className="text-xs text-muted-foreground">({f.os})</span></td>
                        <td className="p-2 text-xs">{fmt(f.last_seen)}</td>
                        <td className="p-2 text-xs">
                          {f.exclusions.map((x) => (
                            <div key={x.exclusion_id} className="font-mono">
                              {x.value}
                              <span className="font-sans text-muted-foreground">
                                {x.path_exclusion_type ? ` · ${x.path_exclusion_type}` : ''}{x.exclusion_mode ? ` · ${x.exclusion_mode}` : ''}{x.scope_name ? ` · ${x.scope_name}` : ''}
                              </span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Path exclusions are matched against the Achilles agent work folders. Hash and certificate exclusions
              ({data.unmatchable}) can't be matched: test results carry no file hash.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
