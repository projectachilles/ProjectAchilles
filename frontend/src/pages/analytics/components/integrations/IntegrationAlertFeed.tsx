import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  AlertSource,
  IntegrationAlertItem,
  IntegrationAlertPage,
} from '@/services/api/integrationTypes';
import { getSeverityTokens } from '../../utils/crowdstrikeSeverityTokens';
import { formatTimeAgo } from '../../utils/timeAgo';
import { groupSeverities } from './severity';
import type { IntegrationVendor, TimeWindow } from './vendorConfig';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const SOURCES: { key: AlertSource; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'test', label: 'Linked to tests' },
  { key: 'organic', label: 'Organic' },
];

const RESPONSE_LABELS: Record<NonNullable<IntegrationAlertItem['prevention_action']>, string> = {
  quarantined: 'Quarantined',
  process_killed: 'Process killed',
  blocked: 'Blocked',
  kill_failed: 'Kill failed',
};

interface Props {
  vendor: IntegrationVendor;
  window: TimeWindow;
  windowLabel: string;
  /**
   * Bump to re-request the current page and filters with the same window
   * (Sync Now on a custom range). Unlike a window change, it keeps the page.
   */
  refreshKey?: number;
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </span>
  );
}

function LinkedTestCell({ alert }: { alert: IntegrationAlertItem }) {
  if (!alert.achilles_correlated) return <span className="text-muted-foreground">Organic</span>;
  if (alert.achilles_test_name) {
    // A bundle uuid resolves to its bundle_name, which only the `bundleNames`
    // filter matches; the `tests` filter matches f0rtika.test_name (on bundle
    // control docs that is the control's name, not the bundle's).
    const param = alert.achilles_test_kind === 'bundle' ? 'bundleNames' : 'tests';
    return (
      <Link
        to={`/analytics?tab=executions&${param}=${encodeURIComponent(alert.achilles_test_name)}`}
        className="text-accent hover:underline"
      >
        {alert.achilles_test_name}
      </Link>
    );
  }
  return <span>{alert.achilles_test_uuid?.slice(0, 8) ?? '—'}</span>;
}

export default function IntegrationAlertFeed({ vendor, window, windowLabel, refreshKey = 0 }: Props) {
  // Endpoint-EDR layout (host column, prevention facet).
  const isCs = vendor.endpointEdr;
  const [source, setSource] = useState<AlertSource>('all');
  const [severityKey, setSeverityKey] = useState(vendor.defaultSeverityKey);
  const [alertTypeKey, setAlertTypeKey] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<IntegrationAlertPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // The date range is a filter: reset to page 1 when it changes (adjusted during
  // render so only one request fires).
  const windowKey = `${window.from}|${window.to}`;
  const [prevWindowKey, setPrevWindowKey] = useState(windowKey);
  if (prevWindowKey !== windowKey) {
    setPrevWindowKey(windowKey);
    setPage(1);
  }

  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const segment =
    vendor.severitySegments.find((s) => s.key === severityKey) ?? vendor.severitySegments[0];
  const sourceType = vendor.alertTypeSegments?.find((s) => s.key === alertTypeKey)?.sourceType ?? undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    vendor.api
      .getAlerts({
        page,
        pageSize: PAGE_SIZE,
        source,
        severities: segment.severities ?? undefined,
        ...(sourceType ? { sourceType } : {}),
        search,
        from: window.from,
        to: window.to,
      })
      .then((r) => {
        if (cancelled) return;
        // A refresh (Sync Now keeps the page) can shrink the result below the
        // current page: re-request the last page instead of showing an empty one.
        const lastPage = Math.max(1, Math.ceil(r.total / PAGE_SIZE));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setResult(r);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vendor, page, source, segment, sourceType, search, window.from, window.to, reloadKey, refreshKey]);

  const changeSource = (s: AlertSource) => {
    setSource(s);
    setPage(1);
  };
  const changeSeverity = (k: string) => {
    setSeverityKey(k);
    setPage(1);
  };
  const changeAlertType = (k: string) => {
    setAlertTypeKey(k);
    setPage(1);
  };

  const counts = result?.counts;
  const total = result?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const severityGroups = counts ? groupSeverities(counts.bySeverity, vendor.knownSeverities) : [];
  const severityTotal = severityGroups.reduce((n, g) => n + g.count, 0);

  const productEntries = Object.entries(counts?.byProduct ?? {}).sort((a, b) => b[1] - a[1]);
  const topProducts = productEntries.slice(0, 3);
  const otherProducts = productEntries.slice(3).reduce((n, [, c]) => n + c, 0);

  return (
    <section id="alert-feed" aria-label={vendor.alertsTitle} tabIndex={-1} className="scroll-mt-4 outline-none">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline gap-2">
            {vendor.alertsTitle}
            <span className="text-xs font-normal text-muted-foreground">{windowLabel}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {counts && (
            <div className="space-y-2">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                {severityGroups
                  .filter((g) => g.count > 0)
                  .map((g) => (
                    <div
                      key={g.key}
                      className={getSeverityTokens(g.key).bar}
                      style={{ width: `${(g.count / severityTotal) * 100}%` }}
                    />
                  ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {severityGroups.map((g) => (
                  <SummaryItem key={g.key} label={g.label} value={g.count} />
                ))}
                <span className="hidden text-border sm:inline" aria-hidden="true">|</span>
                {isCs && counts.byPrevention && (
                  <>
                    <SummaryItem label="Prevented" value={counts.byPrevention.prevented} />
                    <SummaryItem label="Detected only" value={counts.byPrevention.detected_only} />
                    <SummaryItem label="Kill failed" value={counts.byPrevention.kill_failed} />
                  </>
                )}
                {!isCs && (
                  <>
                    {topProducts.map(([name, c]) => (
                      <SummaryItem key={name} label={name} value={c} />
                    ))}
                    {otherProducts > 0 && <SummaryItem label="Other" value={otherProducts} />}
                  </>
                )}
                <SummaryItem label="Auto-resolved" value={counts.autoResolved} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Alert source">
              {SOURCES.map((s) => (
                <Button
                  key={s.key}
                  type="button"
                  size="sm"
                  variant={source === s.key ? 'default' : 'outline'}
                  aria-pressed={source === s.key}
                  onClick={() => changeSource(s.key)}
                >
                  <span>{s.label}</span>
                  {counts && <span className="font-mono opacity-80">{counts.bySource[s.key]}</span>}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Severity">
              {vendor.severitySegments.map((s) => (
                <Button
                  key={s.key}
                  type="button"
                  size="sm"
                  variant={severityKey === s.key ? 'default' : 'outline'}
                  aria-pressed={severityKey === s.key}
                  onClick={() => changeSeverity(s.key)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            {vendor.alertTypeSegments && (
              <div className="flex flex-wrap gap-1" role="group" aria-label="Alert type">
                {vendor.alertTypeSegments.map((s) => (
                  <Button
                    key={s.key}
                    type="button"
                    size="sm"
                    variant={alertTypeKey === s.key ? 'default' : 'outline'}
                    aria-pressed={alertTypeKey === s.key}
                    onClick={() => changeAlertType(s.key)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            )}
            <div className="relative ml-auto w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <Input
                className="pl-8"
                placeholder="Search alerts"
                aria-label="Search alerts"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>

          {error ? (
            <div role="alert" className="flex items-center gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              <span>Unable to load alerts</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="relative overflow-x-auto" aria-busy={loading}>
              {loading && !result && (
                <div role="status" className="flex justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading alerts" />
                </div>
              )}
              {result && (
                <table className={`w-full min-w-[56rem] text-sm ${loading ? 'opacity-60' : ''}`}>
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Severity</th>
                      <th className="py-2 pr-3 font-medium">Alert</th>
                      <th className="py-2 pr-3 font-medium">{isCs ? 'Host' : 'Device / entity'}</th>
                      {isCs ? (
                        <th className="py-2 pr-3 font-medium">{vendor.responseLabel}</th>
                      ) : (
                        <th className="py-2 pr-3 font-medium">Product</th>
                      )}
                      <th className="py-2 pr-3 font-medium">Technique</th>
                      <th className="py-2 pr-3 font-medium">Linked test</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Age</th>
                      <th className="py-2 font-medium"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((a) => {
                      const tokens = getSeverityTokens(a.severity);
                      return (
                        <tr key={a.alert_id} className="border-b border-border/50">
                          <td className="py-2 pr-3">
                            <span className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${tokens.bg} ${tokens.text}`}>
                              {a.severity}
                            </span>
                          </td>
                          <td className="max-w-[20rem] truncate py-2 pr-3" title={a.alert_title}>{a.alert_title}</td>
                          <td className="py-2 pr-3">{a.hostname ?? '—'}</td>
                          {isCs ? (
                            <td className="py-2 pr-3">
                              {a.prevention_action ? RESPONSE_LABELS[a.prevention_action] : 'Detected only'}
                            </td>
                          ) : (
                            <td className="py-2 pr-3">{a.service_source ?? '—'}</td>
                          )}
                          <td className="py-2 pr-3 font-mono text-xs">{a.mitre_techniques[0] ?? '—'}</td>
                          <td className="py-2 pr-3"><LinkedTestCell alert={a} /></td>
                          <td className="py-2 pr-3 capitalize">{a.status}</td>
                          <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{formatTimeAgo(a.created_at)}</td>
                          <td className="py-2">
                            {a.portal_url && (
                              <a
                                href={a.portal_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={vendor.portalLabel}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <ExternalLink className="size-4" aria-hidden="true" />
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {result && !loading && result.data.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No alerts match these filters</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {total} alert{total === 1 ? '' : 's'} · page {Math.min(page, pageCount)} of {pageCount}
            </span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
