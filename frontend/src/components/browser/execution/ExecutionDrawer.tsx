import { useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { agentApi } from '@/services/api/agent';
import { browserApi } from '@/services/api/browser';
import { analyticsApi, type IndexInfo } from '@/services/api/analytics';
import { integrationsApi } from '@/services/api/integrations';
import type { AgentSummary, TaskTestMetadata, ScheduleConfig } from '@/types/agent';
import type { TestMetadata, BuildInfo } from '@/types/test';
import AgentSelector from './AgentSelector';
import ExecutionConfig, { type ExecutionConfigState, getDefaultConfigState } from './ExecutionConfig';
import DrawerBuildSection from './DrawerBuildSection';

interface ExecutionDrawerProps {
  open: boolean;
  onClose: () => void;
  tests: TestMetadata[];
  onTasksCreated?: () => void;
}

const EMPTY_METADATA: TaskTestMetadata = {
  category: '',
  subcategory: '',
  severity: '',
  techniques: [],
  tactics: [],
  threat_actor: '',
  target: [],
  complexity: '',
  tags: [],
  score: null,
  integrations: [],
};

export default function ExecutionDrawer({ open, onClose, tests, onTasksCreated }: ExecutionDrawerProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [targetAgentIds, setTargetAgentIds] = useState<string[]>([]);

  const [builds, setBuilds] = useState<Map<string, BuildInfo | null>>(new Map());
  const [buildsLoading, setBuildsLoading] = useState(false);

  const [availableIndices, setAvailableIndices] = useState<IndexInfo[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [azureConfigured, setAzureConfigured] = useState<boolean | null>(null);

  const [config, setConfig] = useState<ExecutionConfigState>(getDefaultConfigState);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Fetch data when drawer opens
  useEffect(() => {
    if (!open || tests.length === 0) return;

    setAgentsLoading(true);
    agentApi.listAgents({ status: 'active' })
      .then(setAgents)
      .catch(() => {})
      .finally(() => setAgentsLoading(false));

    setBuildsLoading(true);
    Promise.all(
      tests.map(async (test) => {
        try {
          const info = await browserApi.getBuildInfo(test.uuid);
          return [test.uuid, info] as const;
        } catch {
          return [test.uuid, null] as const;
        }
      })
    ).then((entries) => {
      setBuilds(new Map(entries));
    }).finally(() => setBuildsLoading(false));

    setIndicesLoading(true);
    analyticsApi.listIndices()
      .then((indices) => {
        setAvailableIndices(indices);
        if (indices.length > 0) {
          setConfig((prev) => ({ ...prev, targetIndex: prev.targetIndex || indices[0].name }));
        }
      })
      .catch(() => setAvailableIndices([]))
      .finally(() => setIndicesLoading(false));

    integrationsApi.getAzureSettings()
      .then((s) => setAzureConfigured(s.configured))
      .catch(() => setAzureConfigured(false));
  }, [open, tests]);

  const handleClose = useCallback(() => {
    setTargetAgentIds([]);
    setConfig(getDefaultConfigState());
    setResult(null);
    setBuilds(new Map());
    onClose();
  }, [onClose]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, handleClose]);

  function handleBuildComplete(uuid: string, info: BuildInfo) {
    setBuilds((prev) => new Map(prev).set(uuid, info));
  }

  function handleConfigChange(updates: Partial<ExecutionConfigState>) {
    setConfig((prev) => ({ ...prev, ...updates }));
  }

  function buildScheduleConfig(): ScheduleConfig {
    const rt = config.randomizeTime || undefined;
    switch (config.scheduleType) {
      case 'once':
        return { date: config.scheduleDate, time: config.scheduleTime };
      case 'daily':
        return { time: config.scheduleTime, randomize_time: rt };
      case 'weekly':
        return { days: config.scheduleDays, time: config.scheduleTime, randomize_time: rt };
      case 'monthly':
        return { dayOfMonth: config.scheduleDayOfMonth, time: config.scheduleTime, randomize_time: rt };
    }
  }

  // All tests must have builds to proceed
  const allBuilt = tests.every((t) => builds.get(t.uuid)?.exists);

  // Check for tests needing Azure credentials
  const hasAzureIntegrationTest = tests.some(
    (t) => t.integrations?.includes('azure') || t.subcategory === 'identity-tenant'
  );
  const needsAzureWarning = hasAzureIntegrationTest && azureConfigured === false;

  const isScheduleValid = (() => {
    if (config.activeTab !== 'schedule') return true;
    if (!config.randomizeTime && !config.scheduleTime) return false;
    if (config.scheduleType === 'once' && !config.scheduleDate) return false;
    if (config.scheduleType === 'once' && config.scheduleDate) {
      const target = new Date(`${config.scheduleDate}T${config.scheduleTime}`);
      if (target <= new Date()) return false;
    }
    if (config.scheduleType === 'weekly' && config.scheduleDays.length === 0) return false;
    return true;
  })();

  const isFormValid = targetAgentIds.length > 0 && allBuilt && !needsAzureWarning && isScheduleValid;

  async function handleExecute() {
    if (!isFormValid) return;

    setCreating(true);
    try {
      const selectedAgent = agents.find((a) => targetAgentIds.includes(a.id));
      const orgId = selectedAgent?.org_id ?? 'default';

      // Execute for each test in the batch
      let totalCreated = 0;

      for (const test of tests) {
        const buildInfo = builds.get(test.uuid);
        if (!buildInfo?.exists) continue;

        const binaryName = buildInfo.filename ?? '';

        if (config.activeTab === 'schedule') {
          await agentApi.createSchedule({
            name: config.scheduleName || undefined,
            agent_ids: targetAgentIds,
            org_id: orgId,
            test_uuid: test.uuid,
            test_name: test.name,
            binary_name: binaryName,
            execution_timeout: parseInt(config.timeout) || 300,
            priority: parseInt(config.priority) || 1,
            metadata: EMPTY_METADATA,
            schedule_type: config.scheduleType,
            schedule_config: buildScheduleConfig(),
            timezone: config.scheduleTimezone,
            target_index: config.targetIndex || undefined,
          });
          totalCreated++;
        } else {
          const taskIds = await agentApi.createTasks({
            agent_ids: targetAgentIds,
            org_id: orgId,
            test_uuid: test.uuid,
            test_name: test.name,
            binary_name: binaryName,
            execution_timeout: parseInt(config.timeout) || 300,
            priority: parseInt(config.priority) || 1,
            metadata: EMPTY_METADATA,
            target_index: config.targetIndex || undefined,
          });
          totalCreated += taskIds.length;
        }
      }

      if (config.activeTab === 'schedule') {
        setResult(`Created ${totalCreated} schedule(s) for ${targetAgentIds.length} agent(s)`);
      } else {
        setResult(`Created ${totalCreated} task(s) for ${targetAgentIds.length} agent(s)`);
      }
      onTasksCreated?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create';
      setResult(`Error: ${message}`);
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  const isBatch = tests.length > 1;
  const anyNeedsBuild = !allBuilt && !buildsLoading;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={handleClose}
      />

      {/* Drawer panel */}
      <div className="fixed inset-y-0 right-0 w-[420px] bg-card border-l border-border shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-[length:var(--theme-border-width)] border-border shrink-0">
          <div className="min-w-0">
            {isBatch ? (
              <h2 className="text-lg font-semibold">{tests.length} tests selected</h2>
            ) : (
              <>
                <h2 className="text-lg font-semibold truncate">{tests[0]?.name}</h2>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  {tests[0]?.severity && (
                    <span className="font-medium uppercase">{tests[0].severity}</span>
                  )}
                  {tests[0]?.techniques.slice(0, 2).map((t) => (
                    <span key={t} className="bg-muted rounded px-1.5 py-0.5 font-mono">{t}</span>
                  ))}
                  {(tests[0]?.techniques.length ?? 0) > 2 && (
                    <span>+{tests[0].techniques.length - 2}</span>
                  )}
                </div>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} className="shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {result ? (
            <div className="text-center py-8">
              <p className="text-lg font-medium mb-4">{result}</p>
              <Button onClick={handleClose}>Close</Button>
            </div>
          ) : (
            <>
              {/* Build Status */}
              {(anyNeedsBuild || buildsLoading) && (
                <DrawerBuildSection
                  builds={builds}
                  onBuildComplete={handleBuildComplete}
                  loading={buildsLoading}
                />
              )}

              {/* Azure warning */}
              {needsAzureWarning && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <div>
                    <p className="font-medium">Azure credentials not configured</p>
                    <p className="text-sm mt-1">
                      This test requires Azure / Entra ID service principal credentials.
                      Configure them in <strong>Settings &rarr; Integrations &rarr; Azure / Entra ID</strong> before executing.
                    </p>
                  </div>
                </Alert>
              )}

              {/* Agent Selector */}
              <AgentSelector
                agents={agents}
                targetAgentIds={targetAgentIds}
                onSelectionChange={setTargetAgentIds}
                loading={agentsLoading}
              />

              {/* Execution Config */}
              <ExecutionConfig
                config={config}
                onChange={handleConfigChange}
                availableIndices={availableIndices}
                indicesLoading={indicesLoading}
              />
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="flex items-center justify-end gap-2 p-4 border-t-[length:var(--theme-border-width)] border-border shrink-0">
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleExecute} disabled={creating || !isFormValid}>
              {creating
                ? 'Creating...'
                : config.activeTab === 'schedule'
                  ? `Schedule (${targetAgentIds.length})`
                  : `Execute (${targetAgentIds.length})`
              }
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
