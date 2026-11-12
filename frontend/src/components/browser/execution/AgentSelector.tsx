import { useMemo, useState } from 'react';
import { Input } from '@/components/shared/ui/Input';
import { Switch } from '@/components/shared/ui/Switch';
import { Search, Tag } from 'lucide-react';
import type { AgentSummary } from '@/types/agent';
import { fieldControlClass, fieldLabelClass } from '@/components/shared/ui/formStyles';
import {
  RECENCY_WINDOW_OPTIONS,
  matchesRecencyWindow,
  recencyLabel,
  summarizeAnyTestRecency,
  summarizeHostRecency,
  type RecencyScope,
  type RecencyWindow,
  type RunRecencyData,
} from '@/lib/testRunRecency';

interface AgentSelectorProps {
  agents: AgentSummary[];
  targetAgentIds: string[];
  onSelectionChange: (ids: string[]) => void;
  loading?: boolean;
  /** The tests about to be sent. Empty/undefined leaves only the "any test" scope. */
  testUuids?: string[];
  /** Run history per agent. null/undefined hides the "Not run" filter and the row labels. */
  recency?: RunRecencyData | null;
}

export default function AgentSelector({ agents, targetAgentIds, onSelectionChange, loading, testUuids, recency }: AgentSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [recencyWindow, setRecencyWindow] = useState<RecencyWindow>('any');

  const [recencyScopeChoice, setRecencyScopeChoice] = useState<RecencyScope>('test');

  // "This test" needs a selected test; without one only "any test" can be answered.
  const testCount = testUuids?.length ?? 0;
  const recencyScope: RecencyScope = testCount > 0 ? recencyScopeChoice : 'any';

  // One "how long ago" per host for the chosen scope. Per-test scope judges a
  // host by the selected test it ran longest ago.
  const recencyByAgent = useMemo(() => {
    if (!recency) return null;
    const ids = agents.map((a) => a.id);
    return recencyScope === 'test' && testUuids
      ? summarizeHostRecency(ids, testUuids, recency.runs)
      : summarizeAnyTestRecency(ids, recency.agents);
  }, [agents, testUuids, recency, recencyScope]);
  // Fixed for the life of the picker (it remounts each time the drawer opens),
  // so rows don't move in and out of the filter between renders.
  const [now] = useState(() => Date.now());

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
      if (recencyByAgent && !matchesRecencyWindow(recencyByAgent.get(agent.id), recencyWindow, now)) return false;
      return true;
    });
  }, [agents, searchQuery, selectedTags, onlineOnly, recencyByAgent, recencyWindow, now]);

  function toggleAgent(agentId: string, checked: boolean) {
    if (checked) {
      onSelectionChange([...targetAgentIds, agentId]);
    } else {
      onSelectionChange(targetAgentIds.filter((id) => id !== agentId));
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function selectAllFiltered() {
    const ids = new Set(targetAgentIds);
    filteredAgents.forEach((a) => ids.add(a.id));
    onSelectionChange(Array.from(ids));
  }

  function deselectAllFiltered() {
    const filteredIds = new Set(filteredAgents.map((a) => a.id));
    onSelectionChange(targetAgentIds.filter((id) => !filteredIds.has(id)));
  }

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground py-3 text-center">
        Loading agents...
      </div>
    );
  }

  return (
    <div>
      <label className={fieldLabelClass}>
        Target Agents ({targetAgentIds.length} selected)
      </label>

      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Input
            leftIcon={<Search className="h-4 w-4" />}
            placeholder="Search hostname..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Switch
          label="Online"
          checked={onlineOnly}
          onChange={(e) => setOnlineOnly(e.target.checked)}
        />
      </div>

      {recencyByAgent && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-muted-foreground shrink-0">Not run</span>
          <select
            aria-label="Not run: which test"
            className={`${fieldControlClass} h-8 flex-1 min-w-0`}
            value={recencyScope}
            onChange={(e) => setRecencyScopeChoice(e.target.value as RecencyScope)}
          >
            <option value="test" disabled={testCount === 0}>
              {testCount === 0 ? 'this test (pick a test first)' : testCount > 1 ? 'any selected test' : 'this test'}
            </option>
            <option value="any">any test</option>
          </select>
          <select
            aria-label="Not run: period"
            className={`${fieldControlClass} h-8 flex-1 min-w-0`}
            value={recencyWindow}
            onChange={(e) => setRecencyWindow(e.target.value as RecencyWindow)}
          >
            {RECENCY_WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

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
                  : 'bg-raised text-muted-foreground border-border hover:border-primary/20'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3 mb-1.5 text-xs">
        <button type="button" onClick={selectAllFiltered} className="text-primary hover:underline">
          Select all ({filteredAgents.length})
        </button>
        <button type="button" onClick={deselectAllFiltered} className="text-muted-foreground hover:underline">
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
              <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${agent.is_online ? 'bg-accent' : 'bg-faint'}`} />
              <span className={`truncate ${agent.is_online ? '' : 'text-muted-foreground'}`}>
                {agent.hostname} ({agent.os}/{agent.arch})
              </span>
              {!agent.is_online && <span className="text-xs text-muted-foreground shrink-0">offline</span>}
              {recencyByAgent && (
                <span className="ml-auto text-xs text-muted-foreground shrink-0" title={recencyScope === 'test' ? 'Last run of the selected test on this host' : 'Last run of any test on this host'}>
                  {recencyLabel(recencyByAgent.get(agent.id), now)}
                </span>
              )}
              {agent.tags.length > 0 && (
                <span className={`${recencyByAgent ? '' : 'ml-auto '}flex gap-1 shrink-0`}>
                  {agent.tags.slice(0, 2).map((t) => (
                    <span key={t} className="text-[10px] bg-raised rounded px-1 py-0.5">{t}</span>
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
  );
}
