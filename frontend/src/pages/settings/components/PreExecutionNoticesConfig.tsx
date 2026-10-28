import { useEffect, useState } from 'react';
import { CheckCircle, Send } from 'lucide-react';
import { noticesApi } from '@/services/api/notices';
import type { NoticeDigestStatus, NoticeTestResult } from '@/services/api/notices';
import { Input } from '@/components/shared/ui/Input';
import { Button } from '@/components/shared/ui/Button';
import { Alert } from '@/components/shared/ui/Alert';
import { Spinner } from '@/components/shared/ui/Spinner';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { HeldNoticesPanel } from './HeldNoticesPanel';

interface PreExecutionNoticesConfigProps {
  onStatusChange?: (enabled: boolean) => void;
}

const parseRecipients = (raw: string): string[] =>
  raw.split(/[,\n;]+/).map((r) => r.trim()).filter(Boolean);

/** A cleared number input is left out of the save, so the server keeps its value (instead of 0). */
const numberField = <K extends string>(key: K, raw: string): Partial<Record<K, number>> =>
  raw.trim() === '' ? {} : ({ [key]: Number(raw) } as Record<K, number>);

const digestLine = (d: NoticeDigestStatus): string | null => {
  switch (d.state) {
    case 'sent':
      return `Last digest ${d.digestDate}: sent to ${d.recipientCount} recipients (${d.occurrenceCount} runs on ${d.hostCount} hosts)`;
    case 'empty':
      return `Last digest ${d.digestDate}: nothing scheduled for ${d.runDate}`;
    case 'failed':
      return `Last digest ${d.digestDate}: not sent (${d.lastError ?? 'unknown error'})`;
    default:
      return null;
  }
};

const browserTimezone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

export function PreExecutionNoticesConfig({ onStatusChange }: PreExecutionNoticesConfigProps) {
  const [enabled, setEnabled] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [leadMinutes, setLeadMinutes] = useState('5');
  const [maxWait, setMaxWait] = useState('60');
  const [pickupWindow, setPickupWindow] = useState('120');
  const [sendFinished, setSendFinished] = useState(true);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestTimezone, setDigestTimezone] = useState('UTC');
  const [digestNeverSaved, setDigestNeverSaved] = useState(false);
  const [digests, setDigests] = useState<NoticeDigestStatus[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [lastCheck, setLastCheck] = useState<{ at?: string; ok?: boolean; message?: string } | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<NoticeTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    noticesApi
      .getSettings()
      .then((s) => {
        setEnabled(s.enabled);
        setRecipients(s.recipients.join(', '));
        setLeadMinutes(String(s.lead_minutes));
        setMaxWait(String(s.max_wait_minutes));
        setPickupWindow(String(s.pickup_window_minutes));
        setSendFinished(s.send_finished);
        setDigestEnabled(s.advance_digest_enabled ?? false);
        setDigestTimezone(s.digest_timezone ?? 'UTC');
        setDigestNeverSaved(!s.advance_digest_enabled && (s.digest_timezone ?? 'UTC') === 'UTC');
        setSmtpConfigured(s.smtp_configured);
        if (s.last_smtp_check_at) {
          setLastCheck({ at: s.last_smtp_check_at, ok: s.last_smtp_check_ok, message: s.last_smtp_check_message });
        }
        onStatusChange?.(s.enabled);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
    Promise.resolve()
      .then(() => noticesApi.getStatus())
      .then((st) => setDigests(st?.digests ?? []))
      .catch(() => setDigests([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);
      const saved = await noticesApi.saveSettings({
        enabled,
        recipients: parseRecipients(recipients),
        ...numberField('lead_minutes', leadMinutes),
        ...numberField('max_wait_minutes', maxWait),
        ...numberField('pickup_window_minutes', pickupWindow),
        send_finished: sendFinished,
        advance_digest_enabled: digestEnabled,
        digest_timezone: digestTimezone,
      });
      setDigestNeverSaved(false);
      setSmtpConfigured(saved.smtp_configured);
      // Show what the server kept for any field that was left empty.
      setLeadMinutes(String(saved.lead_minutes));
      setMaxWait(String(saved.max_wait_minutes));
      setPickupWindow(String(saved.pickup_window_minutes));
      setSuccessMessage('Pre-execution notice settings saved.');
      onStatusChange?.(saved.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setError(null);
      setTestResult(null);
      setTestResult(await noticesApi.sendTest());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test notice failed');
    } finally {
      setTesting(false);
    }
  };

  const handleDigestToggle = (checked: boolean) => {
    setDigestEnabled(checked);
    if (checked && digestNeverSaved) {
      const tz = browserTimezone();
      if (tz) setDigestTimezone(tz);
    }
  };

  const digestLines = digests
    .map((d) => ({ orgId: d.orgId, text: digestLine(d) }))
    .filter((l): l is { orgId: string; text: string } => l.text !== null);
  const showDigestStatus =
    digestLines.length > 0 && (digestEnabled || digests.some((d) => d.state === 'failed'));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeldNoticesPanel />
      {successMessage && (
        <Alert variant="success">
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </Alert>
      )}

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Before security tests run, email the recipients below and hold the tests until the mail
          server accepts the notice.
        </p>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!smtpConfigured}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-border"
            />
            Enable pre-execution notices
          </label>
          {!smtpConfigured && (
            <p className="mt-1 text-xs text-muted-foreground">Configure SMTP email in Alerts first</p>
          )}
        </div>

        <div className="w-full">
          <label htmlFor="notice-recipients" className="block text-sm font-medium mb-1.5 text-foreground">
            Recipients
          </label>
          <textarea
            id="notice-recipients"
            rows={2}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="secops@example.com, oncall@example.com"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Comma or newline separated (max 50). Save before sending a test notice.
          </p>
        </div>

        <Input
          label="Lead time (minutes)"
          type="number"
          min={0}
          max={5}
          value={leadMinutes}
          onChange={(e) => setLeadMinutes(e.target.value)}
          helperText="Delay between the notice being accepted and tests starting (0–5)"
        />
        <Input
          label="Max wait for delivery (minutes)"
          type="number"
          min={15}
          max={1440}
          value={maxWait}
          onChange={(e) => setMaxWait(e.target.value)}
          helperText="Give up and skip the run if the notice is not accepted in this time (15–1440)"
        />
        <Input
          label="Pickup window (minutes)"
          type="number"
          min={30}
          max={1440}
          value={pickupWindow}
          onChange={(e) => setPickupWindow(e.target.value)}
          helperText="How long agents have to pick up tests after release (30–1440)"
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendFinished}
            onChange={(e) => setSendFinished(e.target.checked)}
            className="rounded border-border"
          />
          Send a finished email when the run completes
        </label>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={digestEnabled}
              disabled={!enabled}
              onChange={(e) => handleDigestToggle(e.target.checked)}
              className="rounded border-border"
            />
            Send a daily advance digest at 09:00 listing tomorrow's scheduled tests
          </label>
          {!enabled && (
            <p className="mt-1 text-xs text-muted-foreground">
              Turn on pre-execution notices to use the digest.
            </p>
          )}
        </div>

        {digestEnabled && (
          <div>
            <label htmlFor="digest-timezone" className="block text-sm font-medium mb-1.5 text-foreground">
              Digest timezone
            </label>
            <select
              id="digest-timezone"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={digestTimezone}
              onChange={(e) => setDigestTimezone(e.target.value)}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
              {!COMMON_TIMEZONES.includes(digestTimezone) && (
                <option value={digestTimezone}>{digestTimezone.replace(/_/g, ' ')}</option>
              )}
            </select>
          </div>
        )}
      </div>

      {lastCheck && (
        <p className={`text-sm ${lastCheck.ok === false ? 'text-danger' : 'text-muted-foreground'}`}>
          Last SMTP check: {lastCheck.ok === false ? 'failed' : 'ok'}
          {lastCheck.at ? ` at ${new Date(lastCheck.at).toLocaleString()}` : ''}
          {lastCheck.message ? ` — ${lastCheck.message}` : ''}
        </p>
      )}

      {showDigestStatus && (
        <div className="space-y-0.5">
          {digestLines.map((l) => (
            <p key={l.orgId} className="text-sm text-muted-foreground">
              {digestLines.length > 1 ? `${l.orgId}: ` : ''}
              {l.text}
            </p>
          ))}
        </div>
      )}

      {testResult && (
        <Alert variant={testResult.fully_accepted ? 'success' : 'destructive'}>
          <div className="space-y-0.5">
            <p>Accepted: {testResult.accepted.join(', ') || 'none'}</p>
            <p>Rejected: {testResult.rejected.join(', ') || 'none'}</p>
          </div>
        </Alert>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleTest} disabled={testing || !smtpConfigured}>
          {testing ? (
            <>
              <Spinner size="sm" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Send test notice
            </>
          )}
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Spinner size="sm" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </div>
    </div>
  );
}
