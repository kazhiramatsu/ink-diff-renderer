/**
 * React Ink integration example
 * Shows how to use diff-based rendering with Ink
 * Run with: npx ts-node examples/with-ink.tsx
 */

import React, { useState, useEffect } from 'react';
import { useThrottledState, useBatchedArray } from '../src';

// ink 4+ is ESM-only (with top-level await), so it cannot be require()d from
// the CommonJS output ts-node produces. Load it with a real dynamic import()
// at runtime; new Function keeps TypeScript from transpiling it to require().
const importInk = new Function('return import("ink")') as () => Promise<any>;
let render: any, Box: any, Text: any, useApp: any, useInput: any, useStdout: any;

// Option 1: Using throttled state hook
function StreamingDemo() {
  const { exit } = useApp();
  const [messages, setMessages] = useThrottledState<string[]>([], 16);
  const [stats, setStats] = useState({ total: 0, rate: 0 });

  useInput((input: string, key: any) => {
    if (key.escape || input === 'q') {
      exit();
    }
  });

  useEffect(() => {
    let count = 0;
    let lastSecond = Date.now();
    let messagesThisSecond = 0;

    const interval = setInterval(() => {
      count++;
      messagesThisSecond++;

      setMessages(prev => {
        const next = [...prev, `[${new Date().toISOString()}] Message #${count}`];
        return next.slice(-30);
      });

      // Update stats every second
      const now = Date.now();
      if (now - lastSecond >= 1000) {
        setStats({ total: count, rate: messagesThisSecond });
        messagesThisSecond = 0;
        lastSecond = now;
      }
    }, 10); // 100 messages per second

    return () => clearInterval(interval);
  }, [setMessages]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>
          Streaming Demo with Throttled State
        </Text>
      </Box>
      
      <Box marginTop={1}>
        <Text color="cyan">
          Total: {stats.total} | Rate: {stats.rate}/sec | Press 'q' to quit
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {messages.map((msg, i) => (
          <Text key={i} color={i % 2 === 0 ? 'white' : 'gray'}>
            {msg}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// Option 2: Using batched array hook
function BatchedArrayDemo() {
  const { exit } = useApp();
  const { items, push, clear } = useBatchedArray<string>(50, 16);

  useInput((input: string, key: any) => {
    if (key.escape || input === 'q') {
      exit();
    }
    if (input === 'c') {
      clear();
    }
  });

  useEffect(() => {
    let count = 0;

    const interval = setInterval(() => {
      count++;
      push(`Line ${count}: ${Math.random().toString(36).substring(7)}`);
    }, 5);

    return () => clearInterval(interval);
  }, [push]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="blue" paddingX={1}>
        <Text color="blue" bold>
          Batched Array Demo
        </Text>
      </Box>
      
      <Box marginTop={1}>
        <Text color="cyan">
          Items: {items.length} | Press 'c' to clear, 'q' to quit
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1} height={20}>
        {items.slice(-20).map((item, i) => (
          <Text key={i} color="white">
            {item}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// Option 3: Using InkDiffRenderer directly
function DirectRendererDemo() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [output, setOutput] = useState<string[]>([]);

  useInput((input: string, key: any) => {
    if (key.escape || input === 'q') {
      exit();
    }
  });

  useEffect(() => {
    let count = 0;

    const interval = setInterval(() => {
      count++;
      setOutput(prev => {
        const next = [...prev, `Direct render line ${count}`];
        return next.slice(-15);
      });
    }, 50);

    return () => clearInterval(interval);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="magenta" paddingX={1}>
        <Text color="magenta" bold>
          Direct Renderer Demo
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {output.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Press 'q' to quit</Text>
      </Box>
    </Box>
  );
}

// Main app with demo selector
function App() {
  const [demo, setDemo] = useState<'streaming' | 'batched' | 'direct'>('streaming');
  const { exit } = useApp();

  useInput((input: string, key: any) => {
    if (input === '1') setDemo('streaming');
    if (input === '2') setDemo('batched');
    if (input === '3') setDemo('direct');
    if (key.escape || input === 'q') exit();
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} paddingX={1}>
        <Text color="yellow">
          [1] Streaming  [2] Batched  [3] Direct  [q] Quit
        </Text>
      </Box>

      {demo === 'streaming' && <StreamingDemo />}
      {demo === 'batched' && <BatchedArrayDemo />}
      {demo === 'direct' && <DirectRendererDemo />}
    </Box>
  );
}

// Load ink, then render the app
async function main() {
  ({ render, Box, Text, useApp, useInput, useStdout } = await importInk());
  render(<App />);
}

main();
