// Core alerting service — evaluates thresholds, enforces cooldown, dispatches
// to configured channels (Slack, email).  History is kept in-memory (ring buffer).

import { createHash } from 'node:crypto';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { SettingsService } from '../analytics/settings.js';
import { ElasticsearchService } from '../analytics/elasticsearch.js';
import { DefenderAnalyticsService } from '../defender/analytics.service.js';
import { SentinelOnePostureService } from '../sentinelone/posture.service.js';
import { createEsClient } from '../analytics/client.js';
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
  /** What the number is based on, printed next to it in the alert. */
  detail?: string;
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

/**
 * The Defense Score the alert compares to its threshold: the dashboard
 * tile's rule (latest conclusive result per test and host, a multi-stage test
 * protected if any stage is), over a fixed window, because the tile's own
 * range is whatever the viewer picked.
 */
const DEFENSE_SCORE_WINDOW_DAYS = 30;
/**
 * How long after a result the trailing evaluation runs: past the posture
 * snapshot's 30 s lifetime, with room for the fetch itself.
 */
const TRAILING_EVALUATION_MS = 35_000;
const DEFENSE_SCORE_DETAIL = `latest result per test and host, last ${DEFENSE_SCORE_WINDOW_DAYS} days`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AlertsService {
  private history: AlertHistoryEntry[] = [];
  /**
   * Kept between evaluations: an evaluation runs on every task result, and the
   * service's short-lived posture cache then answers a burst of results (a
   * campaign finishing on many hosts) from one fetch. Rebuilt when the
   * analytics settings change.
   */
  private es: { key: string; service: ElasticsearchService } | null = null;
  private trailing: ReturnType<typeof setTimeout> | null = null;

  private esFor(settings: ConstructorParameters<typeof ElasticsearchService>[0]): ElasticsearchService {
    // A digest, so the connection secrets are not kept in a second plain copy.
    const key = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    if (this.es?.key !== key) this.es = { key, service: new ElasticsearchService(settings) };
    return this.es.service;
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Evaluate configured thresholds against current metric values and dispatch
   * alerts to enabled channels when any metric breaches its threshold.
   */
  async evaluateAndNotify(triggerTest: string, triggerAgent: string): Promise<void> {
    if (await this.evaluate(triggerTest, triggerAgent)) this.scheduleTrailing(triggerTest, triggerAgent);
  }

  /**
   * One more evaluation after the last result of a burst. The Defense Score
   * comes from a snapshot cached for about 30 s, so an evaluation can be
   * answered from before the result that triggered it; without this, the last
   * results of a burst would not be evaluated until some later result arrived.
   * Each new result pushes the trailing evaluation back, so a burst gets one.
   */
  private scheduleTrailing(triggerTest: string, triggerAgent: string): void {
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = setTimeout(() => {
      this.trailing = null;
      this.evaluate(triggerTest, triggerAgent).catch((err) => {
        console.error('[Alerts] Trailing evaluation failed:', err instanceof Error ? err.message : err);
      });
    }, TRAILING_EVALUATION_MS);
    // Never keep the process alive for an alert check.
    this.trailing.unref?.();
  }

  /** Returns false when nothing was evaluated (alerting off, in cooldown, Elasticsearch not configured). */
  private async evaluate(triggerTest: string, triggerAgent: string): Promise<boolean> {
    // 1. Check alerting is configured
    const integrationsSettings = new IntegrationsSettingsService();
    if (!integrationsSettings.isAlertingConfigured()) return false;

    // 2. Get alert settings — bail if thresholds disabled
    const alertSettings = integrationsSettings.getAlertSettings();
    if (!alertSettings?.thresholds?.enabled) return false;

    // 3. Cooldown check
    if (alertSettings.last_alert_at) {
      const elapsed = Date.now() - new Date(alertSettings.last_alert_at).getTime();
      if (elapsed < alertSettings.cooldown_minutes * 60_000) return false;
    }

    // 4. Verify Elasticsearch is configured
    const analyticsSettings = new SettingsService();
    if (!analyticsSettings.isConfigured()) return false;

    const esSettings = analyticsSettings.getSettings();
    const esService = this.esFor(esSettings);

    const breaches: MetricStatus[] = [];
    const passing: MetricStatus[] = [];

    // 5. Defense Score (latest-result basis). No pair with a conclusive
    // result means there is no score: the check is skipped, never read as 0%.
    if (alertSettings.thresholds.defense_score_min != null) {
      const { score } = await esService.getLatestScoreSummary({
        from: `now-${DEFENSE_SCORE_WINDOW_DAYS}d`,
        scoringMode: 'any-stage',
      });
      if (score !== null) {
        const threshold = alertSettings.thresholds.defense_score_min;
        const status: MetricStatus = {
          metric: 'Defense Score',
          current: score,
          threshold,
          unit: '%',
          direction: 'below',
          detail: DEFENSE_SCORE_DETAIL,
        };
        if (score < threshold) {
          breaches.push(status);
        } else {
          passing.push(status);
        }
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
    // NOTE: Defender-only in v1 — CrowdStrike ZTA score thresholds are out of
    // scope here (see the crowdstrike integration plan, Phase 2 item 19).
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

    // 7b. SentinelOne agent health (latest posture snapshot of /agents/count).
    // Counts, not a score: alert when infected / detect-only / outdated agents exceed the max.
    const t = alertSettings.thresholds;
    const s1Checks: Array<[number | undefined, 'infected' | 'detect_only' | 'outdated', string]> = [
      [t.s1_infected_agents_max, 'infected', 'SentinelOne infected agents'],
      [t.s1_detect_only_agents_max, 'detect_only', 'SentinelOne detect-only agents'],
      [t.s1_outdated_agents_max, 'outdated', 'SentinelOne outdated agents'],
    ];
    if (s1Checks.some(([max]) => max != null) && new IntegrationsSettingsService().isSentinelOneConfigured()) {
      try {
        const counts = await new SentinelOnePostureService(createEsClient(esSettings), {} as never).getLatestAgentHealth();
        for (const [max, key, metric] of s1Checks) {
          const current = counts?.[key];
          if (max == null || current == null) continue;
          const status: MetricStatus = { metric, current, threshold: max, unit: ' agents', direction: 'above' };
          if (current > max) breaches.push(status);
          else passing.push(status);
        }
      } catch {
        // SentinelOne query failure should not block alerting
      }
    }

    // 8. No breaches — nothing to alert
    if (breaches.length === 0) return true;

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
    return true;
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
