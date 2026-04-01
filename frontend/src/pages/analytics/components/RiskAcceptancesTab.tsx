import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Globe,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { analyticsApi, type RiskAcceptance } from '@/services/api/analytics';
import { useHasPermission } from '@/hooks/useAppRole';

interface RiskAcceptancesTabProps {
  onActiveCountChange: (count: number) => void;
}

type StatusFilter = 'active' | 'revoked' | 'all';

export default function RiskAcceptancesTab({ onActiveCountChange }: RiskAcceptancesTabProps) {
  const canWrite = useHasPermission('analytics:risk:write');

  // Data state
  const [acceptances, setAcceptances] = useState<RiskAcceptance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filter & pagination
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Revoke dialog state
  const [revokeTarget, setRevokeTarget] = useState<RiskAcceptance | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadAcceptances = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = statusFilter === 'all' ? undefined : statusFilter;
      const result = await analyticsApi.listAcceptances({
        status: statusParam,
        page,
        pageSize,
      });
      setAcceptances(result.data);
      setTotal(result.total);

      // Report active count to parent on the initial active filter load
      if (statusFilter === 'active') {
        onActiveCountChange(result.total);
      }
    } catch (error) {
      console.error('Failed to load risk acceptances:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, pageSize, onActiveCountChange]);

  useEffect(() => {
    loadAcceptances();
  }, [loadAcceptances]);

  // Reset to page 1 when filter changes
  const handleStatusChange = (status: StatusFilter) => {
    setStatusFilter(status);
    setPage(1);
  };

  // Revoke handler
  const handleRevokeConfirm = async () => {
    if (!revokeTarget || revokeReason.trim().length < 10) return;
    setRevoking(true);
    try {
      await analyticsApi.revokeRisk(revokeTarget.acceptance_id, revokeReason.trim());
      setRevokeTarget(null);
      setRevokeReason('');
      await loadAcceptances();
      // Also refresh active count
      const activeResult = await analyticsApi.listAcceptances({ status: 'active', page: 1, pageSize: 1 });
      onActiveCountChange(activeResult.total);
    } catch (error) {
      console.error('Failed to revoke risk acceptance:', error);
    } finally {
      setRevoking(false);
    }
  };

  // Relative time formatter
  const formatRelativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <ShieldOff className="w-5 h-5 text-amber-500" />
              Risk Acceptances
              {!loading && (
                <Badge variant="secondary" className="ml-1">
                  {total}
                </Badge>
              )}
            </CardTitle>

            {/* Status filter */}
            <div className="flex items-center gap-1 bg-secondary rounded-lg p-0.5">
              {(['active', 'revoked', 'all'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize ${
                    statusFilter === status
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : acceptances.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ShieldCheck className="w-10 h-10 mb-3 opacity-50" />
              <p className="text-sm font-medium">
                {statusFilter === 'active'
                  ? 'No active risk acceptances'
                  : statusFilter === 'revoked'
                    ? 'No revoked risk acceptances'
                    : 'No risk acceptances found'}
              </p>
              <p className="text-xs mt-1 opacity-75">
                {statusFilter === 'active'
                  ? 'All controls are currently contributing to the Defense Score'
                  : 'Try changing the status filter'}
              </p>
            </div>
          ) : (
            <>
              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-3 font-medium text-muted-foreground">Test Name</th>
                      <th className="pb-2 pr-3 font-medium text-muted-foreground">Control</th>
                      <th className="pb-2 pr-3 font-medium text-muted-foreground">Hostname</th>
                      <th className="pb-2 pr-3 font-medium text-muted-foreground">Justification</th>
                      <th className="pb-2 pr-3 font-medium text-muted-foreground">Accepted By</th>
                      <th className="pb-2 pr-3 font-medium text-muted-foreground">Status</th>
                      {canWrite && (
                        <th className="pb-2 font-medium text-muted-foreground">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {acceptances.map((acc) => (
                      <tr key={acc.acceptance_id} className="border-b border-border/50 hover:bg-accent/50">
                        <td className="py-2.5 pr-3">
                          <span className="font-medium text-foreground">{acc.test_name}</span>
                        </td>
                        <td className="py-2.5 pr-3">
                          {acc.control_id ? (
                            <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">{acc.control_id}</code>
                          ) : (
                            <span className="text-muted-foreground">&mdash;</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          {(() => {
                            const scope = acc.scope ?? (acc.hostname ? 'host' : 'global');
                            if (scope === 'global') {
                              return (
                                <span className="flex items-center gap-1 text-muted-foreground italic">
                                  <Globe className="w-3 h-3" />
                                  All Hosts{acc.hostname ? ` (from ${acc.hostname})` : ''}
                                </span>
                              );
                            }
                            return <span className="text-foreground">{acc.hostname ?? 'Unknown'}</span>;
                          })()}
                        </td>
                        <td className="py-2.5 pr-3 max-w-xs">
                          <span
                            className="text-muted-foreground truncate block"
                            title={acc.justification}
                          >
                            {acc.justification.length > 80
                              ? `${acc.justification.slice(0, 80)}...`
                              : acc.justification}
                          </span>
                          {/* Revocation details for revoked items */}
                          {acc.status === 'revoked' && acc.revoked_by_name && (
                            <span className="text-xs text-muted-foreground/70 block mt-0.5">
                              Revoked by {acc.revoked_by_name} {acc.revoked_at && formatRelativeTime(acc.revoked_at)}
                              {acc.revocation_reason && ` — ${acc.revocation_reason}`}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <span className="text-foreground">{acc.accepted_by_name}</span>
                          <span className="text-muted-foreground text-xs ml-1.5">
                            {formatRelativeTime(acc.accepted_at)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          {acc.status === 'active' ? (
                            <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-muted-foreground">
                              Revoked
                            </Badge>
                          )}
                        </td>
                        {canWrite && (
                          <td className="py-2.5">
                            {acc.status === 'active' && (
                              <button
                                onClick={() => setRevokeTarget(acc)}
                                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                                title="Revoke Risk Acceptance"
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    Page {page} of {totalPages} ({total} total)
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="p-1.5 rounded-md hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="p-1.5 rounded-md hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Revoke Risk Acceptance Dialog */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !revoking && setRevokeTarget(null)}>
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-500" />
                Revoke Risk Acceptance
              </h3>
              <button onClick={() => !revoking && setRevokeTarget(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Revoking acceptance for <span className="font-medium text-foreground">{revokeTarget.test_name}</span>
              {revokeTarget.control_id && (
                <> (control <code className="text-xs bg-secondary px-1 py-0.5 rounded">{revokeTarget.control_id}</code>)</>
              )}.
              This control will be included in the Defense Score again.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Describe why this acceptance is being revoked (min 10 characters)..."
                rows={3}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground resize-none placeholder:text-muted-foreground"
              />
              {revokeReason.length > 0 && revokeReason.trim().length < 10 && (
                <p className="text-xs text-red-500 mt-1">Minimum 10 characters required</p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setRevokeTarget(null); setRevokeReason(''); }}
                disabled={revoking}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRevokeConfirm}
                disabled={revoking || revokeReason.trim().length < 10}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {revoking && <Loader2 className="w-4 h-4 animate-spin" />}
                Revoke Acceptance
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
