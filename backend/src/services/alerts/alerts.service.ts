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

  // ── Agent Alerts ──────────────────────────────────────────────

  /**
   * Evaluate agent-specific alert thresholds: offline duration, flapping,
   * and fleet online percentage. Called from the detectOfflineAgents
   * background loop (every 60s). Uses a separate cooldown from test alerts.
   */
  async evaluateAgentAlerts(): Promise<void> {
    const integrationsSettings = new IntegrationsSettingsService();
    if (!integrationsSettings.isAlertingConfigured()) return;

    const alertSettings = integrationsSettings.getAlertSettings();
    const agentAlerts = alertSettings?.agent_alerts;
    if (!agentAlerts?.enabled) return;

    // Separate cooldown for agent alerts
    const cooldown = agentAlerts.cooldown_minutes ?? 30;
    if (agentAlerts.last_alert_at) {
      const elapsed = Date.now() - new Date(agentAlerts.last_alert_at).getTime();
      if (elapsed < cooldown * 60_000) return;
    }

    // Lazy import to avoid circular dependency at module level
    const { getDatabase } = await import('../agent/database.js');
    const db = getDatabase();

    const breaches: MetricStatus[] = [];

    // 1. Check offline duration per agent
    if (agentAlerts.offline_hours_threshold) {
      const thresholdSeconds = agentAlerts.offline_hours_threshold * 3600;
      const offlineAgents = db.prepare(`
        SELECT a.hostname FROM agents a
        WHERE a.status = 'active'
          AND a.last_heartbeat IS NOT NULL
          AND (julianday('now') - julianday(a.last_heartbeat)) * 86400.0 > ?
      `).all(thresholdSeconds) as { hostname: string }[];

      if (offlineAgents.length > 0) {
        const names = offlineAgents.slice(0, 5).map(a => a.hostname).join(', ');
        breaches.push({
          metric: `Agent Offline >${agentAlerts.offline_hours_threshold}h`,
          current: offlineAgents.length,
          threshold: 0,
          unit: ` agent(s): ${names}${offlineAgents.length > 5 ? '...' : ''}`,
          direction: 'above',
        });
      }
    }

    // 2. Check flapping (reconnect frequency)
    if (agentAlerts.flapping_threshold) {
      const flapping = db.prepare(`
        SELECT a.hostname, COUNT(*) as reconnects
        FROM agent_events e
        INNER JOIN agents a ON e.agent_id = a.id
        WHERE e.event_type = 'came_online'
          AND e.created_at > datetime('now', '-1 day')
          AND a.status = 'active'
        GROUP BY e.agent_id
        HAVING COUNT(*) > ?
      `).all(agentAlerts.flapping_threshold) as { hostname: string; reconnects: number }[];

      if (flapping.length > 0) {
        const names = flapping.slice(0, 5).map(f => `${f.hostname}(${f.reconnects}x)`).join(', ');
        breaches.push({
          metric: 'Agent Flapping',
          current: flapping.length,
          threshold: agentAlerts.flapping_threshold,
          unit: ` agent(s): ${names}${flapping.length > 5 ? '...' : ''}`,
          direction: 'above',
        });
      }
    }

    // 3. Check fleet online percentage
    if (agentAlerts.fleet_online_percent_min != null) {
      const totalRow = db.prepare(
        `SELECT COUNT(*) as count FROM agents WHERE status = 'active'`
      ).get() as { count: number };

      const cutoff = new Date(Date.now() - 180_000).toISOString(); // 180s = heartbeat timeout
      const onlineRow = db.prepare(
        `SELECT COUNT(*) as count FROM agents WHERE status = 'active' AND last_heartbeat > ?`
      ).get(cutoff) as { count: number };

      const onlinePercent = totalRow.count > 0
        ? Math.round((onlineRow.count / totalRow.count) * 100) : 100;

      if (onlinePercent < agentAlerts.fleet_online_percent_min) {
        breaches.push({
          metric: 'Fleet Online',
          current: onlinePercent,
          threshold: agentAlerts.fleet_online_percent_min,
          unit: '%',
          direction: 'below',
        });
      }
    }

    if (breaches.length === 0) return;

    // Dispatch to channels
    const dashboardUrl =
      (process.env.CORS_ORIGIN || 'http://localhost:5173') + '/endpoints/agents';

    const alertData = {
      breaches,
      passing: [] as MetricStatus[],
      triggerTest: 'agent-monitor',
      triggerAgent: 'system',
      dashboardUrl,
    };

    let slackSent = false;
    let emailSent = false;

    if (alertSettings?.slack?.configured && alertSettings.slack.enabled) {
      try {
        await sendSlackAlert(alertSettings.slack.webhook_url, alertData);
        slackSent = true;
      } catch (err) {
        console.error('[Agent Alerts] Slack dispatch failed:', err);
      }
    }

    if (alertSettings?.email?.configured && alertSettings.email.enabled) {
      try {
        const subject = `[ProjectAchilles] Agent Alert: ${breaches.map(b => b.metric).join(', ')}`;
        const html = buildAlertEmailHtml(alertData);
        await sendEmailAlert(alertSettings.email, { subject, html });
        emailSent = true;
      } catch (err) {
        console.error('[Agent Alerts] Email dispatch failed:', err);
      }
    }

    // Update agent-specific cooldown timestamp
    integrationsSettings.saveAlertSettings({
      agent_alerts: {
        ...agentAlerts,
        last_alert_at: new Date().toISOString(),
      },
    });

    // Record in history
    this.history.unshift({
      timestamp: new Date().toISOString(),
      breaches,
      channels: { slack: slackSent, email: emailSent },
      triggerTest: 'agent-monitor',
      triggerAgent: 'system',
    });
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }

    console.log(`[Agent Alerts] ${breaches.length} breach(es) dispatched`);
  }

  /** Return the in-memory alert history (most recent first). */
  getAlertHistory(): AlertHistoryEntry[] {
    return this.history;
  }
}
