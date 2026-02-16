import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from '@/components/shared/ui/Dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shared/ui/Tabs';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Switch } from '@/components/shared/ui/Switch';
import { Search, Tag, X, Play, Calendar, Terminal } from 'lucide-react';
import { agentApi } from '@/services/api/agent';
import { browserApi } from '@/services/api/browser';
import { analyticsApi, type IndexInfo } from '@/services/api/analytics';
import type { AgentSummary, TaskTestMetadata, ScheduleType, ScheduleConfig } from '@/types/agent';
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
  subcategory: '',
  severity: '',
  techniques: [],
  tactics: [],
  threat_actor: '',
  target: [],
  complexity: '',
  tags: [],
  score: null,
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
];

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

  const [taskMode, setTaskMode] = useState<'test' | 'command'>('test');
  const [command, setCommand] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlineOnly, setOnlineOnly] = useState(false);

  const [availableTests, setAvailableTests] = useState<AvailableTest[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);

  const [testSearchQuery, setTestSearchQuery] = useState('');
  const [testDropdownOpen, setTestDropdownOpen] = useState(false);

  // Schedule state
  const [activeTab, setActiveTab] = useState<'run-now' | 'schedule'>('run-now');
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [scheduleTimezone, setScheduleTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [randomizeTime, setRandomizeTime] = useState(false);

  // Target index state
  const [targetIndex, setTargetIndex] = useState('');
  const [availableIndices, setAvailableIndices] = useState<IndexInfo[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);

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

  // Effect 3: fetch available ES indices
  useEffect(() => {
    if (!open) return;
    setIndicesLoading(true);
    analyticsApi.listIndices()
      .then((indices) => {
        setAvailableIndices(indices);
        if (indices.length > 0 && !targetIndex) {
          setTargetIndex(indices[0].name);
        }
      })
      .catch(() => setAvailableIndices([]))
      .finally(() => setIndicesLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTags = useMemo(() => {
    const s = new Set<string>();
    agents.forEach((a) => a.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [agents]);

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      if (searchQuery && !agent.hostname.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (selectedTags.length > 0 && !selectedTags.every((t) => agent.tags.includes(t))) return false;
      if (onlineOnly && !agent.is_online) return false;
      return true;
    });
  }, [agents, searchQuery, selectedTags, onlineOnly]);

  const filteredTests = useMemo(() => {
    if (!testSearchQuery) return availableTests;
    const q = testSearchQuery.toLowerCase();
    return availableTests.filter(({ test }) =>
      test.name.toLowerCase().includes(q) ||
      (test.category?.toLowerCase().includes(q) ?? false)
    );
  }, [availableTests, testSearchQuery]);

  function toggleAgent(agentId: string, checked: boolean): void {
    if (checked) {
      setTargetAgentIds([...targetAgentIds, agentId]);
    } else {
      setTargetAgentIds(targetAgentIds.filter((id) => id !== agentId));
    }
  }

  function toggleTag(tag: string): void {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function selectAllFiltered(): void {
    setTargetAgentIds((prev) => {
      const ids = new Set(prev);
      filteredAgents.forEach((a) => ids.add(a.id));
      return Array.from(ids);
    });
  }

  function deselectAllFiltered(): void {
    const filteredIds = new Set(filteredAgents.map((a) => a.id));
    setTargetAgentIds((prev) => prev.filter((id) => !filteredIds.has(id)));
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
    setTestDropdownOpen(false);
    setTestSearchQuery('');
  }

  function toggleDay(day: number): void {
    setScheduleDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  function resetForm(): void {
    setResult(null);
    setTaskMode('test');
    setCommand('');
    setTestUuid('');
    setTestName('');
    setBinaryName('');
    setTimeout_('300');
    setPriority('1');
    setSearchQuery('');
    setSelectedTags([]);
    setOnlineOnly(false);
    setTestSearchQuery('');
    setTestDropdownOpen(false);
    setActiveTab('run-now');
    setScheduleName('');
    setScheduleType('daily');
    setScheduleTime('09:00');
    setScheduleDate('');
    setScheduleDays([1, 2, 3, 4, 5]);
    setScheduleDayOfMonth(1);
    setScheduleTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setRandomizeTime(false);
    setTargetIndex('');
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  function buildScheduleConfig(): ScheduleConfig {
    const rt = randomizeTime || undefined;
    switch (scheduleType) {
      case 'once':
        return { date: scheduleDate, time: scheduleTime };
      case 'daily':
        return { time: scheduleTime, randomize_time: rt };
      case 'weekly':
        return { days: scheduleDays, time: scheduleTime, randomize_time: rt };
      case 'monthly':
        return { dayOfMonth: scheduleDayOfMonth, time: scheduleTime, randomize_time: rt };
    }
  }

  async function handleCreate(): Promise<void> {
    if (targetAgentIds.length === 0) return;
    if (taskMode === 'test' && (!testUuid || !testName || !binaryName)) return;
    if (taskMode === 'command' && !command.trim()) return;

    setCreating(true);
    try {
      const selectedAgent = agents.find((a) => targetAgentIds.includes(a.id));
      const orgId = selectedAgent?.org_id ?? 'default';

      if (taskMode === 'command') {
        const taskIds = await agentApi.createCommandTasks({
          agent_ids: targetAgentIds,
          org_id: orgId,
          command: command.trim(),
          execution_timeout: parseInt(timeout) || 300,
          priority: parseInt(priority) || 1,
        });
        setResult(`Created ${taskIds.length} command task(s) for ${targetAgentIds.length} agent(s)`);
      } else if (activeTab === 'schedule') {
        const schedule = await agentApi.createSchedule({
          name: scheduleName || undefined,
          agent_ids: targetAgentIds,
          org_id: orgId,
          test_uuid: testUuid,
          test_name: testName,
          binary_name: binaryName,
          execution_timeout: parseInt(timeout) || 300,
          priority: parseInt(priority) || 1,
          metadata: EMPTY_METADATA,
          schedule_type: scheduleType,
          schedule_config: buildScheduleConfig(),
          timezone: scheduleTimezone,
          target_index: targetIndex || undefined,
        });
        setResult(`Schedule created: "${schedule.name || schedule.test_name}" (${schedule.schedule_type})`);
      } else {
        const taskIds = await agentApi.createTasks({
          agent_ids: targetAgentIds,
          org_id: orgId,
          test_uuid: testUuid,
          test_name: testName,
          binary_name: binaryName,
          execution_timeout: parseInt(timeout) || 300,
          priority: parseInt(priority) || 1,
          metadata: EMPTY_METADATA,
          target_index: targetIndex || undefined,
        });
        setResult(`Created ${taskIds.length} task(s) for ${targetAgentIds.length} agent(s)`);
      }
      onCreated?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create';
      setResult(`Error: ${message}`);
    } finally {
      setCreating(false);
    }
  }

  const isScheduleValid = (() => {
    if (activeTab !== 'schedule') return true;
    if (!randomizeTime && !scheduleTime) return false;
    if (scheduleType === 'once' && !scheduleDate) return false;
    if (scheduleType === 'once' && scheduleDate) {
      const target = new Date(`${scheduleDate}T${scheduleTime}`);
      if (target <= new Date()) return false;
    }
    if (scheduleType === 'weekly' && scheduleDays.length === 0) return false;
    return true;
  })();

  const isFormValid = targetAgentIds.length > 0 && (
    taskMode === 'command'
      ? command.trim().length > 0
      : testUuid && testName && binaryName && isScheduleValid
  );

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-2xl">
      <DialogHeader onClose={handleClose}>
        <DialogTitle>Create Task</DialogTitle>
        <DialogDescription>Execute a task on selected agents</DialogDescription>
      </DialogHeader>

      <DialogContent>
        {result ? (
          <div className="text-center py-4">
            <p className="text-lg font-medium mb-2">{result}</p>
            <Button onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* === Agent Selector (shared) === */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Target Agents ({targetAgentIds.length} selected)
              </label>

              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search hostname..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Switch
                  label="Online"
                  checked={onlineOnly}
                  onChange={(e) => setOnlineOnly(e.target.checked)}
                />
              </div>

              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        selectedTags.includes(tag)
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary/20'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-3 mb-1.5 text-xs">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-primary hover:underline"
                >
                  Select all ({filteredAgents.length})
                </button>
                <button
                  type="button"
                  onClick={deselectAllFiltered}
                  className="text-muted-foreground hover:underline"
                >
                  Deselect all
                </button>
              </div>

              <div className="border border-border rounded-lg p-2 max-h-48 overflow-y-auto">
                {filteredAgents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">No agents match filters</p>
                ) : (
                  filteredAgents.map((agent) => (
                    <label key={agent.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 appearance-auto accent-primary"
                        checked={targetAgentIds.includes(agent.id)}
                        onChange={(e) => toggleAgent(agent.id, e.target.checked)}
                      />
                      <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${agent.is_online ? 'bg-green-500' : 'bg-zinc-500'}`} />
                      <span className={`truncate ${agent.is_online ? '' : 'text-muted-foreground'}`}>
                        {agent.hostname} ({agent.os}/{agent.arch})
                      </span>
                      {!agent.is_online && <span className="text-xs text-muted-foreground shrink-0">offline</span>}
                      {agent.tags.length > 0 && (
                        <span className="ml-auto flex gap-1 shrink-0">
                          {agent.tags.slice(0, 2).map((t) => (
                            <span key={t} className="text-[10px] bg-muted rounded px-1 py-0.5">{t}</span>
                          ))}
                          {agent.tags.length > 2 && (
                            <span className="text-[10px] text-muted-foreground">+{agent.tags.length - 2}</span>
                          )}
                        </span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* === Task Mode Toggle === */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Task Type</label>
              <div className="flex gap-1 p-0.5 bg-muted rounded-lg w-fit">
                <button
                  type="button"
                  onClick={() => setTaskMode('test')}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
                    taskMode === 'test'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Play className="h-3.5 w-3.5" />
                  Security Test
                </button>
                <button
                  type="button"
                  onClick={() => { setTaskMode('command'); setActiveTab('run-now'); }}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
                    taskMode === 'command'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Command
                </button>
              </div>
            </div>

            {/* === Command Input (command mode only) === */}
            {taskMode === 'command' && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Shell Command</label>
                <textarea
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground font-mono text-sm min-h-[80px] resize-y"
                  placeholder="e.g. whoami && hostname"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Runs via <code>sh -c</code> on Linux/macOS or <code>cmd /C</code> on Windows
                </p>
              </div>
            )}

            {/* === Test Selector (test mode only) === */}
            {taskMode === 'test' && <div>
              <label className="block text-sm font-medium mb-1.5">Security Test</label>
              <div
                className="relative"
                onBlur={() => window.setTimeout(() => setTestDropdownOpen(false), 150)}
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={loadingTests ? 'Loading tests...' : 'Search tests...'}
                      value={testUuid ? testName : testSearchQuery}
                      onChange={(e) => {
                        if (testUuid) {
                          setTestUuid('');
                          setTestName('');
                          setBinaryName('');
                        }
                        setTestSearchQuery(e.target.value);
                        setTestDropdownOpen(true);
                      }}
                      onFocus={() => { if (!testUuid) setTestDropdownOpen(true); }}
                      className="pl-8"
                      disabled={loadingTests}
                    />
                  </div>
                  {testUuid && (
                    <Button
                      variant="outline"
                      className="px-2"
                      onClick={() => {
                        setTestUuid('');
                        setTestName('');
                        setBinaryName('');
                        setTestSearchQuery('');
                        setTestDropdownOpen(false);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {testDropdownOpen && !testUuid && (
                  <div className="absolute z-10 w-full mt-1 border border-border rounded-lg bg-background max-h-48 overflow-y-auto shadow-lg">
                    {filteredTests.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-3">
                        {availableTests.length === 0 ? 'No tests available' : 'No tests match'}
                      </p>
                    ) : (
                      filteredTests.map(({ test }) => (
                        <button
                          key={test.uuid}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleTestSelect(test.uuid)}
                        >
                          <span className="truncate">{test.name}</span>
                          {test.category && (
                            <span className="ml-auto text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground shrink-0">
                              {test.category}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>}

            {/* === Test Info Card (test mode only) === */}
            {taskMode === 'test' && testUuid && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1.5">
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 w-20">Test UUID</span>
                  <span className="font-mono text-xs break-all">{testUuid}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 w-20">Test Name</span>
                  <span>{testName}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0 w-20">Binary</span>
                  <span className="font-mono text-xs break-all">{binaryName}</span>
                </div>
              </div>
            )}

            {/* === Tabs: Run Now / Schedule === */}
            <Tabs key={taskMode} defaultValue="run-now" onValueChange={(v) => setActiveTab(v as 'run-now' | 'schedule')}>
              <TabsList>
                <TabsTrigger value="run-now">
                  <Play className="h-3.5 w-3.5" />
                  Run Now
                </TabsTrigger>
                <TabsTrigger value="schedule" disabled={taskMode === 'command'}>
                  <Calendar className="h-3.5 w-3.5" />
                  Schedule
                </TabsTrigger>
              </TabsList>

              {taskMode === 'command' && (
                <p className="text-xs text-muted-foreground mt-2">Scheduling is available for security tests only.</p>
              )}

              <TabsContent value="run-now">
                <div className={`grid ${taskMode === 'command' ? 'grid-cols-2' : 'grid-cols-3'} gap-4`}>
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
                  {taskMode === 'test' && (
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Target Index</label>
                      <select
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                        value={targetIndex}
                        onChange={(e) => setTargetIndex(e.target.value)}
                        disabled={indicesLoading}
                      >
                        <option value="">Default (global)</option>
                        {availableIndices.map((idx) => (
                          <option key={idx.name} value={idx.name}>{idx.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="schedule">
                <div className="space-y-4">
                  {/* Schedule name */}
                  <Input
                    label="Schedule Name (optional)"
                    placeholder="e.g. Daily persistence check"
                    value={scheduleName}
                    onChange={(e) => setScheduleName(e.target.value)}
                  />

                  {/* Frequency pills */}
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Frequency</label>
                    <div className="flex gap-2">
                      {(['once', 'daily', 'weekly', 'monthly'] as ScheduleType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => { setScheduleType(t); if (t === 'once') setRandomizeTime(false); }}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize ${
                            scheduleType === t
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'bg-muted text-muted-foreground border-border hover:border-primary/20'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Conditional: Once → date picker */}
                  {scheduleType === 'once' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Date</label>
                        <input
                          type="date"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                          min={new Date().toISOString().slice(0, 10)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Time</label>
                        <input
                          type="time"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* Conditional: Daily → time or randomize */}
                  {scheduleType === 'daily' && (
                    <div className="space-y-3">
                      <Switch
                        label="Randomize time"
                        checked={randomizeTime}
                        onChange={(e) => setRandomizeTime(e.target.checked)}
                      />
                      {randomizeTime ? (
                        <p className="text-xs text-muted-foreground">
                          Weekdays 09:00–17:00 &middot; Weekends anytime
                        </p>
                      ) : (
                        <div>
                          <label className="block text-sm font-medium mb-1.5">Time</label>
                          <input
                            type="time"
                            className="w-full max-w-48 rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Conditional: Weekly → day toggles + time */}
                  {scheduleType === 'weekly' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Days</label>
                        <div className="flex gap-1.5">
                          {DAY_LABELS.map((label, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => toggleDay(idx)}
                              className={`text-xs w-10 py-1.5 rounded-full border transition-colors ${
                                scheduleDays.includes(idx)
                                  ? 'bg-primary/10 text-primary border-primary/30'
                                  : 'bg-muted text-muted-foreground border-border hover:border-primary/20'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Switch
                        label="Randomize time"
                        checked={randomizeTime}
                        onChange={(e) => setRandomizeTime(e.target.checked)}
                      />
                      {randomizeTime ? (
                        <p className="text-xs text-muted-foreground">
                          Weekdays 09:00–17:00 &middot; Weekends anytime
                        </p>
                      ) : (
                        <div>
                          <label className="block text-sm font-medium mb-1.5">Time</label>
                          <input
                            type="time"
                            className="w-full max-w-48 rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Conditional: Monthly → day of month + time */}
                  {scheduleType === 'monthly' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1.5">Day of Month</label>
                          <select
                            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                            value={scheduleDayOfMonth}
                            onChange={(e) => setScheduleDayOfMonth(parseInt(e.target.value))}
                          >
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                        {!randomizeTime && (
                          <div>
                            <label className="block text-sm font-medium mb-1.5">Time</label>
                            <input
                              type="time"
                              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                              value={scheduleTime}
                              onChange={(e) => setScheduleTime(e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      <Switch
                        label="Randomize time"
                        checked={randomizeTime}
                        onChange={(e) => setRandomizeTime(e.target.checked)}
                      />
                      {randomizeTime && (
                        <p className="text-xs text-muted-foreground">
                          Weekdays 09:00–17:00 &middot; Weekends anytime
                        </p>
                      )}
                    </div>
                  )}

                  {/* Timezone */}
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Timezone</label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                      value={scheduleTimezone}
                      onChange={(e) => setScheduleTimezone(e.target.value)}
                    >
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                      ))}
                      {!COMMON_TIMEZONES.includes(scheduleTimezone) && (
                        <option value={scheduleTimezone}>{scheduleTimezone.replace(/_/g, ' ')}</option>
                      )}
                    </select>
                  </div>

                  {/* Timeout + Priority + Target Index */}
                  <div className="grid grid-cols-3 gap-4">
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
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Target Index</label>
                      <select
                        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
                        value={targetIndex}
                        onChange={(e) => setTargetIndex(e.target.value)}
                        disabled={indicesLoading}
                      >
                        <option value="">Default (global)</option>
                        {availableIndices.map((idx) => (
                          <option key={idx.name} value={idx.name}>{idx.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>

      {!result && (
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !isFormValid}>
            {creating
              ? 'Creating...'
              : taskMode === 'command'
                ? `Create ${targetAgentIds.length} Task(s)`
                : activeTab === 'schedule'
                  ? 'Create Schedule'
                  : `Create ${targetAgentIds.length} Task(s)`
            }
          </Button>
        </DialogFooter>
      )}
    </Dialog>
  );
}
