import { useState, useEffect } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { defenderApi, type ControlItem } from '@/services/api/defender';

const COST_BADGE: Record<string, string> = {
  Low: 'bg-green-500/10 text-green-500',
  Moderate: 'bg-amber-500/10 text-amber-500',
  High: 'bg-red-500/10 text-red-500',
};

export default function DefenderControlsTable() {
  const [controls, setControls] = useState<ControlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    defenderApi.getControls({
      category: categoryFilter || undefined,
      deprecated: false,
    })
      .then(setControls)
      .catch((err) => console.error('Failed to load controls:', err))
      .finally(() => setLoading(false));
  }, [categoryFilter]);

  // Extract unique categories
  const categories = Array.from(new Set(controls.map((c) => c.control_category))).sort();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Security Controls</CardTitle>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded-md bg-background"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : controls.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">No controls found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-8">#</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground">Control</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-28">Category</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-20">Cost</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-20">Impact</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-16">Points</th>
                  <th className="pb-2 font-medium text-muted-foreground w-12"></th>
                </tr>
              </thead>
              <tbody>
                {controls.map((ctrl) => (
                  <tr key={ctrl.control_name} className="border-b border-border/50 hover:bg-accent/50">
                    <td className="py-2 pr-4 text-muted-foreground tabular-nums">{ctrl.rank}</td>
                    <td className="py-2 pr-4">
                      <div className="font-medium">{ctrl.title}</div>
                      {ctrl.threats.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {ctrl.threats.slice(0, 2).map((t) => (
                            <span key={t} className="px-1 py-0.5 text-xs bg-muted rounded truncate max-w-[120px]">
                              {t}
                            </span>
                          ))}
                          {ctrl.threats.length > 2 && (
                            <span className="text-xs text-muted-foreground">+{ctrl.threats.length - 2}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{ctrl.control_category}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${COST_BADGE[ctrl.implementation_cost] ?? 'bg-muted text-muted-foreground'}`}>
                        {ctrl.implementation_cost}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${COST_BADGE[ctrl.user_impact] ?? 'bg-muted text-muted-foreground'}`}>
                        {ctrl.user_impact}
                      </span>
                    </td>
                    <td className="py-2 pr-4 tabular-nums font-medium">{ctrl.max_score}</td>
                    <td className="py-2">
                      {ctrl.action_url && (
                        <a
                          href={ctrl.action_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
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
