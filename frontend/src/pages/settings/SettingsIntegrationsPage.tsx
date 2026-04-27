import { useState, useCallback, useEffect } from 'react';
import { Database, Cloud, ShieldCheck, Bell } from 'lucide-react';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { integrationsApi } from '@/services/api/integrations';
import { alertsApi } from '@/services/api/alerts';
import { SettingsPageHeader } from './components/SettingsPageHeader';
import { SettingsCard } from './components/SettingsCard';
import { AnalyticsConfig } from './components/AnalyticsConfig';
import { AzureConfig } from './components/AzureConfig';
import { DefenderConfig } from './components/DefenderConfig';
import { AlertsConfig } from './components/AlertsConfig';
import type { IntegrationStatus } from './components/IntegrationCard';

export default function SettingsIntegrationsPage() {
  const { configured: analyticsConfigured } = useAnalyticsAuth();

  const [analyticsStatus, setAnalyticsStatus] = useState<IntegrationStatus>(
    analyticsConfigured ? 'connected' : 'not-configured'
  );
  const [azureStatus, setAzureStatus] = useState<IntegrationStatus>('not-configured');
  const [defenderStatus, setDefenderStatus] = useState<IntegrationStatus>('not-configured');
  const [alertsStatus, setAlertsStatus] = useState<IntegrationStatus>('not-configured');

  useEffect(() => {
    integrationsApi
      .getAzureSettings()
      .then((s) => setAzureStatus(s.configured ? 'connected' : 'not-configured'))
      .catch(() => {});
    integrationsApi
      .getDefenderSettings()
      .then((s) => setDefenderStatus(s.configured ? 'connected' : 'not-configured'))
      .catch(() => {});
    alertsApi
      .getAlertSettings()
      .then((s) => setAlertsStatus(s.configured ? 'connected' : 'not-configured'))
      .catch(() => {});
  }, []);

  const handleAnalyticsStatusChange = useCallback((c: boolean) => {
    setAnalyticsStatus(c ? 'connected' : 'not-configured');
  }, []);
  const handleAzureStatusChange = useCallback((c: boolean) => {
    setAzureStatus(c ? 'connected' : 'not-configured');
  }, []);
  const handleDefenderStatusChange = useCallback((c: boolean) => {
    setDefenderStatus(c ? 'connected' : 'not-configured');
  }, []);
  const handleAlertsStatusChange = useCallback((c: boolean) => {
    setAlertsStatus(c ? 'connected' : 'not-configured');
  }, []);

  return (
    <main className="settings-content">
      <SettingsPageHeader
        eyebrow="Settings / Integrations"
        title="Integrations"
        description="Connect external services to enable analytics, identity assessments, and notifications."
      />

      <div className="settings-stack">
        <SettingsCard
          icon={Database}
          title="Analytics (Elasticsearch)"
          description="Cluster connection used for test-result ingestion and analytics dashboards."
          status={analyticsStatus}
        >
          <AnalyticsConfig onStatusChange={handleAnalyticsStatusChange} />
        </SettingsCard>

        <SettingsCard
          icon={Cloud}
          title="Azure / Entra ID"
          description="Service principal for cloud identity / tenant security assessments."
          status={azureStatus}
        >
          <AzureConfig onStatusChange={handleAzureStatusChange} />
        </SettingsCard>

        <SettingsCard
          icon={ShieldCheck}
          title="Microsoft Defender"
          description="Secure Score, alerts, and security controls via Microsoft Graph."
          status={defenderStatus}
        >
          <DefenderConfig onStatusChange={handleDefenderStatusChange} />
        </SettingsCard>

        <SettingsCard
          icon={Bell}
          title="Alerts & Notifications"
          description="Threshold-based alerting via Slack and email when scores cross configured limits."
          status={alertsStatus}
        >
          <AlertsConfig onStatusChange={handleAlertsStatusChange} />
        </SettingsCard>
      </div>
    </main>
  );
}
