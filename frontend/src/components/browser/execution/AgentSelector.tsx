import { useMemo, useState } from 'react';
import { Input } from '@/components/shared/ui/Input';
import { Switch } from '@/components/shared/ui/Switch';
import { Search, Tag } from 'lucide-react';
import type { AgentSummary } from '@/types/agent';

interface AgentSelectorProps {
  agents: AgentSummary[];
  targetAgentIds: string[];
  onSelectionChange: (ids: string[]) => void;
  loading?: boolean;
}

export default function AgentSelector({ agents, targetAgentIds, onSelectionChange, loading }: AgentSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlineOnly, setOnlineOnly] = useState(false);

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
  );
}
