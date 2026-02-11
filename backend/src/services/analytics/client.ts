// Shared Elasticsearch client factory — single source of truth for building
// an ES Client from AnalyticsSettings.

import { Client } from '@elastic/elasticsearch';
import type { AnalyticsSettings } from '../../types/analytics.js';

/** Create an ES Client from analytics settings. */
export function createEsClient(settings: AnalyticsSettings): Client {
  if (settings.connectionType === 'cloud' && settings.cloudId) {
    return new Client({
      cloud: { id: settings.cloudId },
      auth: { apiKey: settings.apiKey || '' },
    });
  }

  if (settings.node) {
    const auth = settings.apiKey
      ? { apiKey: settings.apiKey }
      : { username: settings.username || '', password: settings.password || '' };

    return new Client({ node: settings.node, auth });
  }

  throw new Error('Invalid Elasticsearch configuration');
}
