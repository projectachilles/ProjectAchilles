// Shared Elasticsearch client factory — single source of truth for building
// an ES Client from AnalyticsSettings.

import { Client } from '@elastic/elasticsearch';
import type { ClientOptions } from '@elastic/elasticsearch';
import type { AnalyticsSettings } from '../../types/analytics.js';

let insecureWarningEmitted = false;

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

    const opts: ClientOptions = { node: settings.node, auth };

    const tls = buildTlsOptions(settings);
    if (tls) opts.tls = tls;

    return new Client(opts);
  }

  throw new Error('Invalid Elasticsearch configuration');
}

// Build the TLS options object for direct connections, or undefined when no
// TLS overrides are configured. The Elasticsearch v8 client forwards this
// straight to the underlying undici/Node tls stack.
function buildTlsOptions(
  settings: AnalyticsSettings
): { ca?: string; rejectUnauthorized?: boolean } | undefined {
  const tls: { ca?: string; rejectUnauthorized?: boolean } = {};

  if (settings.caCert && settings.caCert.trim()) {
    tls.ca = settings.caCert;
  }

  if (settings.tlsInsecureSkipVerify) {
    tls.rejectUnauthorized = false;
    if (!insecureWarningEmitted) {
      console.warn(
        '[analytics] TLS certificate validation is DISABLED for the Elasticsearch ' +
          'connection (tlsInsecureSkipVerify=true). This is intended for local/lab ' +
          'use only — production deployments should provide a custom CA instead.'
      );
      insecureWarningEmitted = true;
    }
  }

  return Object.keys(tls).length > 0 ? tls : undefined;
}

// Test-only: reset the one-shot warning flag so unit tests can reassert it.
export function _resetInsecureWarningForTests(): void {
  insecureWarningEmitted = false;
}
