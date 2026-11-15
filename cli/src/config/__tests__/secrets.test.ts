import { describe, it, expect } from 'vitest';
import { HIDDEN, isSecretKey, redactSecrets } from '../secrets.js';

describe('isSecretKey', () => {
  it.each(['ai.api_key', 'api_key', 'ai.apikey', 'provider.token', 'smtp.password', 'x.client_secret'])(
    'treats %s as a secret', (key) => expect(isSecretKey(key)).toBe(true));

  it.each(['ai.provider', 'ai.model', 'server_url', 'defaults.page_size', 'active_profile', 'ai.base_url'])(
    'treats %s as ordinary', (key) => expect(isSecretKey(key)).toBe(false));
});

describe('redactSecrets', () => {
  it('hides the AI provider key anywhere in the config and keeps the rest', () => {
    const config = {
      active_profile: 'default',
      profiles: { default: { server_url: 'https://console.example.com' } },
      ai: { provider: 'anthropic', model: 'some-model', api_key: 'sk-placeholder-value' },
      defaults: { output: 'pretty', page_size: 50 },
    };
    const shown = redactSecrets(config) as typeof config;

    expect(JSON.stringify(shown)).not.toContain('sk-placeholder-value');
    expect(shown.ai.api_key).toBe(HIDDEN);
    expect(shown.ai.provider).toBe('anthropic');
    expect(shown.profiles.default.server_url).toBe('https://console.example.com');
    // The stored config is not changed.
    expect(config.ai.api_key).toBe('sk-placeholder-value');
  });

  it('hides a secret fetched on its own (config get ai.api_key)', () => {
    expect(redactSecrets('sk-placeholder-value', 'ai.api_key')).toBe(HIDDEN);
    expect(redactSecrets('anthropic', 'ai.provider')).toBe('anthropic');
  });

  it('hides the key inside a fetched section (config get ai)', () => {
    expect(redactSecrets({ provider: 'openai', api_key: 'sk-placeholder-value' }, 'ai'))
      .toEqual({ provider: 'openai', api_key: HIDDEN });
  });

  it('does not claim an unset secret is set', () => {
    expect(redactSecrets({ api_key: '' })).toEqual({ api_key: '' });
    expect(redactSecrets({ api_key: undefined })).toEqual({ api_key: undefined });
  });
});
