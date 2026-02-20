import { describe, it, expect, vi } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';

// ── Mock setup ──────────────────────────────────────────────────────

const MockClient = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: MockClient,
}));

const { createEsClient } = await import('../client.js');

// ── Helpers ──────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<AnalyticsSettings> = {}): AnalyticsSettings {
  return {
    connectionType: 'direct',
    node: 'http://localhost:9200',
    apiKey: 'test-key',
    indexPattern: 'f0rtika-*',
    configured: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('createEsClient', () => {
  it('creates cloud client when connectionType is cloud with cloudId', () => {
    const settings = makeSettings({
      connectionType: 'cloud',
      cloudId: 'my-cloud:base64data',
      apiKey: 'cloud-api-key',
    });

    createEsClient(settings);

    expect(MockClient).toHaveBeenCalledWith({
      cloud: { id: 'my-cloud:base64data' },
      auth: { apiKey: 'cloud-api-key' },
    });
  });

  it('creates direct client with apiKey auth when apiKey is set', () => {
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'https://es.example.com:9200',
      apiKey: 'my-api-key',
    });

    createEsClient(settings);

    expect(MockClient).toHaveBeenCalledWith({
      node: 'https://es.example.com:9200',
      auth: { apiKey: 'my-api-key' },
    });
  });

  it('creates direct client with basic auth when no apiKey', () => {
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'http://localhost:9200',
      apiKey: undefined,
      username: 'elastic',
      password: 'changeme',
    });

    createEsClient(settings);

    expect(MockClient).toHaveBeenCalledWith({
      node: 'http://localhost:9200',
      auth: { username: 'elastic', password: 'changeme' },
    });
  });

  it('defaults to empty strings for missing username/password', () => {
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'http://localhost:9200',
      apiKey: undefined,
      username: undefined,
      password: undefined,
    });

    createEsClient(settings);

    expect(MockClient).toHaveBeenCalledWith({
      node: 'http://localhost:9200',
      auth: { username: '', password: '' },
    });
  });

  it('throws for invalid configuration (no cloud, no node)', () => {
    const settings = makeSettings({
      connectionType: 'direct',
      node: undefined,
      cloudId: undefined,
    });

    expect(() => createEsClient(settings)).toThrow('Invalid Elasticsearch configuration');
  });
});
