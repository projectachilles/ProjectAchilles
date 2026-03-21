/**
 * Agents Page - Main agent management interface
 * ACHILLES - Endpoint Management
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus, ChevronDown, ChevronUp, Download, Unplug, Ban, Trash2, AlertTriangle } from 'lucide-react';
import { useHasPermission } from '@/hooks/useAppRole';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  fetchAgents,
  fetchAgent,
  setFilters,
  setAgents,
  tagAgent,
  untagAgent,
  updateAgentStatus,
} from '../../store/agentSlice';
import { PageContainer, PageHeader } from '../../components/endpoints/Layout';
import AgentFilters from '../../components/endpoints/agents/AgentFilters';
import AgentList from '../../components/endpoints/agents/AgentList';
import AgentDetailPanel from '../../components/endpoints/agents/AgentDetailPanel';
import RotateKeyDialog from '../../components/endpoints/agents/RotateKeyDialog';
import UninstallDialog from '../../components/endpoints/agents/UninstallDialog';
import BulkDeleteDialog from '../../components/endpoints/agents/BulkDeleteDialog';
import TagManager from '../../components/endpoints/sensors/TagManager';
import EnrollmentSection from '@/components/endpoints/enrollment/EnrollmentSection';
import AvailableBinaries from '@/components/endpoints/agents/AvailableBinaries';
import AutoRotationSettings from '@/components/endpoints/agents/AutoRotationSettings';
import { Alert, Toast } from '../../components/shared/ui/Alert';
import { Button } from '../../components/shared/ui/Button';
import { Loading } from '../../components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import { getLatestVersionMap } from '@/pages/endpoints/utils/versionHelpers';
import type { AgentSummary, ListAgentsRequest, Agent } from '@/types/agent';

export default function AgentsPage() {
  const dispatch = useAppDispatch();
  const [searchParams] = useSearchParams();
  const { agents, filters, loading, error } = useAppSelector(
    (state) => state.agent
  );
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [rotateKeyAgentId, setRotateKeyAgentId] = useState<string | null>(null);
  const [uninstallAgents, setUninstallAgents] = useState<AgentSummary[]>([]);
  const [deleteAgents, setDeleteAgents] = useState<AgentSummary[]>([]);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [latestVersions, setLatestVersions] = useState<Map<string, string>>(new Map());
  const isInitialMount = useRef(true);
  const canEnroll = useHasPermission('endpoints:tokens:create');
  const canWriteAgent = useHasPermission('endpoints:agents:write');
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

  // Fetch latest binary versions on mount
  useEffect(() => { refreshVersions(); }, [refreshVersions]);

  // Silent poll — refresh agent list and versions without loading spinner
  const pollAgents = useCallback(async () => {
    try {
      const result = await agentApi.listAgents(filters);
      dispatch(setAgents(result));
    } catch {
      // Silent — don't surface transient poll failures
    }
    refreshVersions();
  }, [filters, dispatch, refreshVersions]);

  useEffect(() => {
    const id = setInterval(pollAgents, 15_000);
    return () => clearInterval(id);
  }, [pollAgents]);

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

  function showSuccess(message: string): void {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 4000);
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

  async function handleAddTag(tag: string): Promise<void> {
    let succeeded = 0;
    for (const id of selectedAgents) {
      const result = await dispatch(tagAgent({ id, tag }));
      if (tagAgent.fulfilled.match(result)) succeeded++;
    }
    if (succeeded > 0) {
      showSuccess(`Tag "${tag}" added to ${succeeded} agent(s)`);
    }
  }

  async function handleRemoveTag(tag: string): Promise<void> {
    let succeeded = 0;
    for (const id of selectedAgents) {
      const result = await dispatch(untagAgent({ id, tag }));
      if (untagAgent.fulfilled.match(result)) succeeded++;
    }
    if (succeeded > 0) {
      showSuccess(`Tag "${tag}" removed from ${succeeded} agent(s)`);
    }
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
        <PageHeader
          title="Agents"
          description="Manage and monitor your Achilles agents"
          actions={canEnroll ? (
            <Button
              variant={showEnrollment ? 'secondary' : 'primary'}
              onClick={() => setShowEnrollment((v) => !v)}
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Enroll Agent
              {showEnrollment ? (
                <ChevronUp className="w-4 h-4 ml-2" />
              ) : (
                <ChevronDown className="w-4 h-4 ml-2" />
              )}
            </Button>
          ) : undefined}
        />

        {showEnrollment && (
          <div className="mb-6">
            <EnrollmentSection orgId="default" />
          </div>
        )}

        {(() => {
          const outdated = agents.filter((a) => {
            const latest = latestVersions.get(`${a.os}-${a.arch}`);
            return latest && latest !== a.agent_version;
          });
          if (outdated.length === 0 || latestVersions.size === 0) return null;
          return (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
              <p className="flex-1 text-sm text-amber-200">
                <span className="font-semibold">{outdated.length} of {agents.length} agent{agents.length !== 1 ? 's' : ''}</span>{' '}
                running outdated versions
              </p>
              {canWriteAgent && (
                <button
                  onClick={() => handleTriggerUpdate(outdated.map((a) => a.id))}
                  className="rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30 transition-colors"
                >
                  Update All ({outdated.length})
                </button>
              )}
            </div>
          );
        })()}

        <AvailableBinaries />

        {canWriteAgent && <AutoRotationSettings />}

        {error && (
          <Alert variant="destructive" className="mb-4">
            {error}
          </Alert>
        )}

        <AgentFilters
          filters={filters}
          onFilterChange={handleFilterChange}
          onRefresh={handleRefresh}
        />

        {canWriteAgent && (
          <>
            <TagManager
              selectedCount={selectedAgents.length}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
            />
            {selectedAgents.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
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
              </div>
            )}
          </>
        )}

        {loading ? (
          <Loading message="Loading agents..." />
        ) : (
          <AgentList
            agents={agents}
            selectedAgents={selectedAgents}
            latestVersions={latestVersions}
            canDelete={canDeleteAgent}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onAction={handleAction}
            onSelectAgent={handleSelectAgent}
          />
        )}

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
          <div className="fixed bottom-4 right-4 z-50">
            <Toast
              variant="success"
              message={successMessage}
              onClose={() => setSuccessMessage(null)}
            />
          </div>
        )}
      </PageContainer>
    </>
  );
}
