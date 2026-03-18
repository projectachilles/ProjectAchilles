/**
 * AI model provider factory.
 *
 * Supports Anthropic, OpenAI, and Ollama (via OpenAI-compatible API).
 * Reads configuration from ~/.achilles/config.json.
 */

import { loadConfig } from '../config/store.js';

export function getConfiguredModel(): string {
  const config = loadConfig();
  const ai = config.ai;

  if (!ai) {
    // Default to Anthropic
    return 'anthropic:claude-sonnet-4-6';
  }

  if (ai.provider === 'ollama') {
    // Ollama uses OpenAI-compatible API
    return `openai:${ai.model}`;
  }

  return `${ai.provider}:${ai.model}`;
}

export function getProviderConfig(): Record<string, unknown> {
  const config = loadConfig();
  const ai = config.ai;

  if (!ai) return {};

  const providerConfig: Record<string, unknown> = {};

  if (ai.api_key) {
    if (ai.provider === 'anthropic') {
      providerConfig.anthropic = { apiKey: ai.api_key };
    } else if (ai.provider === 'openai' || ai.provider === 'ollama') {
      providerConfig.openai = {
        apiKey: ai.api_key,
        ...(ai.base_url ? { baseURL: ai.base_url } : {}),
      };
    }
  }

  if (ai.provider === 'ollama' && ai.base_url) {
    providerConfig.openai = {
      ...(providerConfig.openai as Record<string, unknown> ?? {}),
      baseURL: ai.base_url,
    };
  }

  return providerConfig;
}
