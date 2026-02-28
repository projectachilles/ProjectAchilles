import { useState, useEffect, useCallback } from 'react';
import { Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { defenderApi, type DefenderAlertItem } from '@/services/api/defender';

const SEVERITY_BADGE: Record<string, string> = {
  high: 'bg-red-500/10 text-red-500',
  medium: 'bg-amber-500/10 text-amber-500',
  low: 'bg-blue-500/10 text-blue-500',
  informational: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

const STATUS_BADGE: Record<string, string> = {
  new: 'bg-red-500/10 text-red-500',
  inProgress: 'bg-amber-500/10 text-amber-500',
  resolved: 'bg-green-500/10 text-green-500',
};

export default function DefenderAlertsTable() {
  const [alerts, setAlerts] = useState<DefenderAlertItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const pageSize = 15;

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await defenderApi.getAlerts({
        page,
        pageSize,
        severity: severityFilter || undefined,
        status: statusFilter || undefined,
        search: search || undefined,
      });
      setAlerts(data.data);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setLoading(false);
    }
  }, [page, severityFilter, statusFilter, search]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Defender Alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search alerts..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-8 pr-3 py-2 text-sm border rounded-md bg-background"
            />
          </div>
          <select
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border rounded-md bg-background"
          >
            <option value="">All Severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="informational">Informational</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border rounded-md bg-background"
          >
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="inProgress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">No alerts found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 font-medium text-muted-foreground">Title</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-24">Severity</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-24">Status</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-32">Category</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground w-32">Source</th>
                  <th className="pb-2 font-medium text-muted-foreground w-28">Created</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.alert_id} className="border-b border-border/50 hover:bg-accent/50">
                    <td className="py-2 pr-4">
                      <div className="font-medium truncate max-w-[300px]">{alert.alert_title}</div>
                      {alert.mitre_techniques.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {alert.mitre_techniques.slice(0, 3).map((t) => (
                            <span key={t} className="px-1 py-0.5 text-xs bg-muted rounded">
                              {t}
                            </span>
                          ))}
                          {alert.mitre_techniques.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{alert.mitre_techniques.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${SEVERITY_BADGE[alert.severity] ?? SEVERITY_BADGE.unknown}`}>
                        {alert.severity}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[alert.status] ?? 'bg-muted text-muted-foreground'}`}>
                        {alert.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground truncate max-w-[120px]">
                      {alert.category}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground truncate max-w-[120px]">
                      {alert.service_source}
                    </td>
                    <td className="py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(alert.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">
              {total.toLocaleString()} alerts
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1 rounded hover:bg-accent disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-sm">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1 rounded hover:bg-accent disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
