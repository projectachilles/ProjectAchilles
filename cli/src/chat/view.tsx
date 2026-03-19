/**
 * Chat TUI view — full-screen conversational interface using Ink.
 *
 * Features:
 * - Scrollable message history
 * - Streaming AI responses with spinner
 * - Markdown rendering (bold, headers, tables, code blocks)
 * - Persistent text input at the bottom
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { ChatMessage } from './agent.js';
import { streamChatResponse } from './agent.js';
import { getActiveProfile } from '../config/store.js';
import { getUserInfo } from '../auth/token-store.js';

// ─── Markdown renderer ──────────────────────────────────────────────────────

const marked = new Marked(
  markedTerminal({
    width: 76,
    reflowText: true,
    showSectionPrefix: false,
    tab: 2,
  }) as any,
);

/** Post-process to fix inline formatting that marked-terminal misses in lists */
function fixRemainingMarkdown(text: string): string {
  return text
    // Bold: **text** → ANSI bold
    .replace(/\*\*([^*]+)\*\*/g, '\x1b[1m$1\x1b[22m')
    // Italic: *text* → ANSI italic (only single *, not inside **)
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '\x1b[3m$1\x1b[23m')
    // Inline code: `text` → ANSI dim
    .replace(/`([^`]+)`/g, '\x1b[36m$1\x1b[39m');
}

function renderMarkdown(text: string): string {
  try {
    const rendered = marked.parse(text);
    if (typeof rendered === 'string') {
      return fixRemainingMarkdown(rendered.replace(/\n+$/, ''));
    }
    return fixRemainingMarkdown(text);
  } catch {
    return fixRemainingMarkdown(text);
  }
}

// ─── Message component ──────────────────────────────────────────────────────

interface MessageProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

function Message({ message, isStreaming }: MessageProps) {
  const isUser = message.role === 'user';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={isUser ? 'green' : 'red'} bold>
        {isUser ? '▸ You' : '◆ Achilles'}
        {isStreaming ? <Text color="yellow"> (streaming...)</Text> : ''}
      </Text>
      <Box marginLeft={2}>
        {isUser ? (
          <Text>{message.content}</Text>
        ) : (
          <Text>{renderMarkdown(message.content)}</Text>
        )}
      </Box>
    </Box>
  );
}

// ─── ASCII title ────────────────────────────────────────────────────────────

const TITLE_LINES = [
  '█▀█ █▀█ █▀█ ░▀░ █▀▀ █▀▀ ▀█▀   █▀█ █▀▀ █░█ ▀█▀ █░░ █░░ █▀▀ █▀',
  '█▀▀ █▀▄ █▄█ ░█░ ██▄ █▄▄ ░█░   █▀█ █▄▄ █▀█ ░█░ █▄▄ █▄▄ ██▄ ▄█',
];

function AsciiTitle({ width }: { width: number }) {
  return (
    <Box flexDirection="column" alignItems="center" marginTop={1} marginBottom={1}>
      {TITLE_LINES.map((line, i) => (
        <Text key={`title-${i}`} color="red">{line}</Text>
      ))}
    </Box>
  );
}

// ─── Welcome screen ─────────────────────────────────────────────────────────

function WelcomeMessage() {
  const profile = getActiveProfile();
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  return (
    <Box flexDirection="column" alignItems="center">
      <AsciiTitle width={termWidth} />
      <Box marginBottom={1}>
        <Text dimColor>
          {profile.server_url}
          {profile.name !== 'default' ? ` (${profile.name})` : ''}
          {'  ·  Claude Sonnet 4.6'}
        </Text>
      </Box>
    </Box>
  );
}

// ─── Keyboard hints ─────────────────────────────────────────────────────────

function KeyboardHints({ streaming }: { streaming: boolean }) {
  return (
    <Box justifyContent="center" marginTop={0}>
      <Text dimColor>
        {streaming ? '' : '/clear reset  '}
        <Text bold dimColor>ctrl+c</Text>
        {' quit'}
      </Text>
    </Box>
  );
}

// ─── Main Chat App ──────────────────────────────────────────────────────────

export function ChatApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { exit } = useApp();
  const { stdout } = useStdout();

  const termHeight = stdout?.rows ?? 24;
  // Reserve lines for input area (3) and some padding
  const maxVisibleMessages = Math.max(3, Math.floor((termHeight - 6) / 4));

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    setInput('');
    setError(null);

    // Handle commands
    if (trimmed === '/quit' || trimmed === '/exit' || trimmed === '/q') {
      exit();
      return;
    }
    if (trimmed === '/clear') {
      setMessages([]);
      return;
    }
    if (trimmed === '/help') {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '**Chat Commands:**\n- `/clear` — Clear conversation\n- `/quit` — Exit chat\n- `/help` — Show this help',
      }]);
      return;
    }

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setStreaming(true);
    setStreamBuffer('');

    try {
      let fullResponse = '';
      for await (const chunk of streamChatResponse(newMessages)) {
        fullResponse += chunk;
        setStreamBuffer(fullResponse);
      }
      setMessages(prev => [...prev, { role: 'assistant', content: fullResponse }]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errMsg}` }]);
    } finally {
      setStreaming(false);
      setStreamBuffer('');
    }
  }, [messages, streaming, exit]);

  // Build display messages: history + current stream
  const displayMessages = streaming && streamBuffer
    ? [...messages, { role: 'assistant' as const, content: streamBuffer }]
    : messages;

  // Show only recent messages that fit
  const visible = displayMessages.slice(-maxVisibleMessages);

  const showWelcome = messages.length === 0 && !streaming;

  return (
    <Box flexDirection="column">
      {/* Welcome title — only when no messages */}
      {showWelcome && <WelcomeMessage />}

      {/* Messages area */}
      {!showWelcome && (
        <Box flexDirection="column" paddingX={1}>
          {visible.map((msg, i) => (
            <Message
              key={`msg-${messages.length - visible.length + i}-${msg.role}`}
              message={msg}
              isStreaming={streaming && i === visible.length - 1 && msg.role === 'assistant'}
            />
          ))}
        </Box>
      )}

      {/* Spinner when waiting for first token */}
      {streaming && !streamBuffer && (
        <Box marginLeft={3} marginBottom={1}>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text color="yellow"> Thinking...</Text>
        </Box>
      )}

      {/* Error display */}
      {error && !streaming && (
        <Box marginLeft={1} marginBottom={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}

      {/* Input area — styled like opencode with left accent border */}
      <Box borderStyle="single" borderColor={streaming ? 'gray' : 'red'} paddingX={1} flexDirection="column">
        <Box>
          <Text color="green" bold>▸ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder={streaming ? 'Waiting for response...' : 'Ask anything... "Show me all online agents"'}
          />
        </Box>
        <Box>
          <Text color="red" bold>Server </Text>
          <Text dimColor>{getActiveProfile().server_url}</Text>
        </Box>
      </Box>

      {/* Keyboard hints below input */}
      <KeyboardHints streaming={streaming} />
    </Box>
  );
}
