import { useState, useCallback } from 'react';
import { Database } from 'lucide-react';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { SettingsPageHeader } from './components/SettingsPageHeader';
import { SettingsCard } from './components/SettingsCard';
import { AnalyticsConfig } from './components/AnalyticsConfig';
import type { IntegrationStatus } from './components/IntegrationCard';

export default function SettingsAnalyticsPage() {
  const { configured } = useAnalyticsAuth();
  const [status, setStatus] = useState<IntegrationStatus>(
    configured ? 'connected' : 'not-configured'
  );

  const handleStatusChange = useCallback((c: boolean) => {
    setStatus(c ? 'connected' : 'not-configured');
  }, []);

  return (
    <main className="settings-content">
      <SettingsPageHeader
        eyebrow="Telemetry"
        title="Analytics (Elasticsearch)"
        description="Connect the Elasticsearch cluster used to store and analyse test results."
      />

      <SettingsCard
        icon={Database}
        title="Elasticsearch Connection"
        description="Cloud (Elastic Cloud) or direct connection. Credentials are AES-256-GCM encrypted on disk."
        status={status}
        statusMessage={status === 'connected' ? 'Cluster reachable' : 'Disconnected'}
      >
        <AnalyticsConfig onStatusChange={handleStatusChange} />
      </SettingsCard>
    </main>
  );
}
