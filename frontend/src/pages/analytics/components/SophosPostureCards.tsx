// Sophos posture cards for the Sophos analytics tab: Health Check details,
// endpoint health counts, exclusion / allow-list gaps and the threat-protection
// policy table. All data is the local snapshot the backend posture pass stores
// (read-only GETs, refreshed every 6 hours).

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  sophosAnalyticsApi,
  type SophosEndpointHealth,
  type SophosExclusionGapReport,
  type SophosHealthCategoryId,
  type SophosHealthCheckResponse,
  type SophosPolicyRow,
} from '@/services/api/sophosAnalytics';
import type { TimeWindow } from './integrations/vendorConfig';

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

/** Display labels for the four Health Check categories. */
export const SOPHOS_CATEGORY_LABELS: Record<SophosHealthCategoryId, string> = {
  protection: 'Protection',
  policy: 'Policy',
  exclusions: 'Exclusions',
  tamper_protection: 'Tamper',
};

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

type LoadState = 'loading' | 'ok' | 'error';

// ─────────────────────────────────────────────────────────────────────

/** "Computers 98 · Servers 91", or "Global 40" for the global-only categories. */
function breakdown(c: { computer?: number | null; server?: number | null; global?: number | null }): string {
  const parts: string[] = [];
  if (c.computer != null) parts.push(`Computers ${c.computer}`);
  if (c.server != null) parts.push(`Servers ${c.server}`);
  if (c.global != null) parts.push(`Global ${c.global}`);
  return parts.join(' · ');
}

export function SophosHealthCheckBand({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<SophosHealthCheckResponse | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    sophosAnalyticsApi
      .getHealthCheck(30)
      .then((r) => { if (!cancelled) { setData(r); setState('ok'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const snap = data?.latest ?? null;
  const items = snap?.items;
  // Items are count summaries from the Health Check API, never hostnames.
  const detail: Record<SophosHealthCategoryId, string[]> = {
    protection: items?.notFullyProtected ?? [],
    policy: (items?.notOnRecommended ?? []).map((p) => `"${p.policy}": ${p.settings.join(', ')}`),
    exclusions: (items?.riskyExclusions ?? []).map((e) => `${e.value} (${e.type})`),
    tamper_protection: items?.tamperDisabled ?? [],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Health Check details
          <span className="text-xs font-normal text-muted-foreground">from Sophos Central Account Health Check</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state === 'loading' && <Loading />}
        {state === 'error' && <Empty>Could not load the Health Check.</Empty>}
        {state === 'ok' && (!snap || snap.categories.length === 0) && (
          <Empty>No Health Check yet: it appears after the next posture sync (every 6 hours)</Empty>
        )}
        {state === 'ok' && snap && snap.categories.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {snap.categories.map((c) => (
              <div key={c.category} className="rounded border border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs uppercase text-muted-foreground">{SOPHOS_CATEGORY_LABELS[c.category] ?? c.category}</span>
                  <span className="font-mono text-lg font-semibold text-foreground">{c.score ?? '—'}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{breakdown(c)}</div>
                {detail[c.category]?.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-orange-500">
                    {detail[c.category].map((d) => <li key={d} className="break-words">{d}</li>)}
                  </ul>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Nothing flagged</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────

export function SophosEndpointHealthCard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<SophosEndpointHealth | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    sophosAnalyticsApi
      .getEndpointHealth()
      .then((r) => { if (!cancelled) { setData(r); setState('ok'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const tiles: Array<[string, number | undefined, boolean]> = [
    ['Endpoints', data?.total, false],
    ['Not seen in 7 days', data?.notSeen7d, true],
    ['Out of date', data?.outOfDate, true],
    ['Tamper off', data?.tamperOff, true],
    ['Isolated', data?.isolated, true],
    ['Health bad', data?.healthBad, true],
    ['Health suspicious', data?.healthSuspicious, true],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Endpoint health
          <span className="text-xs font-normal text-muted-foreground">from the Endpoint API</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state === 'loading' && <Loading />}
        {state === 'error' && <Empty>Could not load endpoint health.</Empty>}
        {state === 'ok' && (!data || data.total === 0) && (
          <Empty>No endpoint snapshot yet. The posture pass runs with the next sync (then every 6 hours).</Empty>
        )}
        {state === 'ok' && data && data.total > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Endpoint health counts">
              {tiles.map(([label, n, warn]) => (
                <div key={label} className="rounded border border-border p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className={`text-xl font-semibold ${warn && (n ?? 0) > 0 ? 'text-orange-500' : 'text-foreground'}`}>{num(n)}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              XDR sensor installed on {num(data.xdrInstalled)} of {num(data.total)} endpoints.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────

const CRITICAL_KIND_LABELS: Record<SophosExclusionGapReport['critical'][number]['kind'], string> = {
  certificate_allow: 'Certificate allowed',
  folder_exclusion: 'Folder exclusion',
  agent_process_exclusion: 'Agent process exclusion',
};

export function SophosExclusionGapCard({ window, windowLabel, refreshKey }: { window: TimeWindow; windowLabel: string; refreshKey: number }) {
  const [data, setData] = useState<SophosExclusionGapReport | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    sophosAnalyticsApi
      .getExclusionGaps(window)
      .then((r) => { if (!cancelled) { setData(r); setState('ok'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [window, refreshKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Exclusion &amp; allow-list gaps
          <span className="text-xs font-normal text-muted-foreground">{windowLabel}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === 'loading' && <Loading />}
        {state === 'error' && <Empty>Could not load the exclusion check.</Empty>}
        {state === 'ok' && data && (
          <>
            {data.critical.length > 0 && (
              <div className="space-y-2" aria-label="Critical exclusions">
                {data.critical.map((c) => (
                  <div key={`${c.kind}-${c.value}`} className="rounded border border-danger/40 bg-danger-dim p-3 text-sm">
                    <div className="text-xs uppercase text-danger">{CRITICAL_KIND_LABELS[c.kind] ?? c.kind}</div>
                    <div className="font-mono break-all" data-testid="critical-gap-value">{c.value}</div>
                    <div className="text-xs text-muted-foreground">{c.detail}</div>
                  </div>
                ))}
              </div>
            )}
            {data.gaps.length === 0 ? (
              <Empty>No unprotected test runs sit under a Sophos exclusion or allowed item in this range.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="p-2">Host</th><th className="p-2">Path</th><th className="p-2">Last run</th><th className="p-2">Exclusion</th></tr>
                  </thead>
                  <tbody>
                    {data.gaps.map((g) => (
                      <tr key={`${g.testUuid}-${g.hostname}-${g.exclusion}`} className="border-b border-border/50 align-top">
                        <td className="p-2">{g.hostname}</td>
                        <td className="p-2 font-mono text-xs break-all">{g.path}</td>
                        <td className="p-2 text-xs">{fmt(g.lastRunAt)}</td>
                        <td className="p-2 font-mono text-xs break-all">{g.exclusion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.notes.map((n) => (
              <p key={n} className="text-xs text-muted-foreground">{n}</p>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────

export function SophosPolicyTable({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<SophosPolicyRow[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    sophosAnalyticsApi
      .getPolicies()
      .then((r) => { if (!cancelled) { setRows(r); setState('ok'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Threat-protection policies
          <span className="text-xs font-normal text-muted-foreground">settings that differ from Sophos recommended</span>
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
                <tr><th className="p-2">Policy</th><th className="p-2">Applies to</th><th className="p-2">Differs from recommended</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 align-top">
                    <td className="p-2">
                      <div className="font-medium text-foreground">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.type}{r.enabled ? '' : ' · disabled'}</div>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{r.appliesTo.join(', ') || '—'}</td>
                    <td className="p-2 text-xs">
                      {r.deviations.length === 0 ? (
                        <span className="text-green-500">Matches recommended</span>
                      ) : (
                        r.deviations.map((d) => (
                          <div key={d.key}>
                            <span className="font-mono text-orange-500">{d.key}</span>
                            <span className="text-muted-foreground"> {String(d.value)} (recommended {String(d.recommended)})</span>
                          </div>
                        ))
                      )}
                    </td>
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
