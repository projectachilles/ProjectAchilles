import { useEffect, useState } from 'react';
import { RefreshCw, ChevronDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/shared/ui/Card';
import { Button } from '@/components/shared/ui/Button';
import { Input } from '@/components/shared/ui/Input';
import { Switch } from '@/components/shared/ui/Switch';
import { agentApi } from '@/services/api/agent';
import { cn } from '@/lib/utils';

export default function AutoRotationSettings() {
  const [enabled, setEnabled] = useState(false);
  const [intervalDays, setIntervalDays] = useState(90);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    agentApi.getAutoRotationSettings()
      .then((s) => {
        setEnabled(s.enabled);
        setIntervalDays(s.intervalDays);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function handleSave() {
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
    <Card className="mb-6">
      <CardHeader>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between"
        >
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Automatic Key Rotation
          </CardTitle>
          <ChevronDown
            className={cn(
              'w-5 h-5 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-180'
            )}
          />
        </button>
      </CardHeader>
      {expanded && (
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            Automatically rotate agent API keys older than the configured interval.
            Agents receive new keys via heartbeat with zero downtime (dual-key grace period).
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <Switch
              label="Enable auto-rotation"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setDirty(true);
              }}
            />

            <div className="w-40">
              <Input
                type="number"
                label="Interval (days)"
                min={30}
                max={365}
                value={intervalDays}
                disabled={!enabled}
                onChange={(e) => {
                  setIntervalDays(Number(e.target.value));
                  setDirty(true);
                }}
              />
            </div>

            <Button
              size="sm"
              disabled={!dirty || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>

          {error && (
            <p className="mt-2 text-xs text-destructive">{error}</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
