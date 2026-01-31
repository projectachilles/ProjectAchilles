import { useState, useCallback } from 'react';
import { Database, Cpu } from 'lucide-react';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { useAppSelector } from '@/store';
import { IntegrationCard, type IntegrationStatus } from './IntegrationCard';
import { AnalyticsConfig } from './AnalyticsConfig';
import { EndpointsConfig } from './EndpointsConfig';

export function IntegrationsTab() {
  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const { isAuthenticated: endpointsAuthenticated } = useAppSelector(
    (state) => state.endpointAuth
  );

  // Local state to track status changes from config forms
  const [analyticsStatus, setAnalyticsStatus] = useState<IntegrationStatus>(
    analyticsConfigured ? 'connected' : 'not-configured'
  );
  const [endpointsStatus, setEndpointsStatus] = useState<IntegrationStatus>(
    endpointsAuthenticated ? 'connected' : 'not-configured'
  );

  const handleAnalyticsStatusChange = useCallback((configured: boolean) => {
    setAnalyticsStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleEndpointsStatusChange = useCallback((authenticated: boolean) => {
    setEndpointsStatus(authenticated ? 'connected' : 'not-configured');
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
        icon={Cpu}
        title="Endpoints (LimaCharlie)"
        description="Endpoint detection and response platform"
        status={endpointsStatus}
        defaultExpanded={!endpointsAuthenticated}
      >
        <EndpointsConfig onStatusChange={handleEndpointsStatusChange} />
      </IntegrationCard>
    </div>
  );
}
