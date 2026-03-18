/**
 * Chat TUI view — full-screen conversational interface.
 *
 * Renders a scrollable message list with streaming AI responses
 * and a text input at the bottom.
 */

import { useState, useEffect, useRef } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { Spinner } from '../tui/components/Spinner.js';
import type { ChatMessage } from './agent.js';
import { streamChatResponse } from './agent.js';

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const { width, height } = useTerminalDimensions();

  const sendMessage = async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
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
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errMsg}` }]);
    } finally {
      setStreaming(false);
      setStreamBuffer('');
    }
  };

  useKeyboard((event) => {
    if (event.name === 'escape') {
      process.exit(0);
    }
  });

  const messageAreaHeight = height - 5; // input area + status bar
  const allMessages = streaming
    ? [...messages, { role: 'assistant' as const, content: streamBuffer }]
    : messages;

  // Show only messages that fit
  const visibleMessages = allMessages.slice(-Math.max(5, Math.floor(messageAreaHeight / 2)));

  return (
    <box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <box flexDirection="row" height={1} backgroundColor="#1a1a2e">
        <text fg="#e94560"> ◆ Achilles Chat </text>
        <box flexGrow={1} />
        <text fg="#6c6c8a">ESC: quit  Enter: send </text>
      </box>

      {/* Messages */}
      <scrollbox flexGrow={1} flexDirection="column" padding={1}>
        {visibleMessages.length === 0 ? (
          <box flexDirection="column" padding={2}>
            <text fg="#e94560">Welcome to Achilles Chat!</text>
            <text fg="#6c6c8a">Ask me anything about your security fleet.</text>
            <text fg="#6c6c8a">Examples:</text>
            <text fg="#a0a0b8">  "Show me all online agents"</text>
            <text fg="#a0a0b8">  "What's our defense score?"</text>
            <text fg="#a0a0b8">  "Run T1059 against win-dc01"</text>
            <text fg="#a0a0b8">  "Which techniques have the worst coverage?"</text>
          </box>
        ) : (
          visibleMessages.map((msg, i) => (
            <box key={i} flexDirection="column" marginBottom={1}>
              <text fg={msg.role === 'user' ? '#16c79a' : '#e94560'}>
                {msg.role === 'user' ? '▸ You' : '◆ Achilles'}
              </text>
              <box paddingLeft={2}>
                <text fg={msg.role === 'user' ? '#ffffff' : '#a0a0b8'}>
                  {msg.content || (streaming && i === visibleMessages.length - 1 ? '…' : '')}
                </text>
              </box>
            </box>
          ))
        )}
        {streaming && !streamBuffer && <Spinner message="Thinking..." />}
      </scrollbox>

      {/* Input */}
      <box flexDirection="row" height={1} backgroundColor="#16213e" padding={0}>
        <text fg="#16c79a"> ▸ </text>
        <input
          placeholder="Ask me anything..."
          value={input}
          focused={!streaming}
          onInput={(val: string) => setInput(val)}
          onSubmit={(val: string) => sendMessage(val)}
        />
      </box>
    </box>
  );
}
