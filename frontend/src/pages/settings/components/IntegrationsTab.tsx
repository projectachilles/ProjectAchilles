import { useState, useCallback, useEffect } from 'react';
import { Database, Cloud, ShieldCheck, Bell, MailCheck } from 'lucide-react';
import { CrowdStrikeLogo, SentinelOneLogo } from '@/components/shared/VendorLogos';
import { useAnalyticsAuth } from '@/hooks/useAnalyticsAuth';
import type { IntegrationStatus } from './IntegrationCard';
import { IntegrationGridCard } from './IntegrationGridCard';
import { AnalyticsConfig } from './AnalyticsConfig';
import { AzureConfig } from './AzureConfig';
import { DefenderConfig } from './DefenderConfig';
import { CrowdStrikeConfig } from './CrowdStrikeConfig';
import { SentinelOneConfig } from './SentinelOneConfig';
import { AlertsConfig } from './AlertsConfig';
import { PreExecutionNoticesConfig } from './PreExecutionNoticesConfig';
import { useCapabilities } from '@/hooks/useCapabilities';
import { integrationsApi } from '@/services/api/integrations';
import { alertsApi } from '@/services/api/alerts';
import { sentinelOneApi } from '@/services/api/sentinelone';

export function IntegrationsTab() {
  const { configured: analyticsConfigured } = useAnalyticsAuth();
  const { preExecutionNotices, sentinelone } = useCapabilities();
  const [noticesStatus, setNoticesStatus] = useState<IntegrationStatus>('not-configured');
  const handleNoticesStatusChange = useCallback((enabled: boolean) => {
    setNoticesStatus(enabled ? 'connected' : 'not-configured');
  }, []);

  // Local state to track status changes from config forms
  const [analyticsStatus, setAnalyticsStatus] = useState<IntegrationStatus>(
    analyticsConfigured ? 'connected' : 'not-configured'
  );
  const [azureStatus, setAzureStatus] = useState<IntegrationStatus>('not-configured');
  const [defenderStatus, setDefenderStatus] = useState<IntegrationStatus>('not-configured');
  const [crowdstrikeStatus, setCrowdStrikeStatus] = useState<IntegrationStatus>('not-configured');
  const [sentinelOneStatus, setSentinelOneStatus] = useState<IntegrationStatus>('not-configured');
  const [alertsStatus, setAlertsStatus] = useState<IntegrationStatus>('not-configured');

  const handleAnalyticsStatusChange = useCallback((configured: boolean) => {
    setAnalyticsStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleAzureStatusChange = useCallback((configured: boolean) => {
    setAzureStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleDefenderStatusChange = useCallback((configured: boolean) => {
    setDefenderStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleCrowdStrikeStatusChange = useCallback((configured: boolean) => {
    setCrowdStrikeStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleSentinelOneStatusChange = useCallback((configured: boolean) => {
    setSentinelOneStatus(configured ? 'connected' : 'not-configured');
  }, []);

  const handleAlertsStatusChange = useCallback((configured: boolean) => {
    setAlertsStatus(configured ? 'connected' : 'not-configured');
  }, []);

  // Pre-fetch Azure + Defender + CrowdStrike status for the card badges
  useEffect(() => {
    integrationsApi.getAzureSettings().then((settings) => {
      setAzureStatus(settings.configured ? 'connected' : 'not-configured');
    }).catch(() => {});

    integrationsApi.getDefenderSettings().then((settings) => {
      setDefenderStatus(settings.configured ? 'connected' : 'not-configured');
    }).catch(() => {});

    integrationsApi.getCrowdStrikeSettings().then((settings) => {
      setCrowdStrikeStatus(settings.configured ? 'connected' : 'not-configured');
    }).catch(() => {});

    alertsApi.getAlertSettings().then((settings) => {
      setAlertsStatus(settings.configured ? 'connected' : 'not-configured');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sentinelone) return;
    sentinelOneApi.getSettings().then((settings) => {
      setSentinelOneStatus(settings.configured ? 'connected' : 'not-configured');
    }).catch(() => {});
  }, [sentinelone]);

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
      <IntegrationGridCard
        icon={Database}
        title="Analytics (Elasticsearch)"
        description="Elasticsearch cluster connection for test results and analytics"
        status={analyticsStatus}
      >
        <AnalyticsConfig onStatusChange={handleAnalyticsStatusChange} />
      </IntegrationGridCard>

      <IntegrationGridCard
        icon={Cloud}
        title="Azure / Entra ID"
        description="Service principal for cloud identity tenant security assessments"
        status={azureStatus}
      >
        <AzureConfig onStatusChange={handleAzureStatusChange} />
      </IntegrationGridCard>

      <IntegrationGridCard
        icon={ShieldCheck}
        title="Microsoft Defender"
        description="Secure Score, alerts, and security controls via Microsoft Graph"
        status={defenderStatus}
      >
        <DefenderConfig onStatusChange={handleDefenderStatusChange} />
      </IntegrationGridCard>

      <IntegrationGridCard
        icon={CrowdStrikeLogo}
        title="CrowdStrike Falcon"
        description="Alerts, posture scores, and detection correlation via CrowdStrike Falcon"
        status={crowdstrikeStatus}
      >
        <CrowdStrikeConfig onStatusChange={handleCrowdStrikeStatusChange} />
      </IntegrationGridCard>

      {sentinelone && (
        <IntegrationGridCard
          icon={SentinelOneLogo}
          title="SentinelOne"
          description="Threats and detection alerts via the SentinelOne API, with opt-in auto-resolve"
          status={sentinelOneStatus}
        >
          <SentinelOneConfig onStatusChange={handleSentinelOneStatusChange} />
        </IntegrationGridCard>
      )}

      <IntegrationGridCard
        icon={Bell}
        title="Alerts & Notifications"
        description="Threshold-based alerting via Slack and email on score changes"
        status={alertsStatus}
      >
        <AlertsConfig onStatusChange={handleAlertsStatusChange} />
      </IntegrationGridCard>

      {preExecutionNotices && (
        <IntegrationGridCard
          icon={MailCheck}
          title="Pre-execution notices"
          description="Email security engineers before tests run and hold tests until the notice is accepted"
          status={noticesStatus}
        >
          <PreExecutionNoticesConfig onStatusChange={handleNoticesStatusChange} />
        </IntegrationGridCard>
      )}
    </div>
  );
}
