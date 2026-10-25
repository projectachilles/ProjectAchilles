import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { TechniqueCoverageResponse } from '@/services/api/integrationTypes';
import type { IntegrationVendor } from './vendorConfig';

const VISIBLE_ROWS = 7;

const PREVENTED = 'var(--chart-series-exec)';
const DETECTED = 'var(--chart-series-alert)';
const MISSED = 'var(--danger-dim)';

interface Props {
  vendor: IntegrationVendor;
  data: TechniqueCoverageResponse | null;
  loading: boolean;
  /** The coverage request failed. */
  error?: boolean;
  onSelectTechnique: (technique: string) => void;
}

/** Stacked prevented / detected-only / missed bar; widths are shares of `total`. */
function StackedBar({
  prevented,
  detectedOnly,
  missed,
  total,
  className,
}: {
  prevented: number;
  detectedOnly: number;
  missed: number;
  total: number;
  className: string;
}) {
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');
  return (
    <div className={`flex overflow-hidden rounded-full bg-muted ${className}`} aria-hidden="true">
      <div style={{ width: pct(prevented), background: PREVENTED }} />
      <div style={{ width: pct(detectedOnly), background: DETECTED }} />
      <div style={{ width: pct(missed), background: MISSED }} />
    </div>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

function CountCell({ value, className = '' }: { value: number; className?: string }) {
  return (
    <td className={`py-2 pr-3 text-right font-mono ${value === 0 ? 'text-faint' : ''} ${className}`}>{value}</td>
  );
}

export default function TechniqueCoverageCard({ vendor, data, loading, error, onSelectTechnique }: Props) {
  const [expanded, setExpanded] = useState(false);
  const product = vendor.product;
  const overall = data?.overall;
  const rows = data?.byTechnique ?? [];
  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  const hidden = rows.length - VISIBLE_ROWS;

  return (
    <section aria-label="Technique coverage">
      <Card>
        <CardHeader>
          <CardTitle>Technique coverage</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every technique Achilles exercised, and what {product} did about it
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && !data && (
            <div role="status" className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading technique coverage" />
            </div>
          )}

          {error && !loading && !data && (
            <p role="alert" className="py-8 text-center text-sm text-danger">
              Unable to load technique coverage
            </p>
          )}

          {overall && overall.executions === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No technique runs in this range</p>
          )}

          {overall && overall.executions > 0 && (
            <>
              <div className="space-y-2">
                <StackedBar
                  prevented={overall.prevented}
                  detectedOnly={overall.detectedOnly}
                  missed={overall.missed}
                  total={overall.executions}
                  className="h-2 w-full"
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Legend color={PREVENTED}>{overall.prevented} prevented</Legend>
                  <Legend color={DETECTED}>{overall.detectedOnly} detected only</Legend>
                  <Legend color={MISSED}>{overall.missed} no alert</Legend>
                  <span className="text-xs text-muted-foreground">of {overall.executions} executions</span>
                </div>
              </div>

              <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Technique</th>
                      <th className="py-2 pr-3 text-right font-medium">Tests</th>
                      <th className="w-40 py-2 pr-3 font-medium"><span className="sr-only">Response</span></th>
                      <th className="py-2 pr-3 text-right font-medium">Prevented</th>
                      <th className="py-2 pr-3 text-right font-medium">Detected only</th>
                      <th className="py-2 pr-3 text-right font-medium">Missed</th>
                      <th className="py-2 text-right font-medium">Alerts (in window)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((t) => (
                      <tr key={t.technique} data-testid="technique-row" className="border-b border-border/50">
                        <td className="py-2 pr-3">
                          <button
                            type="button"
                            className="font-mono text-xs text-accent hover:underline"
                            onClick={() => onSelectTechnique(t.technique)}
                          >
                            {t.technique}
                          </button>
                          {t.name && <span className="ml-2 text-muted-foreground">{t.name}</span>}
                        </td>
                        <CountCell value={t.executions} />
                        <td className="py-2 pr-3">
                          <StackedBar
                            prevented={t.prevented}
                            detectedOnly={t.detectedOnly}
                            missed={t.missed}
                            total={t.executions}
                            className="h-1.5 w-full"
                          />
                        </td>
                        <CountCell value={t.prevented} />
                        <CountCell value={t.detectedOnly} />
                        <CountCell value={t.missed} />
                        <td className="py-2 text-right">
                          <span className={`font-mono ${t.alerts === 0 ? 'text-faint' : ''}`}>{t.alerts}</span>
                          {t.alerts > 0 && t.prevented + t.detectedOnly === 0 && (
                            <span className="ml-2 rounded bg-warning-dim px-1.5 py-0.5 text-xs text-warning">
                              none matched a run
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hidden > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => setExpanded((e) => !e)}>
                  {expanded ? 'Show fewer' : `Show ${hidden} more techniques`}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
