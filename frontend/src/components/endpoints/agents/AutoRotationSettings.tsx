import { useEffect, useRef, useState } from 'react';
import { Switch } from '@/components/shared/ui/Switch';
import { agentApi } from '@/services/api/agent';

const MIN_DAYS = 30;
const MAX_DAYS = 365;

/**
 * Key-rotation rail card (approved rail-utilities design): a switch that
 * saves on toggle and a click-to-edit interval, wearing the same recipe as
 * the other Fleet Pulse rail cards. Replaces the old full-width collapsible
 * form.
 */
export default function AutoRotationSettings() {
  const [enabled, setEnabled] = useState(false);
  const [intervalDays, setIntervalDays] = useState(90);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('90');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    agentApi.getAutoRotationSettings()
      .then((s) => {
        setEnabled(s.enabled);
        setIntervalDays(s.intervalDays);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function save(next: { enabled: boolean; intervalDays: number }): Promise<void> {
    setError(null);
    try {
      await agentApi.saveAutoRotationSettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  function handleToggle(nextEnabled: boolean): void {
    setEnabled(nextEnabled);
    void save({ enabled: nextEnabled, intervalDays });
  }

  function commitInterval(): void {
    setEditing(false);
    const parsed = Math.round(Number(draft));
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(MIN_DAYS, Math.min(MAX_DAYS, parsed));
    if (clamped === intervalDays) return;
    setIntervalDays(clamped);
    void save({ enabled, intervalDays: clamped });
  }

  if (!loaded) return null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2.5 text-[11px] uppercase tracking-wider text-faint">key rotation</div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">Automatic</span>
          <Switch
            aria-label="Automatic key rotation"
            checked={enabled}
            onChange={(e) => handleToggle(e.target.checked)}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">Interval</span>
          {editing ? (
            <input
              ref={inputRef}
              type="number"
              min={MIN_DAYS}
              max={MAX_DAYS}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitInterval}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitInterval();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-16 rounded border border-border bg-raised px-1.5 py-0.5 text-right font-mono text-[11px] text-foreground outline-none focus:border-accent"
            />
          ) : (
            <button
              type="button"
              disabled={!enabled}
              title={enabled ? 'Click to edit' : 'Enable automatic rotation first'}
              onClick={() => {
                setDraft(String(intervalDays));
                setEditing(true);
              }}
              className={`border-b border-dashed font-mono text-[11px] ${
                enabled
                  ? 'cursor-text border-border-strong text-foreground hover:border-accent'
                  : 'border-transparent text-faint'
              }`}
            >
              {intervalDays} days
            </button>
          )}
        </div>
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>
    </div>
  );
}
