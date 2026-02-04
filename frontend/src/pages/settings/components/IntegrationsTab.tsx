import { useState, useCallback } from 'react';
import { Database } from 'lucide-react';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { IntegrationCard, type IntegrationStatus } from './IntegrationCard';
import { AnalyticsConfig } from './AnalyticsConfig';

export function IntegrationsTab() {
  const { configured: analyticsConfigured } = useAnalyticsAuth();

  // Local state to track status changes from config forms
  const [analyticsStatus, setAnalyticsStatus] = useState<IntegrationStatus>(
    analyticsConfigured ? 'connected' : 'not-configured'
  );

  const handleAnalyticsStatusChange = useCallback((configured: boolean) => {
    setAnalyticsStatus(configured ? 'connected' : 'not-configured');
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
    </div>
  );
}
