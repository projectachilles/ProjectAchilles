/**
 * AI model provider factory.
 *
 * Supports Anthropic, OpenAI, and Ollama (via OpenAI-compatible API).
 * Creates proper provider instances with API keys — plain model strings
 * only work with the AI Gateway (OIDC), not direct provider usage.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { loadConfig } from '../config/store.js';
import type { LanguageModelV1 } from 'ai';

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  ollama: 'llama3',
};

export function getConfiguredModel(): LanguageModelV1 {
  const config = loadConfig();
  const ai = config.ai;

  const provider = ai?.provider ?? 'anthropic';
  const modelId = ai?.model || DEFAULT_MODEL[provider] || 'claude-sonnet-4-6';
  const apiKey = ai?.api_key ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;

  if (provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: apiKey ?? '',
    });
    return anthropic(modelId);
  }

  if (provider === 'openai' || provider === 'ollama') {
    const openai = createOpenAI({
      apiKey: apiKey ?? '',
      ...(ai?.base_url ? { baseURL: ai.base_url } : {}),
    });
    return openai(modelId);
  }

  // Fallback: try Anthropic
  const anthropic = createAnthropic({ apiKey: apiKey ?? '' });
  return anthropic(modelId);
}
