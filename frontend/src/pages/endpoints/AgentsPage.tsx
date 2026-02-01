/**
 * Agents Page - Main agent management interface
 * ACHILLES - Endpoint Management
 */

import { useEffect, useState, useRef } from 'react';
import { UserPlus, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  fetchAgents,
  fetchAgent,
  setFilters,
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
  const isInitialMount = useRef(true);

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
    for (const id of selectedAgents) {
      await dispatch(tagAgent({ id, tag }));
    }
    showSuccess(`Tag "${tag}" added to ${selectedAgents.length} agent(s)`);
  }

  async function handleRemoveTag(tag: string): Promise<void> {
    for (const id of selectedAgents) {
      await dispatch(untagAgent({ id, tag }));
    }
    showSuccess(`Tag "${tag}" removed from ${selectedAgents.length} agent(s)`);
  }

  return (
    <>
      <PageContainer>
        <PageHeader
          title="Agents"
          description="Manage and monitor your Achilles agents"
          actions={
            <Button
              variant={showEnrollment ? 'secondary' : 'default'}
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
          }
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

        <TagManager
          selectedCount={selectedAgents.length}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
        />

        {loading ? (
          <Loading message="Loading agents..." />
        ) : (
          <AgentList
            agents={agents}
            selectedAgents={selectedAgents}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onAction={handleAction}
            onSelectAgent={handleSelectAgent}
          />
        )}

        <AgentDetailPanel
          agent={detailAgent}
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
