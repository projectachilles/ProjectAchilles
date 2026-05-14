import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { defenderApi, type TechniqueOverlapItem } from '@/services/api/defender';
import { DEFENDER_CHART_COLORS } from '../utils/defenderChartColors';

const TEST_COLOR = DEFENDER_CHART_COLORS.detected;
const ALERT_COLOR = DEFENDER_CHART_COLORS.missed;

interface TechniqueOverlapChartProps {
  onSelectTechnique?: (technique: string) => void;
}

/**
 * Per-technique view of test execution volume vs Defender alert volume.
 * Renders HTML/CSS bars (not SVG) so the visual density stays consistent with
 * DetectionAnalysisCard when both are placed side-by-side at half width —
 * an SVG with `w-full` auto-scales and produces wildly different bar
 * thicknesses depending on container width.
 */
export default function TechniqueOverlapChart({
  onSelectTechnique,
}: TechniqueOverlapChartProps = {}) {
  const [data, setData] = useState<TechniqueOverlapItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    defenderApi.getTechniqueOverlap()
      .then(setData)
      .catch((err) => console.error('Failed to load technique overlap:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">No overlapping techniques found</span>
      </Card>
    );
  }

  const maxCount = Math.max(...data.map((d) => Math.max(d.testResults, d.defenderAlerts)));
  const topItems = data.slice(0, 10);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          MITRE Technique Overlap
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({data.length} shared techniques)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-auto">
        {/* Legend */}
        <div className="flex gap-4 mb-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: TEST_COLOR }} />
            <span className="text-muted-foreground">Test Results</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: ALERT_COLOR }} />
            <span className="text-muted-foreground">Defender Alerts</span>
          </div>
        </div>

        {/* Per-technique rows */}
        <div
          className="space-y-2"
          role="list"
          aria-label="MITRE technique overlap: test results vs Defender alerts"
        >
          {topItems.map((item) => {
            const testPct = maxCount > 0 ? (item.testResults / maxCount) * 100 : 0;
            const alertPct = maxCount > 0 ? (item.defenderAlerts / maxCount) * 100 : 0;
            const clickable = !!onSelectTechnique;
            const rowClass = clickable
              ? 'flex items-start gap-2 text-xs cursor-pointer rounded px-1 -mx-1 hover:bg-muted/40 transition-colors'
              : 'flex items-start gap-2 text-xs';

            return (
              <div
                key={item.technique}
                className={rowClass}
                role={clickable ? 'button' : 'listitem'}
                aria-label={
                  clickable
                    ? `${item.technique}: ${item.testResults} test results, ${item.defenderAlerts} Defender alerts. Click to view related alerts.`
                    : `${item.technique}: ${item.testResults} test results, ${item.defenderAlerts} Defender alerts`
                }
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => onSelectTechnique!(item.technique) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectTechnique!(item.technique);
                        }
                      }
                    : undefined
                }
              >
                <span className="w-16 font-mono text-muted-foreground shrink-0 pt-0.5">
                  {item.technique}
                </span>
                <div className="flex-1 space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-3 bg-muted/30 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all"
                        style={{ width: `${testPct}%`, backgroundColor: TEST_COLOR }}
                      />
                    </div>
                    <span className="w-10 text-right text-muted-foreground tabular-nums shrink-0">
                      {item.testResults}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-3 bg-muted/30 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all"
                        style={{ width: `${alertPct}%`, backgroundColor: ALERT_COLOR }}
                      />
                    </div>
                    <span className="w-10 text-right text-muted-foreground tabular-nums shrink-0">
                      {item.defenderAlerts}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
