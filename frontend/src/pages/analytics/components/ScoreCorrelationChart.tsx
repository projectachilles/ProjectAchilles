import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { defenderApi, type ScoreComparisonPoint } from '@/services/api/defender';

// SVG colors matching existing dashboard palette
const DEFENSE_COLOR = 'oklch(0.65 0.22 145)';  // Green (matches existing)
const SECURE_COLOR = 'oklch(0.65 0.18 260)';    // Blue

export default function ScoreCorrelationChart() {
  const [data, setData] = useState<ScoreComparisonPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    defenderApi.getScoreCorrelation(90)
      .then(setData)
      .catch((err) => console.error('Failed to load score correlation:', err))
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
        <span className="text-sm text-muted-foreground">No correlation data available</span>
      </Card>
    );
  }

  // SVG chart dimensions
  const width = 600;
  const height = 200;
  const padding = { top: 10, right: 10, bottom: 20, left: 35 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Scale helpers
  const xScale = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
  const yScale = (v: number) => padding.top + chartH - (v / 100) * chartH;

  function buildPath(points: (number | null)[], getX: (i: number) => number, getY: (v: number) => number): string {
    let d = '';
    for (let i = 0; i < points.length; i++) {
      if (points[i] === null) continue;
      const cmd = d === '' ? 'M' : 'L';
      d += `${cmd}${getX(i).toFixed(1)},${getY(points[i]!).toFixed(1)} `;
    }
    return d;
  }

  const defensePath = buildPath(data.map((d) => d.defenseScore), xScale, yScale);
  const securePath = buildPath(data.map((d) => d.secureScore), xScale, yScale);

  // Y-axis ticks
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Defense Score vs Secure Score</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        {/* Legend */}
        <div className="flex gap-4 mb-2 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5" style={{ backgroundColor: DEFENSE_COLOR }} />
            <span className="text-muted-foreground">Defense Score</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5" style={{ backgroundColor: SECURE_COLOR }} />
            <span className="text-muted-foreground">Secure Score</span>
          </div>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
          {/* Y-axis grid + labels */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yScale(tick)}
                y2={yScale(tick)}
                stroke="currentColor"
                strokeOpacity={0.1}
              />
              <text
                x={padding.left - 4}
                y={yScale(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={9}
                stroke="none"
              >
                {tick}%
              </text>
            </g>
          ))}

          {/* Lines */}
          {defensePath && (
            <path d={defensePath} fill="none" stroke={DEFENSE_COLOR} strokeWidth={2} />
          )}
          {securePath && (
            <path d={securePath} fill="none" stroke={SECURE_COLOR} strokeWidth={2} strokeDasharray="4 2" />
          )}
        </svg>
      </CardContent>
    </Card>
  );
}
