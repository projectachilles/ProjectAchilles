/**
 * Agents Page - Main agent management interface
 * ACHILLES - Endpoint Management
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { UserPlus, ChevronDown, ChevronUp } from 'lucide-react';
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
import TagManager from '../../components/endpoints/sensors/TagManager';
import EnrollmentSection from '@/components/endpoints/enrollment/EnrollmentSection';
import AvailableBinaries from '@/components/endpoints/agents/AvailableBinaries';
import { Alert, Toast } from '../../components/shared/ui/Alert';
import { Button } from '../../components/shared/ui/Button';
import { Loading } from '../../components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import { getLatestVersionMap } from '@/pages/endpoints/utils/versionHelpers';
import type { AgentSummary, ListAgentsRequest, Agent } from '@/types/agent';

export default function AgentsPage() {
  const dispatch = useAppDispatch();
  const { agents, filters, loading, error } = useAppSelector(
    (state) => state.agent
  );
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [latestVersions, setLatestVersions] = useState<Map<string, string>>(new Map());
  const isInitialMount = useRef(true);
  const canEnroll = useHasPermission('endpoints:tokens:create');
  const canWriteAgent = useHasPermission('endpoints:agents:write');
  const canDeleteAgent = useHasPermission('endpoints:agents:delete');

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

        <AvailableBinaries />

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
          <TagManager
            selectedCount={selectedAgents.length}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />
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
