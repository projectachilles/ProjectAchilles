import { useState, useCallback, useEffect } from 'react';
import { Database, Cloud, ShieldCheck } from 'lucide-react';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { IntegrationCard, type IntegrationStatus } from './IntegrationCard';
import { AnalyticsConfig } from './AnalyticsConfig';
import { AzureConfig } from './AzureConfig';
import { DefenderConfig } from './DefenderConfig';
import { integrationsApi } from '@/services/api/integrations';

export function IntegrationsTab() {
  const { configured: analyticsConfigured } = useAnalyticsAuth();

  // Local state to track status changes from config forms
  const [analyticsStatus, setAnalyticsStatus] = useState<IntegrationStatus>(
    analyticsConfigured ? 'connected' : 'not-configured'
  );
  const [azureStatus, setAzureStatus] = useState<IntegrationStatus>('not-configured');
  const [azureLoaded, setAzureLoaded] = useState(false);
  const [defenderStatus, setDefenderStatus] = useState<IntegrationStatus>('not-configured');
  const [defenderLoaded, setDefenderLoaded] = useState(false);

  const handleAnalyticsStatusChange = useCallback((configured: boolean) => {
    setAnalyticsStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleAzureStatusChange = useCallback((configured: boolean) => {
    setAzureStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleDefenderStatusChange = useCallback((configured: boolean) => {
    setDefenderStatus(configured ? 'connected' : 'not-configured');
  }, []);

  // Pre-fetch Azure + Defender status for the card badges
  useEffect(() => {
    integrationsApi.getAzureSettings().then((settings) => {
      setAzureStatus(settings.configured ? 'connected' : 'not-configured');
      setAzureLoaded(true);
    }).catch(() => {
      setAzureLoaded(true);
    });

    integrationsApi.getDefenderSettings().then((settings) => {
      setDefenderStatus(settings.configured ? 'connected' : 'not-configured');
      setDefenderLoaded(true);
    }).catch(() => {
      setDefenderLoaded(true);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Integrations</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Connect external services to enable additional features
        </p>
      </div>

      <IntegrationCard
        icon={Database}
        title="Analytics (Elasticsearch)"
        description="Elasticsearch cluster connection for test results and analytics"
        status={analyticsStatus}
        defaultExpanded={!analyticsConfigured}
      >
        <AnalyticsConfig onStatusChange={handleAnalyticsStatusChange} />
      </IntegrationCard>

      <IntegrationCard
        icon={Cloud}
        title="Azure / Entra ID"
        description="Service principal for cloud identity tenant security assessments"
        status={azureStatus}
        defaultExpanded={azureLoaded && azureStatus === 'not-configured'}
      >
        <AzureConfig onStatusChange={handleAzureStatusChange} />
      </IntegrationCard>

      <IntegrationCard
        icon={ShieldCheck}
        title="Microsoft Defender"
        description="Secure Score, alerts, and security controls via Microsoft Graph"
        status={defenderStatus}
        defaultExpanded={defenderLoaded && defenderStatus === 'not-configured'}
      >
        <DefenderConfig onStatusChange={handleDefenderStatusChange} />
      </IntegrationCard>
    </div>
  );
}
