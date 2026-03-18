import { client } from './client.js';
import type { IntegrationConfig, AlertConfig } from './types.js';

// ─── Azure / Defender Credentials ───────────────────────────────────────────

export async function getAzureConfig(): Promise<IntegrationConfig> {
  return client.get('/api/integrations/azure');
}

export async function setAzureConfig(params: {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  label?: string;
}): Promise<void> {
  await client.post('/api/integrations/azure', { body: params });
}

export async function deleteAzureConfig(): Promise<void> {
  await client.delete('/api/integrations/azure');
}

export async function testAzureConnection(params?: {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
}): Promise<{ success: boolean; error?: string; message?: string }> {
  return client.post('/api/integrations/azure/test', { body: params });
}

export async function getDefenderConfig(): Promise<IntegrationConfig> {
  return client.get('/api/integrations/defender');
}

export async function setDefenderConfig(params: {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  label?: string;
}): Promise<void> {
  await client.post('/api/integrations/defender', { body: params });
}

export async function deleteDefenderConfig(): Promise<void> {
  await client.delete('/api/integrations/defender');
}

export async function testDefenderConnection(params?: {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
}): Promise<{ success: boolean; error?: string; message?: string }> {
  return client.post('/api/integrations/defender/test', { body: params });
}

export async function triggerDefenderSync(): Promise<{ success: boolean; data: unknown }> {
  return client.post('/api/integrations/defender/sync');
}

export async function getDefenderSyncStatus(): Promise<{
  last_sync_scores?: string;
  last_sync_alerts?: string;
  last_sync_controls?: string;
  counts?: Record<string, number>;
}> {
  return client.get('/api/integrations/defender/sync/status');
}

// ─── Alerting ───────────────────────────────────────────────────────────────

export async function getAlertConfig(): Promise<AlertConfig> {
  return client.get('/api/integrations/alerts');
}

export async function setAlertConfig(params: {
  thresholds?: { score_drop_percent?: number; score_floor?: number };
  cooldown_minutes?: number;
  slack?: { webhook_url?: string; channel?: string };
  email?: { smtp_host?: string; from?: string; to?: string[] };
}): Promise<void> {
  await client.post('/api/integrations/alerts', { body: params });
}

export async function testAlert(params?: {
  slack_webhook_url?: string;
  email?: { smtp_host?: string; from?: string; to?: string[] };
}): Promise<{ success: boolean; data?: { slack?: unknown; email?: unknown } }> {
  return client.post('/api/integrations/alerts/test', { body: params });
}

export async function getAlertHistory(): Promise<Array<{ type: string; severity: string; message: string; created_at: string }>> {
  return client.get('/api/integrations/alerts/history');
}
