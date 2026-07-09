/**
 * Claude Chat Demo with React Ink
 * Uses diff-based rendering for flicker-free streaming
 * 
 * Run with: ANTHROPIC_API_KEY=your-key npm run example:chat
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Anthropic from '@anthropic-ai/sdk';

// ink 4+ is ESM-only (with top-level await), so it cannot be require()d from
// the CommonJS output ts-node produces. Load it with a real dynamic import()
// at runtime; new Function keeps TypeScript from transpiling it to require().
const importInk = new Function('return import("ink")') as () => Promise<any>;
let render: any, Box: any, Text: any, useApp: any, useInput: any, useStdout: any;
import { useThrottledState } from '../src';

// Types
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

import GraphemeSplitter from 'grapheme-splitter';

const splitter = new GraphemeSplitter();

// Simple text input component
function TextInput({ 
  value, 
  onChange, 
  onSubmit,
  placeholder = '',
  focus = true 
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
}) {
  useInput((input: string, key: any) => {
    if (!focus) return;
    
    if (key.return) {
      onSubmit(value);
    } else if (key.backspace || key.delete) {
      // Delete last grapheme (handles multi-byte characters correctly)
      const graphemes = splitter.splitGraphemes(value);
      graphemes.pop();
      onChange(graphemes.join(''));
    } else if (!key.ctrl && !key.meta && input) {
      // Accept any printable input including Japanese
      onChange(value + input);
    }
  }, { isActive: focus });

  return (
    <Text>
      {value || <Text color="gray">{placeholder}</Text>}
      <Text color="cyan">▋</Text>
    </Text>
  );
}

// Main Chat Component
function ChatApp() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  
  // Use throttled state for streaming content to reduce renders
  const [streamingContent, setStreamingContent] = useThrottledState('', 16);
  
  const clientRef = useRef<Anthropic | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Initialize client
  useEffect(() => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      exit();
      return;
    }
    clientRef.current = new Anthropic({ apiKey });
  }, [exit]);

  // Handle quit
  useInput((input: string, key: any) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      exit();
    }
  });

  // Send message to Claude
  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim() || !clientRef.current || isStreaming) return;

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: userMessage }
    ];
    
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    try {
      abortRef.current = new AbortController();
      
      const stream = clientRef.current.messages.stream({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages: newMessages.map(m => ({
          role: m.role,
          content: m.content
        })),
      }, {
        signal: abortRef.current.signal
      });

      let fullContent = '';

      stream.on('text', (text) => {
        fullContent += text;
        setStreamingContent(fullContent);
      });

      await stream.finalMessage();

      // Add complete message
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: fullContent }
      ]);
      setStreamingContent('');

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `Error: ${error.message}` }
        ]);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, isStreaming, setStreamingContent]);

  // Calculate visible area
  const termHeight = stdout?.rows || 24;
  const headerHeight = 4;
  const inputHeight = 3;
  const availableHeight = termHeight - headerHeight - inputHeight;

  // Render messages with word wrap simulation
  const renderMessages = () => {
    const rendered: JSX.Element[] = [];
    const termWidth = stdout?.columns || 80;
    const contentWidth = termWidth - 4; // Padding

    const allMessages = streamingContent 
      ? [...messages, { role: 'assistant' as const, content: streamingContent }]
      : messages;

    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      const isUser = msg.role === 'user';
      const isCurrentlyStreaming = i === allMessages.length - 1 && isStreaming;

      rendered.push(
        <Box key={`msg-${i}`} flexDirection="column" marginBottom={1}>
          <Text color={isUser ? 'green' : 'cyan'} bold>
            {isUser ? '▶ You' : '◀ Claude'}
            {isCurrentlyStreaming && <Text color="yellow"> ●</Text>}
          </Text>
          <Box marginLeft={2} flexDirection="column">
            <Text wrap="wrap">{msg.content}</Text>
          </Box>
        </Box>
      );
    }

    return rendered;
  };

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Header */}
      <Box 
        borderStyle="round" 
        borderColor="blue" 
        paddingX={1}
        flexShrink={0}
      >
        <Text color="blue" bold>
          Claude Chat
        </Text>
        <Text color="gray"> | </Text>
        <Text color="gray">
          ESC to quit | Enter to send
        </Text>
      </Box>

      {/* Messages Area */}
      <Box 
        flexDirection="column" 
        flexGrow={1}
        paddingX={1}
        paddingY={1}
        overflowY="hidden"
      >
        {messages.length === 0 && !streamingContent ? (
          <Text color="gray" italic>
            Type a message to start chatting with Claude...
          </Text>
        ) : (
          renderMessages()
        )}
      </Box>

      {/* Input Area */}
      <Box 
        borderStyle="round" 
        borderColor={isStreaming ? 'yellow' : 'green'}
        paddingX={1}
        flexShrink={0}
      >
        <Text color="green" bold>{'> '}</Text>
        {isStreaming ? (
          <Text color="yellow">Streaming response...</Text>
        ) : (
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={sendMessage}
            placeholder="Type your message..."
            focus={!isStreaming}
          />
        )}
      </Box>
    </Box>
  );
}

// Check for API key before rendering
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  console.error('Usage: ANTHROPIC_API_KEY=your-key npm run example:chat');
  process.exit(1);
}

// Load ink, then render the app
async function main() {
  ({ render, Box, Text, useApp, useInput, useStdout } = await importInk());
  render(<ChatApp />);
}

main();
