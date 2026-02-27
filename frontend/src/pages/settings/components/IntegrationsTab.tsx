import { useState, useCallback, useEffect } from 'react';
import { Database, Cloud } from 'lucide-react';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { IntegrationCard, type IntegrationStatus } from './IntegrationCard';
import { AnalyticsConfig } from './AnalyticsConfig';
import { AzureConfig } from './AzureConfig';
import { integrationsApi } from '@/services/api/integrations';

export function IntegrationsTab() {
  const { configured: analyticsConfigured } = useAnalyticsAuth();

  // Local state to track status changes from config forms
  const [analyticsStatus, setAnalyticsStatus] = useState<IntegrationStatus>(
    analyticsConfigured ? 'connected' : 'not-configured'
  );
  const [azureStatus, setAzureStatus] = useState<IntegrationStatus>('not-configured');
  const [azureLoaded, setAzureLoaded] = useState(false);

  const handleAnalyticsStatusChange = useCallback((configured: boolean) => {
    setAnalyticsStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleAzureStatusChange = useCallback((configured: boolean) => {
    setAzureStatus(configured ? 'connected' : 'not-configured');
  }, []);

  // Pre-fetch Azure status for the card badge
  useEffect(() => {
    integrationsApi.getAzureSettings().then((settings) => {
      setAzureStatus(settings.configured ? 'connected' : 'not-configured');
      setAzureLoaded(true);
    }).catch(() => {
      setAzureLoaded(true);
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
    </div>
  );
}
