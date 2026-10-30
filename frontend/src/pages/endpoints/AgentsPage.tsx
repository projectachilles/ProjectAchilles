/**
 * Agents Page - Main agent management interface
 * ACHILLES - Endpoint Management
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { useSearchParams } from 'react-router-dom';
import { UserPlus, Download, Unplug, Ban, Trash2, ChevronLeft, ChevronRight, ChevronDown, Tag } from 'lucide-react';
import { useHasPermission } from '@/hooks/useAppRole';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FleetSummaryBar } from '@/components/endpoints/agents/FleetSummaryBar';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  fetchAgents,
  fetchAgent,
  setFilters,
  setPage,
  setAgents,
  updateAgentStatus,
  selectAgents,
  selectAgentFilters,
  selectAgentLoading,
  selectAgentError,
  selectAgentPagination,
} from '../../store/agentSlice';
import { IdentityPill } from '@/components/layout/ConsoleIdentity';
import { PageContainer } from '../../components/endpoints/Layout';
import { Badge } from '../../components/shared/ui/Badge';
import AgentFilters from '../../components/endpoints/agents/AgentFilters';
import { FleetPulseRail } from '../../components/endpoints/agents/FleetPulseRail';
import AgentList from '../../components/endpoints/agents/AgentList';
import AgentDetailPanel from '../../components/endpoints/agents/AgentDetailPanel';
import RotateKeyDialog from '../../components/endpoints/agents/RotateKeyDialog';
import UninstallDialog from '../../components/endpoints/agents/UninstallDialog';
import BulkDeleteDialog from '../../components/endpoints/agents/BulkDeleteDialog';
import { TagPicker } from '@/components/endpoints/agents/TagPicker';
import { tagSnapshot, type TagChange, type TagCount, type TagSnapshot } from '@/components/endpoints/agents/agentTagRules';
import EnrollmentSection from '@/components/endpoints/enrollment/EnrollmentSection';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import AvailableBinaries from '@/components/endpoints/agents/AvailableBinaries';
import AutoRotationSettings from '@/components/endpoints/agents/AutoRotationSettings';
import { Alert, Toast } from '../../components/shared/ui/Alert';
import { Button } from '../../components/shared/ui/Button';
import { Loading } from '../../components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import { getLatestVersionMap } from '@/pages/endpoints/utils/versionHelpers';
import type { AgentMetrics, FleetHealthMetrics, AgentSummary, ListAgentsRequest, Agent } from '@/types/agent';
import { OutdatedAgentsRow } from '../../components/endpoints/agents/OutdatedAgentsRow';
import { useOutdatedAgentCount } from '@/hooks/useOutdatedAgentCount';

export default function AgentsPage() {
  const dispatch = useAppDispatch();
  const [searchParams] = useSearchParams();
  const agents = useAppSelector(selectAgents);
  const filters = useAppSelector(selectAgentFilters);
  const loading = useAppSelector(selectAgentLoading);
  const error = useAppSelector(selectAgentError);
  const pagination = useAppSelector(selectAgentPagination);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [successUndo, setSuccessUndo] = useState<(() => void) | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (successTimer.current) clearTimeout(successTimer.current); }, []);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [rotateKeyAgentId, setRotateKeyAgentId] = useState<string | null>(null);
  const [uninstallAgents, setUninstallAgents] = useState<AgentSummary[]>([]);
  const [deleteAgents, setDeleteAgents] = useState<AgentSummary[]>([]);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const isDesktop = useIsDesktop();
  const [railOpen, setRailOpen] = useState(false);
  const [latestVersions, setLatestVersions] = useState<Map<string, string>>(new Map());
  const isInitialMount = useRef(true);
  const canEnroll = useHasPermission('endpoints:tokens:create');
  const canWriteAgent = useHasPermission('endpoints:agents:write');
  const fleetOutdated = useOutdatedAgentCount();
  const canDeleteAgent = useHasPermission('endpoints:agents:delete');

  // Handle ?stale=true query param from dashboard link
  useEffect(() => {
    if (searchParams.get('stale') === 'true') {
      dispatch(setFilters({ ...filters, stale_only: true }));
    } else if (filters.stale_only) {
      dispatch(setFilters({ ...filters, stale_only: undefined }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      dispatch(fetchAgents(filters));
      return;
    }

    const timeoutId = setTimeout(() => {
      dispatch(fetchAgents(filters));
      setSelectedAgents([]);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [filters, dispatch]);

  const refreshVersions = useCallback(async () => {
    try {
      const versions = await agentApi.listVersions();
      setLatestVersions(getLatestVersionMap(versions));
    } catch {
      // Silent — version comparison just won't appear
    }
  }, []);

  // Fleet-pulse rail data
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [fleetHealth, setFleetHealth] = useState<FleetHealthMetrics | null>(null);

  const refreshFleetStats = useCallback(async () => {
    const [m, fh] = await Promise.allSettled([
      agentApi.getMetrics(),
      agentApi.getFleetHealthMetrics(),
    ]);
    if (m.status === 'fulfilled') setMetrics(m.value);
    if (fh.status === 'fulfilled') setFleetHealth(fh.value);
  }, []);

  // Fetch latest binary versions + fleet stats on mount
  useEffect(() => { refreshVersions(); refreshFleetStats(); }, [refreshVersions, refreshFleetStats]);

  // Every tag in use, fleet-wide (the agent list holds one page at a time).
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const refreshTags = useCallback(async () => {
    try {
      setAllTags(await agentApi.listTags());
    } catch {
      // Keep the last list; the rail and menus still work with it.
    }
  }, []);
  useEffect(() => { void refreshTags(); }, [refreshTags]);
  const [tagError, setTagError] = useState<string | null>(null);

  // Silent poll — refresh agent list and versions without loading spinner
  const pollAgents = useCallback(async () => {
    try {
      const result = await agentApi.listAgents(filters);
      dispatch(setAgents({ agents: result.agents, total: result.total }));
    } catch {
      // Silent — don't surface transient poll failures
    }
    refreshVersions();
    refreshFleetStats();
    void refreshTags();
  }, [filters, dispatch, refreshVersions, refreshFleetStats, refreshTags]);

  usePolling(pollAgents, 15_000);

  // Fleet-wide counts: every group stays listed (and correctly counted) while
  // one is used as the filter or the fleet spans several pages.
  const groupCounts = allTags;

  function handleFilterChange(newFilters: Partial<ListAgentsRequest>): void {
    dispatch(setFilters(newFilters));
  }

  function handleRefresh(): void {
    dispatch(fetchAgents(filters));
  }

  function handleToggleSelect(agentId: string): void {
    setSelectedAgents((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  }

  function handleToggleSelectAll(): void {
    const allIds = agents.map((a) => a.id);
    const allSelected = allIds.every((id) => selectedAgents.includes(id));
    setSelectedAgents(allSelected ? [] : allIds);
  }

  function hideSuccess(): void {
    if (successTimer.current) clearTimeout(successTimer.current);
    setSuccessMessage(null);
    setSuccessUndo(null);
  }

  /** With `undo`, the toast offers Undo and stays up longer. A newer message replaces the old one and its timer. */
  function showSuccess(message: string, undo?: () => void): void {
    if (successTimer.current) clearTimeout(successTimer.current);
    setSuccessMessage(message);
    setSuccessUndo(() => undo ?? null);
    successTimer.current = setTimeout(hideSuccess, undo ? 8000 : 4000);
  }

  async function handleAction(agentId: string, action: string): Promise<void> {
    if (action === 'rotate-key') {
      setRotateKeyAgentId(agentId);
      return;
    }
    if (action === 'update') {
      await handleTriggerUpdate([agentId]);
      return;
    }
    if (action === 'uninstall') {
      const agent = agents.find((a) => a.id === agentId);
      if (agent) setUninstallAgents([agent]);
      return;
    }
    if (action === 'enable') {
      await dispatch(updateAgentStatus({ id: agentId, status: 'active' }));
      showSuccess('Agent enabled');
    } else if (action === 'disable') {
      await dispatch(updateAgentStatus({ id: agentId, status: 'disabled' }));
      showSuccess('Agent disabled');
    } else if (action === 'delete') {
      await agentApi.deleteAgent(agentId);
      showSuccess('Agent deleted');
    }
    dispatch(fetchAgents(filters));
  }

  async function handleSelectAgent(agent: AgentSummary): Promise<void> {
    const result = await dispatch(fetchAgent(agent.id));
    if (fetchAgent.fulfilled.match(result)) {
      setDetailAgent(result.payload);
    }
  }

  function afterTagsChange(): void {
    dispatch(fetchAgents(filters));
    void refreshTags();
  }

  /** One request for any number of agents; the rows, the bulk menu and the rail all refresh after. */
  async function handleTagsChange(agentIds: string[], change: TagChange): Promise<void> {
    setTagError(null);
    const snapshot = tagSnapshot(agentIds, agents);
    try {
      const updated = await agentApi.bulkTags({ agent_ids: agentIds, ...change });
      const what = [
        change.add?.length ? `added ${change.add.map((t) => `"${t}"`).join(', ')}` : '',
        change.remove?.length ? `removed ${change.remove.map((t) => `"${t}"`).join(', ')}` : '',
      ].filter(Boolean).join(' and ');
      showSuccess(
        `Tags ${what} · ${updated} agent${updated === 1 ? '' : 's'}`,
        snapshot ? () => void undoTagsChange(snapshot) : undefined,
      );
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setTagError(msg ?? 'Could not update tags');
    }
    afterTagsChange();
  }

  async function undoTagsChange(snapshot: TagSnapshot[]): Promise<void> {
    hideSuccess();
    const results = await Promise.allSettled(
      snapshot.map(({ id, tags }) => agentApi.updateAgent(id, { tags })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) setTagError(`Could not undo the tag change on ${failed} agent${failed === 1 ? '' : 's'}`);
    else showSuccess('Tag change undone');
    afterTagsChange();
  }

  async function handleTriggerUpdate(agentIds: string[]): Promise<void> {
    try {
      const taskIds = await agentApi.triggerUpdate({
        org_id: 'default',
        agent_ids: agentIds,
      });
      if (taskIds.length > 0) {
        showSuccess(`Update triggered for ${taskIds.length} agent(s)`);
        setSelectedAgents([]);
      }
    } catch {
      // Error handled by global interceptor
    }
  }

  async function handleBulkDisable(): Promise<void> {
    let succeeded = 0;
    for (const id of selectedAgents) {
      const result = await dispatch(updateAgentStatus({ id, status: 'disabled' }));
      if (updateAgentStatus.fulfilled.match(result)) succeeded++;
    }
    if (succeeded > 0) {
      showSuccess(`${succeeded} agent(s) disabled`);
      setSelectedAgents([]);
    }
    dispatch(fetchAgents(filters));
  }

  return (
    <>
      <PageContainer>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
              <Badge variant="default" className="text-xs">
                {pagination.total} {pagination.total === 1 ? 'agent' : 'agents'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              Manage and monitor your Achilles agents
            </p>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <IdentityPill />
            {canEnroll && (
              <Button variant="primary" onClick={() => setShowEnrollment(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Enroll agent</span>
                <span className="sm:hidden">Enroll</span>
              </Button>
            )}
          </div>
        </div>

        <Dialog open={showEnrollment} onOpenChange={setShowEnrollment}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Enroll agent</DialogTitle>
              <DialogDescription>
                Generate enrollment tokens and per-platform install commands
              </DialogDescription>
            </DialogHeader>
            <EnrollmentSection orgId="default" />
          </DialogContent>
        </Dialog>

        {/* Fleet-wide (every page), so the count and Update all match the sidebar badge. */}
        <OutdatedAgentsRow
          outdated={fleetOutdated.outdatedCount}
          total={fleetOutdated.totalCount}
          onUpdateAll={canWriteAgent ? () => void handleTriggerUpdate(fleetOutdated.outdatedIds).then(fleetOutdated.refresh) : undefined}
        />

        {tagError && (
          <Alert variant="destructive" className="mb-4" onClose={() => setTagError(null)}>
            {tagError}
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-4">
            {error}
          </Alert>
        )}

        {/* Rail: fleet state + navigation, then utilities (approved
            rail-utilities design — key rotation before binaries).
            Below lg the rail lives in a bottom sheet behind FleetSummaryBar. */}
        {(() => {
          const rail = (
            <>
              <FleetPulseRail
                metrics={metrics}
                staleCount={fleetHealth?.stale_agent_count ?? null}
                groups={groupCounts}
                activeTag={filters.tag}
                staleActive={!!filters.stale_only}
                onTagFilter={(tag) => { handleFilterChange({ tag }); setRailOpen(false); }}
                onStaleFilter={() => { handleFilterChange({ stale_only: !filters.stale_only }); setRailOpen(false); }}
              />
              {canWriteAgent && <AutoRotationSettings />}
              <AvailableBinaries />
            </>
          );
          return (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
          {isDesktop ? (
            <div className="flex w-60 shrink-0 flex-col gap-4">{rail}</div>
          ) : (
            <>
              <FleetSummaryBar
                metrics={metrics}
                staleCount={fleetHealth?.stale_agent_count ?? null}
                onOpenDetails={() => setRailOpen(true)}
              />
              <Sheet open={railOpen} onOpenChange={setRailOpen}>
                <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto border-border bg-background p-4">
                  <SheetTitle className="mb-3 text-sm font-semibold">Fleet details</SheetTitle>
                  <div className="flex flex-col gap-4">{rail}</div>
                </SheetContent>
              </Sheet>
            </>
          )}
          <div className="min-w-0 flex-1">
        <AgentFilters
          filters={filters}
          onFilterChange={handleFilterChange}
          onRefresh={handleRefresh}
        />

        {/* Always rendered, so selecting the first agent doesn't push the rows
            down under the cursor (a mis-click there can remove a tag). */}
        {canWriteAgent && (
          <div className="mb-4 flex min-h-8 flex-wrap items-center gap-2">
            {selectedAgents.length === 0 ? (
              <span className="text-xs text-faint">Select agents to tag, update or disable them together</span>
            ) : (
              <>
                <span className="mr-1 text-sm font-medium text-accent">{selectedAgents.length} selected</span>
                <TagPicker
                  allTags={allTags}
                  agentTags={agents.filter((a) => selectedAgents.includes(a.id)).map((a) => a.tags)}
                  onChange={(change) => handleTagsChange(selectedAgents, change)}
                >
                  <Button variant="secondary" size="sm">
                    <Tag className="w-4 h-4 mr-1" />
                    Tags
                    <ChevronDown className="w-3.5 h-3.5 ml-0.5" />
                  </Button>
                </TagPicker>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleTriggerUpdate(selectedAgents)}
                >
                  <Download className="w-4 h-4 mr-1" />
                  Update Selected ({selectedAgents.length})
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleBulkDisable}
                >
                  <Ban className="w-4 h-4 mr-1" />
                  Disable Selected ({selectedAgents.length})
                </Button>
                {canDeleteAgent && (
                  <>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        const selected = agents.filter((a) => selectedAgents.includes(a.id));
                        setUninstallAgents(selected);
                      }}
                    >
                      <Unplug className="w-4 h-4 mr-1" />
                      Uninstall Selected ({selectedAgents.length})
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        const selected = agents.filter((a) => selectedAgents.includes(a.id));
                        setDeleteAgents(selected);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete Selected ({selectedAgents.length})
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {loading ? (
          <Loading message="Loading agents..." />
        ) : (
          <>
            <AgentList
              agents={agents}
              selectedAgents={selectedAgents}
              latestVersions={latestVersions}
              canDelete={canDeleteAgent}
              allTags={allTags}
              activeTag={filters.tag}
              onShowGroup={(tag) => handleFilterChange({ tag })}
              onTagsChange={canWriteAgent ? handleTagsChange : undefined}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onAction={handleAction}
              onSelectAgent={handleSelectAgent}
            />
            {(() => {
              const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
              if (pagination.total === 0) return null;
              const first = (pagination.page - 1) * pagination.pageSize + 1;
              const last = Math.min(pagination.page * pagination.pageSize, pagination.total);
              return (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Showing {first}–{last} of {pagination.total} agent{pagination.total !== 1 ? 's' : ''}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pagination.page <= 1}
                        onClick={() => dispatch(setPage(pagination.page - 1))}
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {pagination.page} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pagination.page >= totalPages}
                        onClick={() => dispatch(setPage(pagination.page + 1))}
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
          </div>
        </div>
          );
        })()}

        <AgentDetailPanel
          agent={detailAgent}
          latestVersion={detailAgent ? latestVersions.get(`${detailAgent.os}-${detailAgent.arch}`) : undefined}
          onClose={() => setDetailAgent(null)}
        />

        {uninstallAgents.length > 0 && (
          <UninstallDialog
            open={uninstallAgents.length > 0}
            onClose={() => setUninstallAgents([])}
            agents={uninstallAgents}
            onUninstalled={() => {
              showSuccess(`Uninstall queued for ${uninstallAgents.length} agent(s)`);
              setUninstallAgents([]);
              setSelectedAgents([]);
              dispatch(fetchAgents(filters));
            }}
          />
        )}

        {deleteAgents.length > 0 && (
          <BulkDeleteDialog
            open={deleteAgents.length > 0}
            onClose={() => setDeleteAgents([])}
            agents={deleteAgents}
            onDeleted={() => {
              showSuccess(`${deleteAgents.length} agent(s) deleted`);
              setDeleteAgents([]);
              setSelectedAgents([]);
              dispatch(fetchAgents(filters));
            }}
          />
        )}

        {rotateKeyAgentId && (
          <RotateKeyDialog
            open={!!rotateKeyAgentId}
            onClose={() => setRotateKeyAgentId(null)}
            agentId={rotateKeyAgentId}
            onRotated={() => {
              showSuccess('API key rotated successfully');
              dispatch(fetchAgents(filters));
            }}
          />
        )}

        {successMessage && (
          // Hovering holds the toast open, so it can't vanish on the way to Undo.
          <div
            className="fixed bottom-4 right-4 z-50"
            onMouseEnter={() => { if (successTimer.current) clearTimeout(successTimer.current); }}
            onMouseLeave={() => { successTimer.current = setTimeout(hideSuccess, 3000); }}
          >
            <Toast
              variant="success"
              message={successMessage}
              action={successUndo ? { label: 'Undo', onClick: successUndo } : undefined}
              onClose={hideSuccess}
            />
          </div>
        )}
      </PageContainer>
    </>
  );
}
