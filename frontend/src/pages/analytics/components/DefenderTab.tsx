import { useState, useEffect } from 'react';
import {
  defenderApi,
  type SecureScoreSummary,
  type AlertSummary,
} from '@/services/api/defender';
import DefenderTabHeader from './DefenderTabHeader';
import SecureScoreCard from './SecureScoreCard';
import AlertsSummaryCard from './AlertsSummaryCard';
import AutoResolveStatTile from './AutoResolveStatTile';
import TopControlsCard from './TopControlsCard';
import TechniqueOverlapChart from './TechniqueOverlapChart';
import DetectionAnalysisCard from './DetectionAnalysisCard';

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
    const [scoreResult, alertResult] = await Promise.allSettled([
      defenderApi.getSecureScore(),
      defenderApi.getAlertSummary(),
    ]);

    if (scoreResult.status === 'fulfilled') {
      setSecureScore(scoreResult.value);
    } else {
      console.error('Failed to load Defender secure score:', scoreResult.reason);
    }

    if (alertResult.status === 'fulfilled') {
      setAlertSummary(alertResult.value);
    } else {
      console.error('Failed to load Defender alert summary:', alertResult.reason);
    }

    setLoading(false);
  }

  async function loadSyncStatus() {
    try {
      const res = await fetch('/api/integrations/defender/sync/status', {
        headers: { Authorization: `Bearer ${document.cookie}` },
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
      <DefenderTabHeader lastSync={lastSync} syncing={syncing} onSync={handleSync} />

      {/* Top stat row: Secure Score · Alerts Summary · Auto-Resolve */}
      <div className="grid grid-cols-12 gap-4" style={{ minHeight: '280px' }}>
        <div className="col-span-12 md:col-span-4">
          <SecureScoreCard data={secureScore} loading={loading} />
        </div>
        <div className="col-span-12 md:col-span-4">
          <AlertsSummaryCard data={alertSummary} loading={loading} />
        </div>
        <div className="col-span-12 md:col-span-4">
          <AutoResolveStatTile />
        </div>
      </div>

      {/* Recommendations */}
      <TopControlsCard compact />

      {/* Detection analysis */}
      <DetectionAnalysisCard />

      {/* Technique overlap */}
      <TechniqueOverlapChart />
    </div>
  );
}
