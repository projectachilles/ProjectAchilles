import { useEffect, useState } from 'react';
import { Icon, I } from '@/components/layout/AchillesShell';
import { agentApi } from '@/services/api/agent';

/**
 * Collapsed strip showing automatic key-rotation status with an expand-to-edit body.
 * Tactical Green styling.
 */
export function AutoRotationStrip() {
  const [enabled, setEnabled] = useState(false);
  const [intervalDays, setIntervalDays] = useState(90);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agentApi
      .getAutoRotationSettings()
      .then((s) => {
        setEnabled(s.enabled);
        setIntervalDays(s.intervalDays);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await agentApi.saveAutoRotationSettings({ enabled, intervalDays });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div>
      <button
        className="ep-strip"
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', textAlign: 'left' }}
      >
        <div className="ep-strip-info">
          <Icon size={14}>{I.sync}</Icon>
          <span>Automatic Key Rotation</span>
          {enabled ? (
            <span
              className="ep-pill"
              style={{
                color: 'var(--accent)',
                borderColor: 'rgba(0,230,138,.3)',
                background: 'rgba(0,230,138,.10)',
              }}
            >
              ● enabled · {intervalDays}d
            </span>
          ) : (
            <span className="ep-pill" style={{ color: 'var(--text-muted)', borderColor: 'var(--line)' }}>
              ○ disabled
            </span>
          )}
        </div>
        <span className={`ep-strip-chev ${open ? 'is-open' : ''}`}>
          <Icon size={14}>{I.chevronRight}</Icon>
        </span>
      </button>

      {open && (
        <div className="ep-strip-content">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className={`ep-toggle ${enabled ? 'is-on' : ''}`}
                onClick={() => {
                  setEnabled((v) => !v);
                  setDirty(true);
                }}
                role="button"
                tabIndex={0}
              />
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '.18em',
                }}
              >
                Interval
              </span>
              <input
                className="ep-field-input"
                type="number"
                min={1}
                max={365}
                value={intervalDays}
                onChange={(e) => {
                  setIntervalDays(Number(e.target.value));
                  setDirty(true);
                }}
                style={{ width: 90 }}
              />
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>days</span>
            </div>
            <div style={{ flex: 1 }} />
            {dirty && (
              <button
                className="ep-btn primary"
                onClick={save}
                disabled={saving}
                type="button"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          {error && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 10px',
                background: 'rgba(255,59,92,.06)',
                border: '1px solid rgba(255,59,92,.25)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
