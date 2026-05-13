import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { defenderApi, type DetectionRateResponse } from '@/services/api/defender';
import { DEFENDER_CHART_COLORS } from '../utils/defenderChartColors';

const DETECTED_COLOR = DEFENDER_CHART_COLORS.detected;
const MISSED_COLOR = DEFENDER_CHART_COLORS.missed;

interface DetectionAnalysisCardProps {
  onSelectTechnique?: (technique: string) => void;
}

export default function DetectionAnalysisCard({
  onSelectTechnique,
}: DetectionAnalysisCardProps = {}) {
  const [data, setData] = useState<DetectionRateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [windowMinutes, setWindowMinutes] = useState(60);

  useEffect(() => {
    setLoading(true);
    defenderApi.getDetectionRate(days, windowMinutes)
      .then(setData)
      .catch((err) => console.error('Failed to load detection rate:', err))
      .finally(() => setLoading(false));
  }, [days, windowMinutes]);

  if (loading || !data || data.byTechnique.length === 0) {
    return null;
  }

  const maxTests = Math.max(...data.byTechnique.map((t) => t.testExecutions));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Detection Analysis</CardTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-secondary border border-border rounded px-2 py-1 text-xs"
            >
              <option value={7}>7d</option>
              <option value={30}>30d</option>
              <option value={90}>90d</option>
            </select>
            <select
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(Number(e.target.value))}
              className="bg-secondary border border-border rounded px-2 py-1 text-xs"
            >
              <option value={30}>&plusmn;30 min</option>
              <option value={60}>&plusmn;60 min</option>
              <option value={120}>&plusmn;2 hr</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Headline metric */}
        <div className="mb-4 flex items-baseline gap-2">
          <span className="text-2xl font-bold">{data.overall.detectionRate}%</span>
          <span className="text-sm text-muted-foreground">
            detection rate ({data.overall.detectedTechniques}/{data.overall.testedTechniques} techniques)
          </span>
        </div>

        {/* Per-technique bars */}
        <div className="space-y-1.5">
          {data.byTechnique.map((item) => {
            const barWidth = maxTests > 0 ? (item.testExecutions / maxTests) * 100 : 0;
            const clickable = !!onSelectTechnique;
            const rowClass = clickable
              ? 'flex items-center gap-2 text-xs cursor-pointer rounded px-1 -mx-1 hover:bg-muted/40 transition-colors'
              : 'flex items-center gap-2 text-xs';
            return (
              <div
                key={item.technique}
                className={rowClass}
                onClick={clickable ? () => onSelectTechnique!(item.technique) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
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
                {/* Technique label */}
                <span className="w-14 font-mono text-muted-foreground shrink-0">
                  {item.technique}
                </span>

                {/* Bar */}
                <div className="flex-1 h-4 bg-muted/30 rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: item.detected ? DETECTED_COLOR : MISSED_COLOR,
                      opacity: item.detected ? 1 : 0.6,
                    }}
                  />
                </div>

                {/* Count */}
                <span className="w-16 text-right text-muted-foreground shrink-0">
                  {item.testExecutions} {item.testExecutions === 1 ? 'test' : 'tests'}
                </span>

                {/* Detection indicator */}
                <span className="w-24 flex items-center gap-1 shrink-0">
                  {item.detected ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                      <span className="text-green-600 dark:text-green-400">
                        {item.correlatedAlerts} {item.correlatedAlerts === 1 ? 'alert' : 'alerts'}
                      </span>
                    </>
                  ) : (
                    <>
                      <ShieldX className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-red-600 dark:text-red-400">no alerts</span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
