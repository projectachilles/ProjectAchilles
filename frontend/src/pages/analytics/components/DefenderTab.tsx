import { useState, useEffect } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/shared/ui/Button';
import { defenderApi, type SecureScoreSummary, type AlertSummary } from '@/services/api/defender';
import SecureScoreCard from './SecureScoreCard';
import AlertsSummaryCard from './AlertsSummaryCard';
import DefenderAlertsTable from './DefenderAlertsTable';
import DefenderControlsTable from './DefenderControlsTable';
import ScoreCorrelationChart from './ScoreCorrelationChart';
import TechniqueOverlapChart from './TechniqueOverlapChart';

export default function DefenderTab() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [secureScore, setSecureScore] = useState<SecureScoreSummary | null>(null);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    loadSyncStatus();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [score, alerts] = await Promise.all([
        defenderApi.getSecureScore(),
        defenderApi.getAlertSummary(),
      ]);
      setSecureScore(score);
      setAlertSummary(alerts);
    } catch (err) {
      console.error('Failed to load Defender data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadSyncStatus() {
    try {
      // Load sync status from dedicated endpoint
      const res = await fetch('/api/integrations/defender/sync/status', {
        headers: { 'Authorization': `Bearer ${document.cookie}` },
      }).catch(() => null);
      if (res?.ok) {
        const syncStatus = await res.json();
        setLastSync(syncStatus.lastScoreSync || syncStatus.lastAlertSync || null);
      }
    } catch {
      // Ignore sync status errors
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const response = await fetch('/api/integrations/defender/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        await loadData();
        await loadSyncStatus();
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Microsoft Defender</h2>
          <p className="text-sm text-muted-foreground">
            Secure Score, security alerts, and remediation controls
            {lastSync && (
              <span className="ml-2">
                &middot; Last synced {new Date(lastSync).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Sync Now
        </Button>
      </div>

      {/* Summary row: Secure Score + Alert Summary */}
      <div className="grid grid-cols-12 gap-4" style={{ minHeight: '280px' }}>
        <div className="col-span-12 md:col-span-4">
          <SecureScoreCard data={secureScore} loading={loading} />
        </div>
        <div className="col-span-12 md:col-span-8">
          <AlertsSummaryCard data={alertSummary} loading={loading} />
        </div>
      </div>

      {/* Correlation charts */}
      <div className="grid grid-cols-12 gap-4" style={{ minHeight: '250px' }}>
        <div className="col-span-12 md:col-span-6">
          <ScoreCorrelationChart />
        </div>
        <div className="col-span-12 md:col-span-6">
          <TechniqueOverlapChart />
        </div>
      </div>

      {/* Alerts table */}
      <DefenderAlertsTable />

      {/* Controls table */}
      <DefenderControlsTable />
    </div>
  );
}
