// Core alerting service — evaluates thresholds, enforces cooldown, dispatches
// to configured channels (Slack, email).  History is kept in-memory (ring buffer).

import { IntegrationsSettingsService } from '../integrations/settings.js';
import { SettingsService } from '../analytics/settings.js';
import { ElasticsearchService } from '../analytics/elasticsearch.js';
import { DefenderAnalyticsService } from '../defender/analytics.service.js';
import { sendSlackAlert } from './slack.service.js';
import { sendEmailAlert, buildAlertEmailHtml } from './email.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricStatus {
  metric: string;
  current: number;
  threshold: number;
  unit: string;
  direction: 'below' | 'above';
}

export interface AlertHistoryEntry {
  timestamp: string;
  breaches: MetricStatus[];
  channels: { slack: boolean; email: boolean };
  triggerTest: string;
  triggerAgent: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AlertsService {
  private history: AlertHistoryEntry[] = [];

  // ── Public API ──────────────────────────────────────────────

  /**
   * Evaluate configured thresholds against current metric values and dispatch
   * alerts to enabled channels when any metric breaches its threshold.
   */
  async evaluateAndNotify(triggerTest: string, triggerAgent: string): Promise<void> {
    // 1. Check alerting is configured
    const integrationsSettings = new IntegrationsSettingsService();
    if (!integrationsSettings.isAlertingConfigured()) return;

    // 2. Get alert settings — bail if thresholds disabled
    const alertSettings = integrationsSettings.getAlertSettings();
    if (!alertSettings?.thresholds?.enabled) return;

    // 3. Cooldown check
    if (alertSettings.last_alert_at) {
      const elapsed = Date.now() - new Date(alertSettings.last_alert_at).getTime();
      if (elapsed < alertSettings.cooldown_minutes * 60_000) return;
    }

    // 4. Verify Elasticsearch is configured
    const analyticsSettings = new SettingsService();
    if (!analyticsSettings.isConfigured()) return;

    const esSettings = analyticsSettings.getSettings();
    const esService = new ElasticsearchService(esSettings);

    const breaches: MetricStatus[] = [];
    const passing: MetricStatus[] = [];

    // 5. Defense Score
    if (alertSettings.thresholds.defense_score_min != null) {
      const result = await esService.getDefenseScore({});
      const current = result.score;
      const threshold = alertSettings.thresholds.defense_score_min;
      const status: MetricStatus = {
        metric: 'Defense Score',
        current,
        threshold,
        unit: '%',
        direction: 'below',
      };
      if (current < threshold) {
        breaches.push(status);
      } else {
        passing.push(status);
      }
    }

    // 6. Error Rate
    if (alertSettings.thresholds.error_rate_max != null) {
      const result = await esService.getErrorRate({});
      const current = result.errorRate;
      const threshold = alertSettings.thresholds.error_rate_max;
      const status: MetricStatus = {
        metric: 'Error Rate',
        current,
        threshold,
        unit: '%',
        direction: 'above',
      };
      if (current > threshold) {
        breaches.push(status);
      } else {
        passing.push(status);
      }
    }

    // 7. Secure Score (Defender)
    if (
      alertSettings.thresholds.secure_score_min != null &&
      integrationsSettings.isDefenderConfigured()
    ) {
      try {
        const defenderService = new DefenderAnalyticsService();
        const result = await defenderService.getCurrentSecureScore();
        const current = result.percentage;
        const threshold = alertSettings.thresholds.secure_score_min;
        const status: MetricStatus = {
          metric: 'Secure Score',
          current,
          threshold,
          unit: '%',
          direction: 'below',
        };
        if (current < threshold) {
          breaches.push(status);
        } else {
          passing.push(status);
        }
      } catch {
        // Defender query failure should not block alerting
      }
    }

    // 8. No breaches — nothing to alert
    if (breaches.length === 0) return;

    // 9. Build alert payload
    const dashboardUrl =
      (process.env.CORS_ORIGIN || 'http://localhost:5173') + '/analytics';

    const alertData = {
      breaches,
      passing,
      triggerTest,
      triggerAgent,
      dashboardUrl,
    };

    let slackSent = false;
    let emailSent = false;

    // 10. Dispatch to Slack
    if (alertSettings.slack?.configured && alertSettings.slack?.enabled) {
      try {
        await sendSlackAlert(alertSettings.slack.webhook_url, alertData);
        slackSent = true;
      } catch (err) {
        console.error('Slack alert dispatch failed:', err);
      }
    }

    // 11. Dispatch to Email
    if (alertSettings.email?.configured && alertSettings.email?.enabled) {
      try {
        const firstBreach = breaches[0];
        const subject = `[ProjectAchilles] Alert: ${firstBreach.metric} ${firstBreach.direction} ${firstBreach.threshold}${firstBreach.unit}`;
        const html = buildAlertEmailHtml(alertData);
        await sendEmailAlert(alertSettings.email, { subject, html });
        emailSent = true;
      } catch (err) {
        console.error('Email alert dispatch failed:', err);
      }
    }

    // 12. Update last_alert_at
    integrationsSettings.saveAlertSettings({
      last_alert_at: new Date().toISOString(),
    });

    // 13. Record history
    this.history.unshift({
      timestamp: new Date().toISOString(),
      breaches,
      channels: { slack: slackSent, email: emailSent },
      triggerTest,
      triggerAgent,
    });
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }
  }

  /** Return the in-memory alert history (most recent first). */
  getAlertHistory(): AlertHistoryEntry[] {
    return this.history;
  }
}
