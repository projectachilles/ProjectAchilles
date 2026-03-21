import { useState, useEffect } from 'react';
import { CheckCircle, Info } from 'lucide-react';
import { alertsApi } from '@/services/api/alerts';
import type { AlertHistoryItem } from '@/services/api/alerts';
import { integrationsApi } from '@/services/api/integrations';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';

interface AlertsConfigProps {
  onStatusChange?: (configured: boolean) => void;
}

export function AlertsConfig({ onStatusChange }: AlertsConfigProps) {
  // Thresholds
  const [alertingEnabled, setAlertingEnabled] = useState(false);
  const [defenseScoreMin, setDefenseScoreMin] = useState('');
  const [errorRateMax, setErrorRateMax] = useState('');
  const [secureScoreMin, setSecureScoreMin] = useState('');
  const [cooldownMinutes, setCooldownMinutes] = useState('');

  // Slack
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');

  // Email (SMTP)
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [recipients, setRecipients] = useState('');

  // Agent Alerts
  const [agentAlertsEnabled, setAgentAlertsEnabled] = useState(false);
  const [offlineHoursThreshold, setOfflineHoursThreshold] = useState('');
  const [flappingThreshold, setFlappingThreshold] = useState('');
  const [fleetOnlinePercentMin, setFleetOnlinePercentMin] = useState('');
  const [agentAlertsCooldown, setAgentAlertsCooldown] = useState('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ slack?: { success: boolean; message: string }; email?: { success: boolean; message: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [defenderConfigured, setDefenderConfigured] = useState(false);
  const [alertHistory, setAlertHistory] = useState<AlertHistoryItem[]>([]);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    loadExistingSettings();
  }, []);

  const loadExistingSettings = async () => {
    try {
      const [settings, defenderSettings, history] = await Promise.all([
        alertsApi.getAlertSettings(),
        integrationsApi.getDefenderSettings().catch(() => ({ configured: false })),
        alertsApi.getAlertHistory(),
      ]);

      setDefenderConfigured(defenderSettings.configured);
      setAlertHistory(history);

      if (settings.configured) {
        setEditMode(true);
        setAlertingEnabled(settings.thresholds?.enabled ?? false);
        if (settings.thresholds?.defense_score_min != null) setDefenseScoreMin(String(settings.thresholds.defense_score_min));
        if (settings.thresholds?.error_rate_max != null) setErrorRateMax(String(settings.thresholds.error_rate_max));
        if (settings.thresholds?.secure_score_min != null) setSecureScoreMin(String(settings.thresholds.secure_score_min));
        if (settings.cooldown_minutes != null) setCooldownMinutes(String(settings.cooldown_minutes));

        setSlackEnabled(settings.slack?.enabled ?? false);
        setEmailEnabled(settings.email?.enabled ?? false);
        if (settings.email?.smtp_host) setSmtpHost(settings.email.smtp_host);
        if (settings.email?.smtp_port != null) setSmtpPort(String(settings.email.smtp_port));
        if (settings.email?.smtp_secure != null) setSmtpSecure(settings.email.smtp_secure);
        if (settings.email?.smtp_user) setSmtpUser(settings.email.smtp_user);
        if (settings.email?.from_address) setFromAddress(settings.email.from_address);
        if (settings.email?.recipients) setRecipients(settings.email.recipients.join(', '));

        setAgentAlertsEnabled(settings.agent_alerts?.enabled ?? false);
        if (settings.agent_alerts?.offline_hours_threshold != null) setOfflineHoursThreshold(String(settings.agent_alerts.offline_hours_threshold));
        if (settings.agent_alerts?.flapping_threshold != null) setFlappingThreshold(String(settings.agent_alerts.flapping_threshold));
        if (settings.agent_alerts?.fleet_online_percent_min != null) setFleetOnlinePercentMin(String(settings.agent_alerts.fleet_online_percent_min));
        if (settings.agent_alerts?.cooldown_minutes != null) setAgentAlertsCooldown(String(settings.agent_alerts.cooldown_minutes));

        onStatusChange?.(true);
      }
    } catch {
      onStatusChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  const numOrUndefined = (val: string) => val ? Number(val) : undefined;

  const buildSavePayload = () => ({
    thresholds: {
      enabled: alertingEnabled,
      defense_score_min: numOrUndefined(defenseScoreMin),
      error_rate_max: numOrUndefined(errorRateMax),
      ...(defenderConfigured ? { secure_score_min: numOrUndefined(secureScoreMin) } : {}),
    },
    cooldown_minutes: numOrUndefined(cooldownMinutes),
    slack: {
      enabled: slackEnabled,
      ...(slackWebhookUrl ? { webhook_url: slackWebhookUrl } : {}),
    },
    email: {
      enabled: emailEnabled,
      smtp_host: smtpHost || undefined,
      smtp_port: numOrUndefined(smtpPort),
      smtp_secure: smtpSecure,
      smtp_user: smtpUser || undefined,
      smtp_pass: smtpPass || undefined,
      from_address: fromAddress || undefined,
      recipients: recipients ? recipients.split(',').map((r) => r.trim()).filter(Boolean) : undefined,
    },
    agent_alerts: {
      enabled: agentAlertsEnabled,
      offline_hours_threshold: numOrUndefined(offlineHoursThreshold),
      flapping_threshold: numOrUndefined(flappingThreshold),
      fleet_online_percent_min: numOrUndefined(fleetOnlinePercentMin),
      cooldown_minutes: numOrUndefined(agentAlertsCooldown),
    },
  });

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);

      const result = await alertsApi.testAlertChannels({
        slack_webhook_url: slackWebhookUrl || undefined,
        email: {
          smtp_host: smtpHost || undefined,
          smtp_port: numOrUndefined(smtpPort),
          smtp_secure: smtpSecure,
          smtp_user: smtpUser || undefined,
          smtp_pass: smtpPass || undefined,
          from_address: fromAddress || undefined,
          recipients: recipients ? recipients.split(',').map((r) => r.trim()).filter(Boolean) : undefined,
          enabled: emailEnabled,
        },
      });

      setTestResult(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      await alertsApi.saveAlertSettings(buildSavePayload());

      setEditMode(true);
      setSuccessMessage('Alert settings saved successfully!');
      onStatusChange?.(true);

      // Clear sensitive inputs after save
      setSlackWebhookUrl('');
      setSmtpPass('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // At least one channel must be enabled for the config to be meaningful
  const canTest = slackEnabled || emailEnabled;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Edit mode info */}
      {editMode && (
        <Alert variant="default">
          <Info className="w-4 h-4" />
          <div>
            <p className="font-medium">Editing existing configuration</p>
            <p className="text-sm text-muted-foreground mt-1">
              Leave credential fields blank to keep your current values.
            </p>
          </div>
        </Alert>
      )}

      {/* Success message */}
      {successMessage && (
        <Alert variant="success">
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </Alert>
      )}

      {/* --- Thresholds Section --- */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-card-foreground border-b border-border pb-2">
          Thresholds
        </h4>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={alertingEnabled}
            onChange={(e) => setAlertingEnabled(e.target.checked)}
            className="rounded border-border"
          />
          Enable alerting
        </label>

        <Input
          label="Defense Score minimum (%)"
          type="number"
          placeholder="70"
          value={defenseScoreMin}
          onChange={(e) => setDefenseScoreMin(e.target.value)}
          helperText="Alert when Defense Score drops below this value"
        />

        <Input
          label="Error Rate maximum (%)"
          type="number"
          placeholder="30"
          value={errorRateMax}
          onChange={(e) => setErrorRateMax(e.target.value)}
          helperText="Alert when error rate exceeds this value"
        />

        {defenderConfigured && (
          <Input
            label="Secure Score minimum (%)"
            type="number"
            placeholder="60"
            value={secureScoreMin}
            onChange={(e) => setSecureScoreMin(e.target.value)}
            helperText="Alert when Microsoft Secure Score drops below this value"
          />
        )}

        <Input
          label="Cooldown (minutes)"
          type="number"
          placeholder="60"
          value={cooldownMinutes}
          onChange={(e) => setCooldownMinutes(e.target.value)}
          helperText="Minimum time between consecutive alerts"
        />
      </div>

      {/* --- Slack Section --- */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-card-foreground border-b border-border pb-2">
          Slack
        </h4>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={slackEnabled}
            onChange={(e) => setSlackEnabled(e.target.checked)}
            className="rounded border-border"
          />
          Enable Slack notifications
        </label>

        <Input
          label="Webhook URL"
          type="password"
          placeholder={editMode ? 'Leave blank to keep current' : 'https://hooks.slack.com/services/...'}
          value={slackWebhookUrl}
          onChange={(e) => setSlackWebhookUrl(e.target.value)}
          helperText={editMode ? 'Optional: Only fill in to update' : 'Slack incoming webhook URL'}
        />
      </div>

      {/* --- Email (SMTP) Section --- */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-card-foreground border-b border-border pb-2">
          Email (SMTP)
        </h4>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => setEmailEnabled(e.target.checked)}
            className="rounded border-border"
          />
          Enable email notifications
        </label>

        <Input
          label="SMTP Host"
          placeholder="smtp.example.com"
          value={smtpHost}
          onChange={(e) => setSmtpHost(e.target.value)}
        />

        <Input
          label="SMTP Port"
          type="number"
          placeholder="587"
          value={smtpPort}
          onChange={(e) => setSmtpPort(e.target.value)}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={smtpSecure}
            onChange={(e) => setSmtpSecure(e.target.checked)}
            className="rounded border-border"
          />
          Use TLS
        </label>

        <Input
          label="Username"
          placeholder={editMode ? 'Leave blank to keep current' : 'SMTP username'}
          value={smtpUser}
          onChange={(e) => setSmtpUser(e.target.value)}
          helperText={editMode ? 'Optional: Only fill in to update' : undefined}
        />

        <Input
          label="Password"
          type="password"
          placeholder={editMode ? 'Leave blank to keep current' : 'SMTP password'}
          value={smtpPass}
          onChange={(e) => setSmtpPass(e.target.value)}
          helperText={editMode ? 'Optional: Only fill in to update' : undefined}
        />

        <Input
          label="From Address"
          placeholder="alerts@example.com"
          value={fromAddress}
          onChange={(e) => setFromAddress(e.target.value)}
        />

        <Input
          label="Recipients"
          placeholder="user1@example.com, user2@example.com"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          helperText="Comma-separated list of email addresses"
        />
      </div>

      {/* --- Agent Alerts Section --- */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-card-foreground border-b border-border pb-2">
          Agent Alerts
        </h4>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={agentAlertsEnabled}
            onChange={(e) => setAgentAlertsEnabled(e.target.checked)}
            className="rounded border-border"
          />
          Enable agent alerts
        </label>

        <Input
          label="Offline Threshold (hours)"
          type="number"
          placeholder="4"
          value={offlineHoursThreshold}
          onChange={(e) => setOfflineHoursThreshold(e.target.value)}
          helperText="Alert when any agent is offline longer than this"
        />

        <Input
          label="Flapping Threshold (reconnects/24h)"
          type="number"
          placeholder="5"
          value={flappingThreshold}
          onChange={(e) => setFlappingThreshold(e.target.value)}
          helperText="Alert when an agent reconnects more than this many times in 24 hours"
        />

        <Input
          label="Fleet Online Minimum (%)"
          type="number"
          placeholder="80"
          value={fleetOnlinePercentMin}
          onChange={(e) => setFleetOnlinePercentMin(e.target.value)}
          helperText="Alert when fleet online percentage drops below this value"
        />

        <Input
          label="Cooldown (minutes)"
          type="number"
          placeholder="30"
          value={agentAlertsCooldown}
          onChange={(e) => setAgentAlertsCooldown(e.target.value)}
          helperText="Minimum time between consecutive agent alerts"
        />
      </div>

      {/* Test results */}
      {testResult && (
        <div className="space-y-2">
          {testResult.slack && (
            <Alert variant={testResult.slack.success ? 'success' : 'destructive'}>
              Slack: {testResult.slack.message}
            </Alert>
          )}
          {testResult.email && (
            <Alert variant={testResult.email.success ? 'success' : 'destructive'}>
              Email: {testResult.email.message}
            </Alert>
          )}
        </div>
      )}

      {/* Error */}
      {error && <Alert variant="destructive">{error}</Alert>}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleTest} disabled={!canTest || testing}>
          {testing ? (
            <>
              <Spinner size="sm" />
              Testing...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Test Channels
            </>
          )}
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Spinner size="sm" />
              {editMode ? 'Updating...' : 'Saving...'}
            </>
          ) : editMode ? (
            'Update Settings'
          ) : (
            'Save Settings'
          )}
        </Button>
      </div>

      {/* Recent Alerts */}
      {alertHistory.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-card-foreground border-b border-border pb-2">
            Recent Alerts
          </h4>
          {alertHistory.slice(0, 5).map((alert, i) => (
            <div key={i} className="text-sm text-muted-foreground flex items-center justify-between">
              <span>
                {new Date(alert.timestamp).toLocaleString()} — {alert.breaches.map(b => `${b.metric} ${b.current}${b.unit}`).join(', ')}
              </span>
              <span className="flex gap-1">
                {alert.channels.slack && <span className="text-xs bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded">Slack</span>}
                {alert.channels.email && <span className="text-xs bg-green-500/10 text-green-500 px-1.5 py-0.5 rounded">Email</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
