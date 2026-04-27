import { useEffect, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import type { AgentTask } from '@/types/agent';
import { StatusPill } from './StatusPill';
import { formatDuration } from '../utils/format';

type Tab = 'output' | 'stderr' | 'meta' | 'raw';

interface ExecutionDetailDrawerProps {
  task: AgentTask;
  agentHostname?: string;
  onClose: () => void;
}

/**
 * 560px right-edge drawer showing per-execution detail. Locked to drawer
 * pattern per Q6 (modal variant from prototype was stripped).
 */
export function ExecutionDetailDrawer({ task, agentHostname, onClose }: ExecutionDetailDrawerProps) {
  const [tab, setTab] = useState<Tab>('output');
  const [copied, setCopied] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const taskName = task.payload?.test_name ?? task.type;
  const result = task.result;
  const exit = result?.exit_code;

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  const stdoutContent = result?.stdout ?? '';
  const stderrContent = result?.stderr ?? '';
  const metaContent = `task_id:      ${task.id}
batch_id:     ${task.batch_id}
type:         ${task.type}
status:       ${task.status}
priority:     ${task.priority}
test_uuid:    ${task.payload?.test_uuid ?? '—'}
test_name:    ${task.payload?.test_name ?? '—'}
binary_name:  ${task.payload?.binary_name ?? '—'}
timeout_sec:  ${task.payload?.execution_timeout ?? '—'}
exit_code:    ${exit ?? '—'}
created_at:   ${task.created_at}
assigned_at:  ${task.assigned_at ?? '—'}
completed_at: ${task.completed_at ?? '—'}`;
  const rawContent = JSON.stringify(task, null, 2);

  const currentContent =
    tab === 'output' ? stdoutContent : tab === 'stderr' ? stderrContent : tab === 'meta' ? metaContent : rawContent;

  return (
    <div className="ep-drawer-shell" onClick={onClose}>
      <div className="ep-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="ep-modal-head">
          <div>
            <div className="ep-modal-title">Execution · {agentHostname ?? task.agent_hostname ?? task.agent_id.slice(0, 8)}</div>
            <div className="ep-modal-sub">{taskName}</div>
          </div>
          <button className="ep-icon-btn" onClick={onClose} aria-label="Close drawer">
            <Icon size={14}>{I.alert}</Icon>
          </button>
        </div>
        <div className="ep-modal-body">
          <div className="ep-exec-meta-grid">
            <div className="ep-exec-meta-cell">
              <span className="lbl">Agent</span>
              <span className="val">{agentHostname ?? task.agent_hostname ?? task.agent_id.slice(0, 8)}</span>
            </div>
            <div className="ep-exec-meta-cell">
              <span className="lbl">Status</span>
              <span className="val">
                <StatusPill status={task.status} />
              </span>
            </div>
            <div className="ep-exec-meta-cell">
              <span className="lbl">Duration</span>
              <span className="val">
                {result?.execution_duration_ms != null ? formatDuration(result.execution_duration_ms) : '—'}
              </span>
            </div>
            <div className="ep-exec-meta-cell">
              <span className="lbl">Exit Code</span>
              <span
                className="val"
                style={{
                  color:
                    exit == null
                      ? 'var(--text-muted)'
                      : exit !== 0 && exit !== 100
                        ? 'var(--danger)'
                        : 'var(--accent)',
                }}
              >
                {exit ?? '—'}
              </span>
            </div>
            <div className="ep-exec-meta-cell">
              <span className="lbl">Started</span>
              <span className="val">{result?.started_at ?? task.assigned_at ?? '—'}</span>
            </div>
            <div className="ep-exec-meta-cell">
              <span className="lbl">Completed</span>
              <span className="val">{result?.completed_at ?? task.completed_at ?? '—'}</span>
            </div>
            <div className="ep-exec-meta-cell" style={{ gridColumn: 'span 2' }}>
              <span className="lbl">Agent ID</span>
              <span className="val">{task.agent_id}</span>
            </div>
          </div>

          <div className="ep-exec-tabs">
            {([
              { id: 'output', label: 'stdout' },
              { id: 'stderr', label: 'stderr' },
              { id: 'meta', label: 'Metadata' },
              { id: 'raw', label: 'Raw JSON' },
            ] as { id: Tab; label: string }[]).map((t) => (
              <button
                key={t.id}
                className={`ep-exec-tab ${tab === t.id ? 'is-active' : ''}`}
                onClick={() => setTab(t.id)}
                type="button"
              >
                {t.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button
              className="ep-icon-btn"
              style={{ margin: '4px 0' }}
              onClick={() => copy(currentContent, tab)}
              aria-label="Copy content"
            >
              <Icon size={12}>{I.task}</Icon>
            </button>
          </div>
          {copied === tab && (
            <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--accent)' }}>Copied!</div>
          )}

          <pre
            className="ep-exec-stdout"
            style={tab === 'raw' ? { color: 'var(--violet)' } : tab === 'stderr' ? { color: 'var(--text-muted)' } : undefined}
          >
            {currentContent || (tab === 'output' ? '<no output>' : tab === 'stderr' ? '<no errors>' : '')}
          </pre>
        </div>
      </div>
    </div>
  );
}
