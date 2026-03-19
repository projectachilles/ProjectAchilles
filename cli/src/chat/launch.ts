/**
 * Chat launcher — starts the AI conversational agent.
 *
 * Two modes:
 * 1. Interactive (TTY): Ink-based TUI with markdown rendering, spinner, styled input
 * 2. Piped (non-TTY): Simple readline REPL for scripting / CI
 */

import React from 'react';
import { render } from 'ink';
import { ChatApp } from './view.js';
import * as readline from 'readline';
import type { ChatMessage } from './agent.js';
import { streamChatResponse } from './agent.js';
import { colors } from '../output/colors.js';
import { loadConfig, getActiveProfile } from '../config/store.js';
import { getUserInfo } from '../auth/token-store.js';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

export async function launchChat(): Promise<void> {
  // Ink needs a real TTY with raw mode support
  const canUseInk = process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';

  if (canUseInk) {
    // Interactive mode — full Ink TUI
    launchInkChat();
  } else {
    // Piped / non-TTY mode — readline with markdown rendering
    await launchReadlineChat();
  }
}

// ─── Ink TUI mode ────────────────────────────────────────────────────────────

function launchInkChat(): void {
  render(React.createElement(ChatApp), { exitOnCtrlC: true });
}

// ─── Readline fallback (piped stdin) ─────────────────────────────────────────

const marked = new Marked(
  markedTerminal({
    width: 80,
    reflowText: true,
    showSectionPrefix: false,
    tab: 2,
  }) as any,
);

/** Post-process to fix inline formatting that marked-terminal misses in lists */
function fixRemainingMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '\x1b[1m$1\x1b[22m')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '\x1b[3m$1\x1b[23m')
    .replace(/`([^`]+)`/g, '\x1b[36m$1\x1b[39m');
}

function renderMd(text: string): string {
  try {
    const rendered = marked.parse(text);
    const cleaned = typeof rendered === 'string' ? rendered.replace(/\n+$/, '') : text;
    return fixRemainingMarkdown(cleaned);
  } catch {
    return fixRemainingMarkdown(text);
  }
}

async function launchReadlineChat(): Promise<void> {
  const config = loadConfig();
  const user = getUserInfo();
  const profile = getActiveProfile();

  console.log(`
  ${colors.bold(colors.brightRed('◆ Achilles Chat'))}
  ${colors.dim('AI-powered security fleet management')}
  ${colors.dim(`Server: ${profile.server_url}`)}${profile.name !== 'default' ? colors.dim(` (${profile.name})`) : ''}
  ${user ? colors.dim(`User: ${user.userId}`) : colors.yellow('Not authenticated — run: achilles login')}
`);

  if (!config.ai?.api_key && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log(`  ${colors.yellow('⚠')} No AI provider configured.`);
    console.log(`    Set one with: ${colors.cyan('achilles config set ai.provider anthropic')}`);
    console.log(`    And:          ${colors.cyan('achilles config set ai.api_key sk-ant-...')}\n`);
  }

  const messages: ChatMessage[] = [];
  let responding = false;
  let closePending = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.brightGreen('▸')} `,
  });

  function exitChat(): void {
    console.log(`\n  ${colors.dim('Goodbye!')}\n`);
    process.exit(0);
  }

  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    if (text === '/quit' || text === '/exit' || text === '/q') { rl.close(); return; }

    messages.push({ role: 'user', content: text });
    process.stdout.write(`\n  ${colors.brightRed('◆')} `);

    responding = true;
    try {
      let fullResponse = '';
      for await (const chunk of streamChatResponse(messages)) {
        fullResponse += chunk;
      }
      // Render markdown for the complete response
      console.log(renderMd(fullResponse));
      console.log();
      messages.push({ role: 'assistant', content: fullResponse });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`\n  ${colors.brightRed('✗')} ${errMsg}\n`);
      messages.pop();
    }
    responding = false;

    if (closePending) { exitChat(); return; }
    rl.prompt();
  });

  rl.on('close', () => {
    if (responding) { closePending = true; return; }
    exitChat();
  });
}
