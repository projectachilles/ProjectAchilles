/**
 * Chat launcher — starts the AI conversational agent.
 *
 * Uses a simple readline REPL that streams responses to stdout.
 * The TUI chat view (view.tsx) is available when running inside
 * the full-screen dashboard.
 */

import * as readline from 'readline';
import type { ChatMessage } from './agent.js';
import { streamChatResponse } from './agent.js';
import { colors } from '../output/colors.js';
import { loadConfig } from '../config/store.js';
import { getUserInfo } from '../auth/token-store.js';

export async function launchChat(): Promise<void> {
  const config = loadConfig();
  const user = getUserInfo();

  console.log(`
  ${colors.bold(colors.brightRed('◆ Achilles Chat'))}
  ${colors.dim('AI-powered security fleet management')}
  ${colors.dim(`Server: ${config.server_url}`)}
  ${user ? colors.dim(`User: ${user.userId}`) : colors.yellow('Not authenticated — run: achilles login')}

  ${colors.dim('Type your message and press Enter. Ctrl+C to quit.')}
  ${colors.dim('Examples:')}
    ${colors.gray('"Show me all online agents"')}
    ${colors.gray('"What\'s our defense score?"')}
    ${colors.gray('"Which techniques have the worst coverage?"')}
`);

  if (!config.ai?.api_key && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log(`  ${colors.yellow('⚠')} No AI provider configured.`);
    console.log(`    Set one with: ${colors.cyan('achilles config set ai.provider anthropic')}`);
    console.log(`    And:          ${colors.cyan('achilles config set ai.api_key sk-ant-...')}`);
    console.log(`    Or set env:   ${colors.cyan('ANTHROPIC_API_KEY=sk-ant-...')}\n`);
  }

  const messages: ChatMessage[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.brightGreen('▸')} `,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }

    if (text === '/quit' || text === '/exit' || text === '/q') {
      rl.close();
      return;
    }

    if (text === '/clear') {
      messages.length = 0;
      console.log(`  ${colors.dim('Conversation cleared.')}\n`);
      rl.prompt();
      return;
    }

    if (text === '/help') {
      console.log(`
  ${colors.bold('Chat Commands:')}
    ${colors.cyan('/clear')}    Clear conversation history
    ${colors.cyan('/quit')}     Exit chat
    ${colors.cyan('/help')}     Show this help
`);
      rl.prompt();
      return;
    }

    messages.push({ role: 'user', content: text });

    process.stdout.write(`\n  ${colors.brightRed('◆')} `);

    try {
      let fullResponse = '';
      for await (const chunk of streamChatResponse(messages)) {
        process.stdout.write(chunk);
        fullResponse += chunk;
      }
      process.stdout.write('\n\n');
      messages.push({ role: 'assistant', content: fullResponse });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`\n  ${colors.brightRed('✗')} ${errMsg}\n`);
      // Don't add error to context — let user retry
      messages.pop(); // Remove the user message that caused the error
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n  ${colors.dim('Goodbye!')}\n`);
    process.exit(0);
  });
}
