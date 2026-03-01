import { apiClient } from '@/hooks/useAuthenticatedApi';

// --- Response types ---

export interface AlertSettingsMasked {
  configured: boolean;
  thresholds?: {
    defense_score_min?: number;
    error_rate_max?: number;
    secure_score_min?: number;
    enabled: boolean;
  };
  cooldown_minutes?: number;
  last_alert_at?: string;
  slack?: {
    configured: boolean;
    enabled: boolean;
    webhook_url_set: boolean;
  };
  email?: {
    configured: boolean;
    enabled: boolean;
    smtp_host?: string;
    smtp_port?: number;
    smtp_secure?: boolean;
    smtp_user?: string;       // masked (****xxxx)
    from_address?: string;
    recipients?: string[];
  };
}

export interface SaveAlertSettingsRequest {
  thresholds?: {
    defense_score_min?: number;
    error_rate_max?: number;
    secure_score_min?: number;
    enabled?: boolean;
  };
  cooldown_minutes?: number;
  slack?: {
    webhook_url?: string;
    configured?: boolean;
    enabled?: boolean;
  };
  email?: {
    smtp_host?: string;
    smtp_port?: number;
    smtp_secure?: boolean;
    smtp_user?: string;
    smtp_pass?: string;
    from_address?: string;
    recipients?: string[];
    configured?: boolean;
    enabled?: boolean;
  };
}

export interface TestAlertResult {
  success: boolean;
  data: {
    slack?: { success: boolean; message: string };
    email?: { success: boolean; message: string };
  };
}

export interface AlertHistoryItem {
  timestamp: string;
  breaches: Array<{
    metric: string;
    current: number;
    threshold: number;
    unit: string;
    direction: 'below' | 'above';
  }>;
  channels: { slack: boolean; email: boolean };
  triggerTest: string;
  triggerAgent: string;
}

// --- API client ---

export const alertsApi = {
  async getAlertSettings(): Promise<AlertSettingsMasked> {
    try {
      const response = await apiClient.get('/integrations/alerts');
      return response.data;
    } catch {
      return { configured: false };
    }
  },

  async saveAlertSettings(settings: SaveAlertSettingsRequest): Promise<{ success: boolean }> {
    const response = await apiClient.post('/integrations/alerts', settings);
    return response.data;
  },

  async testAlertChannels(params?: {
    slack_webhook_url?: string;
    email?: SaveAlertSettingsRequest['email'];
  }): Promise<TestAlertResult> {
    const response = await apiClient.post('/integrations/alerts/test', params ?? {});
    return response.data;
  },

  async getAlertHistory(): Promise<AlertHistoryItem[]> {
    try {
      const response = await apiClient.get('/integrations/alerts/history');
      return response.data.data ?? [];
    } catch {
      return [];
    }
  },
};
