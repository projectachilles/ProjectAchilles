import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';

// ── Mock setup ──────────────────────────────────────────────────────

const MockClient = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: MockClient,
}));

const { createEsClient, _resetInsecureWarningForTests } = await import('../client.js');

beforeEach(() => {
  MockClient.mockClear();
  _resetInsecureWarningForTests();
  vi.restoreAllMocks();
});

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

  // ── TLS / self-signed cert support ─────────────────────────────────

  it('omits the tls option when no caCert and no tlsInsecureSkipVerify are set', () => {
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'https://es.example.com:9200',
      apiKey: 'k',
    });

    createEsClient(settings);

    const args = MockClient.mock.calls[0][0];
    expect(args).not.toHaveProperty('tls');
  });

  it('passes caCert through as tls.ca when set on a direct connection', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIDazCC...\n-----END CERTIFICATE-----';
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'https://es.lab.local:9200',
      apiKey: 'k',
      caCert: pem,
    });

    createEsClient(settings);

    expect(MockClient).toHaveBeenCalledWith({
      node: 'https://es.lab.local:9200',
      auth: { apiKey: 'k' },
      tls: { ca: pem },
    });
  });

  it('treats whitespace-only caCert as unset', () => {
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'https://es.example.com:9200',
      apiKey: 'k',
      caCert: '   \n\t  ',
    });

    createEsClient(settings);

    const args = MockClient.mock.calls[0][0];
    expect(args).not.toHaveProperty('tls');
  });

  it('sets tls.rejectUnauthorized=false when tlsInsecureSkipVerify is true', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'https://es.lab.local:9200',
      apiKey: 'k',
      tlsInsecureSkipVerify: true,
    });

    createEsClient(settings);

    expect(MockClient).toHaveBeenCalledWith({
      node: 'https://es.lab.local:9200',
      auth: { apiKey: 'k' },
      tls: { rejectUnauthorized: false },
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/TLS certificate validation is DISABLED/);
    warnSpy.mockRestore();
  });

  it('combines caCert and tlsInsecureSkipVerify when both are set', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'https://es.lab.local:9200',
      apiKey: 'k',
      caCert: pem,
      tlsInsecureSkipVerify: true,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    createEsClient(settings);

    expect(MockClient).toHaveBeenCalledWith({
      node: 'https://es.lab.local:9200',
      auth: { apiKey: 'k' },
      tls: { ca: pem, rejectUnauthorized: false },
    });
  });

  it('does not pass tls option to the cloud branch even when caCert/insecure are set', () => {
    const settings = makeSettings({
      connectionType: 'cloud',
      cloudId: 'my-cloud:base64',
      apiKey: 'k',
      caCert: '-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----',
      tlsInsecureSkipVerify: true,
    });

    createEsClient(settings);

    expect(MockClient).toHaveBeenCalledWith({
      cloud: { id: 'my-cloud:base64' },
      auth: { apiKey: 'k' },
    });
  });

  it('emits the insecure warning only once per process', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const settings = makeSettings({
      connectionType: 'direct',
      node: 'https://es.lab.local:9200',
      apiKey: 'k',
      tlsInsecureSkipVerify: true,
    });

    createEsClient(settings);
    createEsClient(settings);
    createEsClient(settings);

    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
