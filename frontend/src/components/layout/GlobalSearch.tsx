import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Shield,
  Monitor,
  ListTodo,
  Command,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { browserApi } from '@/services/api/browser';
import { agentApi } from '@/services/api/agent';
import type { TestMetadata } from '@/types/test';
import type { AgentSummary, AgentTask } from '@/types/agent';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  category: 'test' | 'agent' | 'task' | 'execution';
  path: string;
  icon: typeof Shield;
  badges?: string[];
}

interface SearchGroup {
  label: string;
  icon: typeof Shield;
  results: SearchResult[];
}

/* ------------------------------------------------------------------ */
/*  Hook: useGlobalSearch                                              */
/* ------------------------------------------------------------------ */

function useGlobalSearch(query: string, isOpen: boolean) {
  const [results, setResults] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Cache fetched data to avoid repeated API calls within a session
  const cacheRef = useRef<{
    tests?: TestMetadata[];
    agents?: AgentSummary[];
    tasks?: { tasks: AgentTask[]; total: number };
  }>({});

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    // Abort previous in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    const query = q.toLowerCase().trim();

    try {
      // Fetch data (use cache if available)
      const [tests, agents, tasksData] = await Promise.all([
        cacheRef.current.tests ?? browserApi.getAllTests().then(t => { cacheRef.current.tests = t; return t; }),
        cacheRef.current.agents ?? agentApi.listAgents().then(a => { cacheRef.current.agents = a; return a; }).catch(() => [] as AgentSummary[]),
        cacheRef.current.tasks ?? agentApi.listTasks({ limit: 200 }).then(t => { cacheRef.current.tasks = t; return t; }).catch(() => ({ tasks: [] as AgentTask[], total: 0 })),
      ]);

      // --- Filter tests ---
      const matchedTests: SearchResult[] = tests
        .filter(t =>
          (t.name || '').toLowerCase().includes(query) ||
          (t.uuid || '').toLowerCase().includes(query) ||
          (Array.isArray(t.techniques) && t.techniques.some(tech => (tech || '').toLowerCase().includes(query))) ||
          (t.description || '').toLowerCase().includes(query) ||
          (t.threatActor || '').toLowerCase().includes(query) ||
          (t.category || '').toLowerCase().includes(query)
        )
        .slice(0, 8)
        .map(t => ({
          id: t.uuid,
          title: t.name,
          subtitle: t.uuid.slice(0, 8) + '...',
          category: 'test' as const,
          path: `/browser/test/${t.uuid}`,
          icon: Shield,
          badges: [
            t.severity?.toUpperCase(),
            ...(t.techniques?.slice(0, 3) || []),
          ].filter(Boolean) as string[],
        }));

      // --- Filter agents ---
      const matchedAgents: SearchResult[] = agents
        .filter(a =>
          (a.hostname || '').toLowerCase().includes(query) ||
          (a.id || '').toLowerCase().includes(query) ||
          (a.os || '').toLowerCase().includes(query) ||
          (a.tags || []).some(tag => tag.toLowerCase().includes(query))
        )
        .slice(0, 5)
        .map(a => ({
          id: a.id,
          title: a.hostname,
          subtitle: `${a.os} / ${a.arch} — ${a.status}`,
          category: 'agent' as const,
          path: `/endpoints/agents/${a.id}`,
          icon: Monitor,
          badges: [a.status, a.os].filter(Boolean),
        }));

      // --- Filter tasks ---
      const matchedTasks: SearchResult[] = tasksData.tasks
        .filter(t =>
          (t.payload?.test_name || '').toLowerCase().includes(query) ||
          (t.payload?.test_uuid || '').toLowerCase().includes(query) ||
          (t.id || '').toLowerCase().includes(query) ||
          (t.agent_hostname || '').toLowerCase().includes(query) ||
          (t.batch_id || '').toLowerCase().includes(query)
        )
        .slice(0, 5)
        .map(t => ({
          id: t.id,
          title: t.payload?.test_name || `Task ${t.id.slice(0, 8)}`,
          subtitle: `${t.agent_hostname || 'unassigned'} — ${t.status}`,
          category: 'task' as const,
          path: `/endpoints/tasks?search=${encodeURIComponent(t.payload?.test_name || t.id)}`,
          icon: ListTodo,
          badges: [t.status, t.type].filter(Boolean),
        }));

      // --- Build groups (only include non-empty) ---
      const groups: SearchGroup[] = [];
      if (matchedTests.length > 0) groups.push({ label: 'Tests', icon: Shield, results: matchedTests });
      if (matchedAgents.length > 0) groups.push({ label: 'Agents', icon: Monitor, results: matchedAgents });
      if (matchedTasks.length > 0) groups.push({ label: 'Tasks', icon: ListTodo, results: matchedTasks });

      setResults(groups);
    } catch {
      // Silent failure — search is best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => search(query), 200);
    return () => clearTimeout(timer);
  }, [query, isOpen, search]);

  // Clear cache when overlay closes
  useEffect(() => {
    if (!isOpen) {
      cacheRef.current = {};
      setResults([]);
    }
  }, [isOpen]);

  const totalResults = useMemo(
    () => results.reduce((sum, g) => sum + g.results.length, 0),
    [results]
  );

  return { results, loading, totalResults };
}

/* ------------------------------------------------------------------ */
/*  Component: GlobalSearch                                            */
/* ------------------------------------------------------------------ */

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { results, loading, totalResults } = useGlobalSearch(query, open);

  // Flatten results for keyboard navigation
  const flatResults = useMemo(
    () => results.flatMap(g => g.results),
    [results]
  );

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when overlay opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Small delay to ensure the overlay is rendered
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  function handleClose() {
    setOpen(false);
    setQuery('');
  }

  function handleSelect(result: SearchResult) {
    navigate(result.path);
    handleClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, flatResults.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (flatResults[selectedIndex]) {
          handleSelect(flatResults[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        handleClose();
        break;
    }
  }

  // Track flat index across groups for rendering
  let flatIndex = 0;

  return (
    <>
      {/* Trigger button (replaces the old non-functional search input) */}
      <button
        onClick={() => setOpen(true)}
        className="flex-1 max-w-md mx-4 flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border border-transparent hover:border-border text-muted-foreground text-sm transition-colors cursor-pointer"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left truncate">Search tests, agents, tasks...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          <Command className="h-3 w-3" />K
        </kbd>
      </button>

      {/* Overlay — portaled to body to escape stacking contexts */}
      {open && createPortal(
        <div className="fixed inset-0 z-[9999]" onKeyDown={handleKeyDown}>
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Search Panel */}
          <div className="relative mx-auto mt-[15vh] w-full max-w-xl px-4">
            <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
              {/* Search Input */}
              <div className="flex items-center gap-3 px-4 border-b border-border">
                <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search tests, agents, tasks..."
                  className="flex-1 h-12 bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
                {loading && <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />}
                <kbd
                  className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-muted"
                  onClick={handleClose}
                >
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
                {query.trim() && !loading && totalResults === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No results for "{query}"
                  </div>
                )}

                {!query.trim() && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Type to search across tests, agents, and tasks
                  </div>
                )}

                {results.map(group => (
                  <div key={group.label}>
                    <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
                      {group.label}
                    </div>
                    {group.results.map(result => {
                      const currentIndex = flatIndex++;
                      const isSelected = currentIndex === selectedIndex;
                      return (
                        <button
                          key={result.id}
                          data-selected={isSelected}
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setSelectedIndex(currentIndex)}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                            isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50'
                          )}
                        >
                          <result.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{result.title}</div>
                            {result.subtitle && (
                              <div className="text-xs text-muted-foreground font-mono truncate">{result.subtitle}</div>
                            )}
                          </div>
                          {result.badges && result.badges.length > 0 && (
                            <div className="hidden sm:flex items-center gap-1 shrink-0">
                              {result.badges.slice(0, 3).map(badge => (
                                <span
                                  key={badge}
                                  className={cn(
                                    'text-[10px] font-mono px-1.5 py-0.5 rounded',
                                    badge === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                                    badge === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                                    badge.startsWith('T1') ? 'bg-primary/10 text-primary' :
                                    'bg-muted text-muted-foreground'
                                  )}
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                          )}
                          <ArrowRight className={cn(
                            'h-3.5 w-3.5 shrink-0 transition-opacity',
                            isSelected ? 'opacity-100 text-muted-foreground' : 'opacity-0'
                          )} />
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Footer */}
              {totalResults > 0 && (
                <div className="px-4 py-2 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{totalResults} result{totalResults !== 1 ? 's' : ''}</span>
                  <div className="flex items-center gap-2">
                    <span><kbd className="border border-border rounded px-1">↑↓</kbd> navigate</span>
                    <span><kbd className="border border-border rounded px-1">↵</kbd> open</span>
                    <span><kbd className="border border-border rounded px-1">esc</kbd> close</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
