import { useEffect, useMemo, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';
import { browserApi } from '@/services/api/browser';
import type { AgentSummary, TaskTestMetadata } from '@/types/agent';
import type { TestMetadata } from '@/types/test';
import { OsPill } from './OsPill';

interface CreateTaskModalProps {
  onClose: () => void;
  onCreated?: () => void;
  initialAgentIds?: string[];
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

export function CreateTaskModal({ onClose, onCreated, initialAgentIds = [] }: CreateTaskModalProps) {
  const [mode, setMode] = useState<'test' | 'command'>('test');
  const [run, setRun] = useState<'now' | 'schedule'>('now');
  const [selected, setSelected] = useState<Set<string>>(new Set(initialAgentIds));
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentSearch, setAgentSearch] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);

  const [tests, setTests] = useState<TestMetadata[]>([]);
  const [testSearch, setTestSearch] = useState('');
  const [selectedTest, setSelectedTest] = useState<TestMetadata | null>(null);
  const [command, setCommand] = useState('');

  const [timeoutSec, setTimeoutSec] = useState('300');
  const [priority, setPriority] = useState('1');
  const [targetIndex, setTargetIndex] = useState('achilles-results');

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    agentApi
      .listAgents()
      .then(setAgents)
      .catch(() => setAgents([]));
    browserApi
      .getAllTests()
      .then((t) => setTests(t.slice(0, 200)))
      .catch(() => setTests([]));
  }, []);

  const visibleAgents = useMemo(() => {
    let list = agents;
    if (onlineOnly) list = list.filter((a) => a.is_online);
    if (agentSearch) {
      const q = agentSearch.toLowerCase();
      list = list.filter((a) => a.hostname.toLowerCase().includes(q));
    }
    return list.slice(0, 50);
  }, [agents, agentSearch, onlineOnly]);

  const visibleTests = useMemo(() => {
    if (!testSearch) return tests.slice(0, 25);
    const q = testSearch.toLowerCase();
    return tests.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 25);
  }, [tests, testSearch]);

  function toggleAgent(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function selectAll() {
    setSelected(new Set(visibleAgents.map((a) => a.id)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  async function create() {
    setCreating(true);
    setError(null);
    setSuccess(null);
    const agentIds = [...selected];
    if (agentIds.length === 0) {
      setError('Select at least one target agent');
      setCreating(false);
      return;
    }
    try {
      if (mode === 'test') {
        if (!selectedTest) {
          setError('Select a security test');
          setCreating(false);
          return;
        }
        const ids = await agentApi.createTasks({
          agent_ids: agentIds,
          org_id: 'default',
          test_uuid: selectedTest.uuid,
          test_name: selectedTest.name,
          binary_name: selectedTest.uuid,
          execution_timeout: Number(timeoutSec),
          priority: Number(priority),
          target_index: targetIndex,
          metadata: {
            ...EMPTY_METADATA,
            category: selectedTest.category ?? '',
            severity: selectedTest.severity ?? '',
            techniques: selectedTest.techniques ?? [],
            score: selectedTest.score ?? null,
          },
        });
        setSuccess(`Created ${ids.length} task${ids.length === 1 ? '' : 's'}`);
      } else {
        if (!command.trim()) {
          setError('Enter a command to run');
          setCreating(false);
          return;
        }
        const ids = await agentApi.createCommandTasks({
          agent_ids: agentIds,
          org_id: 'default',
          command,
          execution_timeout: Number(timeoutSec),
          priority: Number(priority),
        });
        setSuccess(`Created ${ids.length} command task${ids.length === 1 ? '' : 's'}`);
      }
      onCreated?.();
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="ep-modal-shell" onClick={onClose}>
      <div className="ep-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ep-modal-head">
          <div>
            <div className="ep-modal-title">Create Task</div>
            <div className="ep-modal-sub">Execute a task on selected agents</div>
          </div>
          <button className="ep-icon-btn" onClick={onClose} aria-label="Close">
            <Icon size={14}>{I.alert}</Icon>
          </button>
        </div>
        <div className="ep-modal-body">
          <div className="ep-field">
            <label className="ep-field-label">Target Agents ({selected.size} selected)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="ep-filter-input" style={{ flex: 1 }}>
                <Icon size={13}>{I.search}</Icon>
                <input
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  placeholder="Search hostname…"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  className={`ep-toggle ${onlineOnly ? 'is-on' : ''}`}
                  onClick={() => setOnlineOnly((v) => !v)}
                  role="button"
                  tabIndex={0}
                />
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Online</span>
              </div>
            </div>
            <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
              <a onClick={selectAll} style={{ cursor: 'pointer', color: 'var(--accent)' }}>
                Select all ({visibleAgents.length})
              </a>{' '}
              ·{' '}
              <a onClick={deselectAll} style={{ cursor: 'pointer', color: 'var(--accent)' }}>
                Deselect all
              </a>
            </div>
            <div
              style={{
                marginTop: 8,
                maxHeight: 160,
                overflow: 'auto',
                border: '1px solid var(--line)',
                borderRadius: 4,
                background: 'rgba(0,0,0,.2)',
              }}
            >
              {visibleAgents.length === 0 ? (
                <div className="ep-empty">No agents match</div>
              ) : (
                visibleAgents.map((h) => (
                  <label
                    key={h.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--line-soft)',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span
                      className={`ep-checkbox ${selected.has(h.id) ? 'is-on' : ''}`}
                      onClick={(e) => {
                        e.preventDefault();
                        toggleAgent(h.id);
                      }}
                    />
                    <span className={`ep-status-dot ${h.is_online ? '' : 'is-offline'}`} />
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{h.hostname}</span>
                    <OsPill os={h.os} />
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {h.arch}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="ep-field">
            <label className="ep-field-label">Task Type</label>
            <div className="ep-seg">
              <button className={mode === 'test' ? 'is-active' : ''} onClick={() => setMode('test')} type="button">
                <Icon size={11}>{I.play}</Icon> Security Test
              </button>
              <button className={mode === 'command' ? 'is-active' : ''} onClick={() => setMode('command')} type="button">
                <Icon size={11}>{I.cog}</Icon> Command
              </button>
            </div>
          </div>

          {mode === 'test' ? (
            <div className="ep-field">
              <label className="ep-field-label">Security Test</label>
              <div className="ep-filter-input">
                <Icon size={13}>{I.search}</Icon>
                <input
                  value={testSearch}
                  onChange={(e) => setTestSearch(e.target.value)}
                  placeholder="Search tests…"
                />
              </div>
              <div
                style={{
                  marginTop: 6,
                  maxHeight: 140,
                  overflow: 'auto',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  background: 'rgba(0,0,0,.2)',
                }}
              >
                {visibleTests.length === 0 ? (
                  <div className="ep-empty">No matching tests</div>
                ) : (
                  visibleTests.map((t) => (
                    <div
                      key={t.uuid}
                      onClick={() => setSelectedTest(t)}
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid var(--line-soft)',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: selectedTest?.uuid === t.uuid ? 'var(--accent)' : 'var(--text-primary)',
                        background: selectedTest?.uuid === t.uuid ? 'var(--accent-bg)' : undefined,
                      }}
                    >
                      <div style={{ fontFamily: 'var(--font-mono)' }}>{t.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        {t.category} · {t.severity ?? '—'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="ep-field">
              <label className="ep-field-label">Command</label>
              <input
                className="ep-field-input"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Enter shell command…"
              />
            </div>
          )}

          <div className="ep-field">
            <label className="ep-field-label">Run Mode</label>
            <div className="ep-seg">
              <button className={run === 'now' ? 'is-active' : ''} onClick={() => setRun('now')} type="button">
                <Icon size={11}>{I.play}</Icon> Run Now
              </button>
              <button
                className={run === 'schedule' ? 'is-active' : ''}
                onClick={() => setRun('schedule')}
                type="button"
              >
                <Icon size={11}>{I.clock}</Icon> Schedule
              </button>
            </div>
            {run === 'schedule' && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11.5,
                  color: 'var(--warn-bright)',
                }}
              >
                Schedule mode is coming soon — use the Schedules section to create recurring jobs.
              </div>
            )}
          </div>

          <div className="ep-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div className="ep-field" style={{ margin: 0 }}>
              <label className="ep-field-label">Timeout (sec)</label>
              <input
                className="ep-field-input"
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(e.target.value)}
                type="number"
                min={1}
              />
            </div>
            <div className="ep-field" style={{ margin: 0 }}>
              <label className="ep-field-label">Priority</label>
              <select
                className="ep-field-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="0">Low (0)</option>
                <option value="1">Normal (1)</option>
                <option value="2">High (2)</option>
              </select>
            </div>
            <div className="ep-field" style={{ margin: 0 }}>
              <label className="ep-field-label">Target Index</label>
              <input
                className="ep-field-input"
                value={targetIndex}
                onChange={(e) => setTargetIndex(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                background: 'rgba(255,59,92,.08)',
                border: '1px solid rgba(255,59,92,.3)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}
          {success && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                background: 'rgba(0,230,138,.08)',
                border: '1px solid rgba(0,230,138,.3)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--accent)',
              }}
            >
              {success}
            </div>
          )}
        </div>
        <div className="ep-modal-foot">
          <button className="ep-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ep-btn primary" onClick={create} disabled={creating || run === 'schedule'}>
            {creating ? 'Creating…' : `Create ${selected.size || ''} Task${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
