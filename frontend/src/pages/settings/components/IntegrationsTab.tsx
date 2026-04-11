import { useState, useCallback, useEffect } from 'react';
import { Database, Cloud, ShieldCheck, Bell, KeyRound, Globe, Users, Plug } from 'lucide-react';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import { IntegrationCard, type IntegrationStatus } from './IntegrationCard';
import { AnalyticsConfig } from './AnalyticsConfig';
import { AzureConfig } from './AzureConfig';
import { DefenderConfig } from './DefenderConfig';
import { AlertsConfig } from './AlertsConfig';
import { AuthProviderConfig } from './AuthProviderConfig';
import { ApiKeysConfig } from './ApiKeysConfig';
import { integrationsApi } from '@/services/api/integrations';
import { alertsApi } from '@/services/api/alerts';
import { authProvidersApi } from '@/services/api/authProviders';
import { apikeysApi } from '@/services/api/apikeys';

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
  const [alertsStatus, setAlertsStatus] = useState<IntegrationStatus>('not-configured');
  const [alertsLoaded, setAlertsLoaded] = useState(false);

  // Auth providers
  const [azureAdAuthStatus, setAzureAdAuthStatus] = useState<IntegrationStatus>('not-configured');
  const [googleAuthStatus, setGoogleAuthStatus] = useState<IntegrationStatus>('not-configured');
  const [clerkAuthStatus, setClerkAuthStatus] = useState<IntegrationStatus>('not-configured');
  const [authProvidersLoaded, setAuthProvidersLoaded] = useState(false);

  // API keys
  const [apiKeysStatus, setApiKeysStatus] = useState<IntegrationStatus>('not-configured');

  const handleAnalyticsStatusChange = useCallback((configured: boolean) => {
    setAnalyticsStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleAzureStatusChange = useCallback((configured: boolean) => {
    setAzureStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleDefenderStatusChange = useCallback((configured: boolean) => {
    setDefenderStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleAlertsStatusChange = useCallback((configured: boolean) => {
    setAlertsStatus(configured ? 'connected' : 'not-configured');
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

    alertsApi.getAlertSettings().then((settings) => {
      setAlertsStatus(settings.configured ? 'connected' : 'not-configured');
      setAlertsLoaded(true);
    }).catch(() => {
      setAlertsLoaded(true);
    });

    // Fetch auth provider statuses
    Promise.all([
      authProvidersApi.getSettings('azuread').then(s => setAzureAdAuthStatus(s.configured ? 'connected' : 'not-configured')).catch(() => {}),
      authProvidersApi.getSettings('google').then(s => setGoogleAuthStatus(s.configured ? 'connected' : 'not-configured')).catch(() => {}),
      authProvidersApi.getSettings('clerk').then(s => setClerkAuthStatus(s.configured ? 'connected' : 'not-configured')).catch(() => {}),
    ]).finally(() => setAuthProvidersLoaded(true));

    apikeysApi.list().then(({ keys }) => {
      setApiKeysStatus(keys.length > 0 ? 'connected' : 'not-configured');
    }).catch(() => {});
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

      <IntegrationCard
        icon={Bell}
        title="Alerts & Notifications"
        description="Threshold-based alerting via Slack and email on score changes"
        status={alertsStatus}
        defaultExpanded={alertsLoaded && alertsStatus === 'not-configured'}
      >
        <AlertsConfig onStatusChange={handleAlertsStatusChange} />
      </IntegrationCard>

      {/* Authentication Providers */}
      <div className="mt-8 mb-6">
        <h2 className="text-xl font-semibold">Authentication</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Configure sign-in methods for your team. Enabled providers appear on the login page.
        </p>
      </div>

      <IntegrationCard
        icon={Cloud}
        title="Azure AD / Entra ID"
        description="Sign in with Microsoft corporate accounts via OAuth 2.0"
        status={azureAdAuthStatus}
        defaultExpanded={authProvidersLoaded && azureAdAuthStatus === 'not-configured'}
      >
        <AuthProviderConfig
          provider="azuread"
          fields={[
            { key: 'tenant_id', label: 'Tenant ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', helperText: 'Azure AD tenant (directory) ID' },
            { key: 'client_id', label: 'Client ID (Application ID)', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', helperText: 'App registration client ID' },
            { key: 'client_secret', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', helperText: 'App registration client secret value' },
          ]}
          onStatusChange={(c) => setAzureAdAuthStatus(c ? 'connected' : 'not-configured')}
        />
      </IntegrationCard>

      <IntegrationCard
        icon={Globe}
        title="Google"
        description="Sign in with Google accounts via OAuth 2.0"
        status={googleAuthStatus}
        defaultExpanded={authProvidersLoaded && googleAuthStatus === 'not-configured'}
      >
        <AuthProviderConfig
          provider="google"
          fields={[
            { key: 'client_id', label: 'Client ID', placeholder: 'xxxxx.apps.googleusercontent.com', helperText: 'Google Cloud Console OAuth 2.0 client ID' },
            { key: 'client_secret', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', helperText: 'OAuth 2.0 client secret' },
          ]}
          onStatusChange={(c) => setGoogleAuthStatus(c ? 'connected' : 'not-configured')}
        />
      </IntegrationCard>

      <IntegrationCard
        icon={Users}
        title="Clerk"
        description="Managed authentication with Clerk (user management, SSO, MFA)"
        status={clerkAuthStatus}
        defaultExpanded={authProvidersLoaded && clerkAuthStatus === 'not-configured'}
      >
        <AuthProviderConfig
          provider="clerk"
          fields={[
            { key: 'publishable_key', label: 'Publishable Key', placeholder: 'pk_test_...', helperText: 'From Clerk Dashboard → API Keys' },
            { key: 'secret_key', label: 'Secret Key', placeholder: 'sk_test_...', type: 'password', helperText: 'From Clerk Dashboard → API Keys' },
          ]}
          onStatusChange={(c) => setClerkAuthStatus(c ? 'connected' : 'not-configured')}
        />
      </IntegrationCard>

      {/* External API Access */}
      <div className="mt-8 mb-6">
        <h2 className="text-xl font-semibold">External API</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Generate API keys for external platforms to access the test library and MITRE coverage data
        </p>
      </div>

      <IntegrationCard
        icon={Plug}
        title="External API Access"
        description="API keys for read-only access to tests and MITRE ATT&CK coverage"
        status={apiKeysStatus}
        defaultExpanded
      >
        <ApiKeysConfig onStatusChange={(c) => setApiKeysStatus(c ? 'connected' : 'not-configured')} />
      </IntegrationCard>
    </div>
  );
}
