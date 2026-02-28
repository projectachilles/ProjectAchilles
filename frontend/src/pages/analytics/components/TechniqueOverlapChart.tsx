import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { defenderApi, type TechniqueOverlapItem } from '@/services/api/defender';

const TEST_COLOR = 'oklch(0.65 0.22 145)';    // Green
const ALERT_COLOR = 'oklch(0.6 0.22 25)';     // Red

export default function TechniqueOverlapChart() {
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
  const barH = 16;
  const gap = 6;
  const labelW = 60;
  const chartW = 400;
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

        <svg
          viewBox={`0 0 ${labelW + chartW + 40} ${topItems.length * (barH * 2 + gap) + 4}`}
          className="w-full h-auto"
        >
          {topItems.map((item, i) => {
            const y = i * (barH * 2 + gap);
            const testW = maxCount > 0 ? (item.testResults / maxCount) * chartW : 0;
            const alertW = maxCount > 0 ? (item.defenderAlerts / maxCount) * chartW : 0;

            return (
              <g key={item.technique}>
                {/* Label */}
                <text
                  x={labelW - 4}
                  y={y + barH}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground"
                  fontSize={10}
                  stroke="none"
                >
                  {item.technique}
                </text>

                {/* Test Results bar */}
                <rect x={labelW} y={y} width={testW} height={barH} rx={2} fill={TEST_COLOR} />
                <text
                  x={labelW + testW + 4}
                  y={y + barH / 2}
                  dominantBaseline="middle"
                  className="fill-muted-foreground"
                  fontSize={9}
                  stroke="none"
                >
                  {item.testResults}
                </text>

                {/* Alerts bar */}
                <rect x={labelW} y={y + barH} width={alertW} height={barH} rx={2} fill={ALERT_COLOR} />
                <text
                  x={labelW + alertW + 4}
                  y={y + barH + barH / 2}
                  dominantBaseline="middle"
                  className="fill-muted-foreground"
                  fontSize={9}
                  stroke="none"
                >
                  {item.defenderAlerts}
                </text>
              </g>
            );
          })}
        </svg>
      </CardContent>
    </Card>
  );
}
