import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { NoticeSummary } from '@/types/agent';

export type { NoticeSummary };

export interface NoticeSettings {
  enabled: boolean;
  recipients: string[];
  lead_minutes: number;
  max_wait_minutes: number;
  pickup_window_minutes: number;
  send_finished: boolean;
  advance_digest_enabled: boolean;
  digest_timezone: string;
  last_smtp_check_at?: string;
  last_smtp_check_ok?: boolean;
  last_smtp_check_message?: string;
}

export interface NoticeSettingsResponse extends NoticeSettings {
  smtp_configured: boolean;
}

export interface NoticeTestResult {
  accepted: string[];
  rejected: string[];
  fully_accepted: boolean;
}

export interface NoticeDigestStatus {
  orgId: string;
  digestDate: string;
  runDate: string;
  state: 'sending' | 'sent' | 'failed' | 'empty';
  occurrenceCount: number;
  hostCount: number;
  recipientCount: number;
  sentAt: string | null;
  lastError: string | null;
}

export interface NoticeStatus {
  pendingOverdue: number;
  notDeliveredLast7d: number;
  smtpCheck: { ok: boolean | null; at: string | null; message: string | null };
  digests: NoticeDigestStatus[];
}

/** A notice from GET /notices, with its run tag and number of held (pending) tasks. */
export interface NoticeListItem {
  id: string;
  run_tag: string;
  state: 'pending' | 'sent' | 'not_delivered' | 'overridden' | 'skipped';
  kind: 'run' | 'day';
  source_type: 'run_now' | 'schedule' | 'manual_retry';
  created_at: string;
  attempts: number;
  last_error: string | null;
  held_tasks: number;
}

export const noticesApi = {
  async getSettings(): Promise<NoticeSettingsResponse> {
    const response = await apiClient.get('/notices/settings');
    return response.data.data;
  },

  /** Partial update: omitted fields keep their saved value. */
  async saveSettings(settings: Partial<NoticeSettings>): Promise<NoticeSettingsResponse> {
    const response = await apiClient.put('/notices/settings', settings);
    return response.data.data;
  },

  async sendTest(): Promise<NoticeTestResult> {
    const response = await apiClient.post('/notices/settings/test');
    return response.data.data;
  },

  async getStatus(): Promise<NoticeStatus> {
    const response = await apiClient.get('/notices/status');
    return response.data.data;
  },

  /** Notices still waiting to be sent (their tests are held). */
  async listPending(): Promise<NoticeListItem[]> {
    const response = await apiClient.get('/notices', { params: { state: 'pending', limit: 100 } });
    return response.data.data;
  },

  /** Let a held run start without its notice. The reason is recorded on the notice. */
  async release(id: string, reason: string): Promise<void> {
    await apiClient.post(`/notices/${encodeURIComponent(id)}/release`, { reason });
  },
};
