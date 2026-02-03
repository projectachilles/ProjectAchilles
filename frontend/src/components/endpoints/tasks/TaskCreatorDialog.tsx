import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from '@/components/shared/ui/Dialog';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { agentApi } from '@/services/api/agent';
import { browserApi } from '@/services/api/browser';
import type { AgentSummary, TaskTestMetadata } from '@/types/agent';
import type { TestMetadata, BuildInfo } from '@/types/test';

interface AvailableTest {
  test: TestMetadata;
  build: BuildInfo;
}

interface TaskCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  selectedAgents?: string[];
  onCreated?: () => void;
}

const EMPTY_METADATA: TaskTestMetadata = {
  category: '',
  severity: '',
  techniques: [],
  tactics: [],
  threat_actor: '',
  target: '',
  complexity: '',
  tags: [],
};

export default function TaskCreatorDialog({ open, onClose, selectedAgents = [], onCreated }: TaskCreatorDialogProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [targetAgentIds, setTargetAgentIds] = useState<string[]>(selectedAgents);
  const [testUuid, setTestUuid] = useState('');
  const [testName, setTestName] = useState('');
  const [binaryName, setBinaryName] = useState('');
  const [timeout, setTimeout_] = useState('300');
  const [priority, setPriority] = useState('1');
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const [availableTests, setAvailableTests] = useState<AvailableTest[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);

  // Stabilize selectedAgents so a new [] default doesn't re-trigger effects every render
  const stableSelectedAgents = useMemo(
    () => selectedAgents,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAgents.join(',')]
  );

  // Effect 1: agent list + pre-selection
  useEffect(() => {
    if (!open) return;
    setTargetAgentIds(stableSelectedAgents);
    agentApi.listAgents({ status: 'active' })
      .then(setAgents)
      .catch(() => {});
  }, [open, stableSelectedAgents]);

  // Effect 2: test loading — only depends on dialog open, not selectedAgents
  useEffect(() => {
    if (!open) return;
    setLoadingTests(true);
    browserApi.getAllTests()
      .then(async (tests) => {
        const results: AvailableTest[] = [];
        await Promise.all(
          tests.map(async (test) => {
            try {
              const build = await browserApi.getBuildInfo(test.uuid);
              if (build.exists) {
                results.push({ test, build });
              }
            } catch {
              // No build available — skip
            }
          })
        );
        results.sort((a, b) => a.test.name.localeCompare(b.test.name));
        setAvailableTests(results);
      })
      .catch(() => {})
      .finally(() => setLoadingTests(false));
  }, [open]);

  function toggleAgent(agentId: string, checked: boolean): void {
    if (checked) {
      setTargetAgentIds([...targetAgentIds, agentId]);
    } else {
      setTargetAgentIds(targetAgentIds.filter((id) => id !== agentId));
    }
  }

  function handleTestSelect(uuid: string): void {
    const entry = availableTests.find((t) => t.test.uuid === uuid);
    if (entry) {
      setTestUuid(entry.test.uuid);
      setTestName(entry.test.name);
      setBinaryName(entry.build.filename ?? '');
    } else {
      setTestUuid('');
      setTestName('');
      setBinaryName('');
    }
  }

  function resetForm(): void {
    setResult(null);
    setTestUuid('');
    setTestName('');
    setBinaryName('');
    setTimeout_('300');
    setPriority('1');
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  async function handleCreate(): Promise<void> {
    if (targetAgentIds.length === 0 || !testUuid || !testName || !binaryName) return;

    setCreating(true);
    try {
      const selectedAgent = agents.find((a) => targetAgentIds.includes(a.id));
      const tasks = await agentApi.createTasks({
        agent_ids: targetAgentIds,
        org_id: selectedAgent?.org_id ?? 'default',
        test_uuid: testUuid,
        test_name: testName,
        binary_name: binaryName,
        execution_timeout: parseInt(timeout) || 300,
        priority: parseInt(priority) || 1,
        metadata: EMPTY_METADATA,
      });

      setResult(`Created ${tasks.length} task(s) for ${targetAgentIds.length} agent(s)`);
      onCreated?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create tasks';
      setResult(`Error: ${message}`);
    } finally {
      setCreating(false);
    }
  }

  const isFormValid = targetAgentIds.length > 0 && testUuid && testName && binaryName;

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-xl">
      <DialogHeader onClose={handleClose}>
        <DialogTitle>Create Task</DialogTitle>
        <DialogDescription>Deploy a security test to selected agents</DialogDescription>
      </DialogHeader>

      <DialogContent>
        {result ? (
          <div className="text-center py-4">
            <p className="text-lg font-medium mb-2">{result}</p>
            <Button onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Target Agents ({targetAgentIds.length} selected)
              </label>
              <div className="border border-border rounded-lg p-2 max-h-32 overflow-y-auto">
                {agents.map((agent) => (
                  <label key={agent.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 appearance-auto accent-primary"
                      checked={targetAgentIds.includes(agent.id)}
                      onChange={(e) => toggleAgent(agent.id, e.target.checked)}
                    />
                    <span className={`inline-block h-2 w-2 rounded-full ${agent.is_online ? 'bg-green-500' : 'bg-zinc-500'}`} />
                    <span className={agent.is_online ? '' : 'text-muted-foreground'}>
                      {agent.hostname} ({agent.os}/{agent.arch})
                    </span>
                    {!agent.is_online && <span className="text-xs text-muted-foreground">offline</span>}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Security Test</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                value={testUuid}
                onChange={(e) => handleTestSelect(e.target.value)}
                disabled={loadingTests}
              >
                <option value="">
                  {loadingTests ? 'Loading tests...' : '— Select a test —'}
                </option>
                {availableTests.map(({ test }) => (
                  <option key={test.uuid} value={test.uuid}>
                    {test.name}{test.category ? ` (${test.category})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {testUuid && (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="block text-muted-foreground text-xs mb-0.5">Test UUID</span>
                  <span className="block truncate" title={testUuid}>{testUuid}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground text-xs mb-0.5">Test Name</span>
                  <span className="block truncate" title={testName}>{testName}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground text-xs mb-0.5">Binary</span>
                  <span className="block truncate" title={binaryName}>{binaryName}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Timeout (seconds)"
                type="number"
                value={timeout}
                onChange={(e) => setTimeout_(e.target.value)}
              />
              <div>
                <label className="block text-sm font-medium mb-1.5">Priority</label>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="1">Normal (1)</option>
                  <option value="2">Medium (2)</option>
                  <option value="3">High (3)</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      {!result && (
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !isFormValid}>
            {creating ? 'Creating...' : `Create ${targetAgentIds.length} Task(s)`}
          </Button>
        </DialogFooter>
      )}
    </Dialog>
  );
}
