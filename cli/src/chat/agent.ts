/**
 * AI chat agent setup using AI SDK v6 ToolLoopAgent.
 *
 * Configures the agent with all ProjectAchilles tools and the domain-specific
 * system prompt. Supports streaming for real-time terminal output.
 */

import { streamText, stepCountIs } from 'ai';
import { allTools } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import { getConfiguredModel } from './provider.js';
import { loadConfig } from '../config/store.js';
import { getUserInfo } from '../auth/token-store.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function* streamChatResponse(
  messages: ChatMessage[],
): AsyncGenerator<string, void, unknown> {
  const config = loadConfig();
  const user = getUserInfo();

  const systemPrompt = buildSystemPrompt({
    serverUrl: config.server_url,
    userId: user?.userId,
    orgId: user?.orgId,
    role: user?.role,
  });

  const model = getConfiguredModel();

  const result = streamText({
    model: model as any,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    tools: allTools,
    stopWhen: stepCountIs(10),
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

export async function getChatResponse(messages: ChatMessage[]): Promise<string> {
  let full = '';
  for await (const chunk of streamChatResponse(messages)) {
    full += chunk;
  }
  return full;
}
