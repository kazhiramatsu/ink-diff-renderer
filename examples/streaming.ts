/**
 * Streaming data rendering example
 * Demonstrates high-frequency updates without flicker
 * Run with: npx ts-node examples/streaming.ts
 */

import { Terminal, Colors, Style } from '../src';

const terminal = new Terminal({ fps: 60 });

// State
interface LogLine {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

let lines: LogLine[] = [];
let scrollOffset = 0;
let messageCount = 0;
let isPaused = false;

// Style map for log levels
const levelStyles: Record<string, Style> = {
  info: { fg: Colors.green },
  warn: { fg: Colors.yellow },
  error: { fg: Colors.red, bold: true },
  debug: { fg: Colors.brightBlack },
};

const levelLabels: Record<string, string> = {
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
  debug: 'DEBUG',
};

terminal.onRender((buffer) => {
  const headerHeight = 3;
  const footerHeight = 2;
  const contentHeight = buffer.height - headerHeight - footerHeight;
  
  // Header
  buffer.write(0, 0, '─'.repeat(buffer.width), { style: { fg: Colors.brightBlack } });
  buffer.write(0, 1, ` Streaming Log Viewer | Messages: ${lines.length} | Scroll: ${scrollOffset} | ${isPaused ? '[PAUSED]' : '[LIVE]'}`, {
    style: { fg: Colors.cyan, bold: true }
  });
  buffer.write(0, 2, '─'.repeat(buffer.width), { style: { fg: Colors.brightBlack } });
  
  // Content area
  const visibleLines = lines.slice(scrollOffset, scrollOffset + contentHeight);
  
  for (let i = 0; i < contentHeight; i++) {
    const y = headerHeight + i;
    const line = visibleLines[i];
    
    if (line) {
      const time = line.timestamp.toLocaleTimeString();
      const levelLabel = levelLabels[line.level];
      const style = levelStyles[line.level];
      
      // Timestamp
      buffer.write(0, y, time, { style: { fg: Colors.brightBlack } });
      
      // Level
      buffer.write(10, y, levelLabel, { style });
      
      // Message (truncate to fit)
      const maxMsgLen = buffer.width - 17;
      const msg = line.message.length > maxMsgLen 
        ? line.message.slice(0, maxMsgLen - 3) + '...'
        : line.message;
      buffer.write(16, y, msg, { style: { fg: Colors.white } });
    }
  }
  
  // Footer
  buffer.write(0, buffer.height - 2, '─'.repeat(buffer.width), { style: { fg: Colors.brightBlack } });
  buffer.write(0, buffer.height - 1, ' [↑/↓] Scroll  [Space] Pause  [c] Clear  [q] Quit', {
    style: { fg: Colors.brightBlack }
  });
});

// Generate random log messages
function generateLogLine(): LogLine {
  messageCount++;
  
  const levels: LogLine['level'][] = ['info', 'info', 'info', 'warn', 'error', 'debug', 'debug'];
  const level = levels[Math.floor(Math.random() * levels.length)];
  
  const messages = [
    `Processing request #${messageCount}`,
    `User authentication successful`,
    `Database query completed in ${Math.floor(Math.random() * 100)}ms`,
    `Cache miss for key: user_${Math.floor(Math.random() * 1000)}`,
    `WebSocket connection established`,
    `API rate limit: ${Math.floor(Math.random() * 1000)}/1000 requests`,
    `Memory usage: ${Math.floor(Math.random() * 100)}%`,
    `Connection timeout after 30s`,
    `Invalid JSON payload received`,
    `Task scheduled for execution`,
  ];
  
  return {
    timestamp: new Date(),
    level,
    message: messages[Math.floor(Math.random() * messages.length)],
  };
}

// Add new lines at high frequency
const addInterval = setInterval(() => {
  if (isPaused) return;
  
  // Add 1-3 lines per tick
  const count = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < count; i++) {
    lines.push(generateLogLine());
  }
  
  // Limit total lines
  if (lines.length > 10000) {
    lines = lines.slice(-5000);
    scrollOffset = Math.max(0, scrollOffset - 5000);
  }
  
  // Auto-scroll to bottom
  const contentHeight = terminal.height - 5;
  if (lines.length > contentHeight) {
    scrollOffset = lines.length - contentHeight;
  }
  
  terminal.scheduleRender();
}, 10); // Very high frequency!

// Handle keyboard input
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  
  process.stdin.on('data', (key: string) => {
    const contentHeight = terminal.height - 5;
    
    switch (key) {
      case '\u0003': // Ctrl+C
      case 'q':
        cleanup();
        break;
      case ' ':
        isPaused = !isPaused;
        terminal.scheduleRender();
        break;
      case 'c':
        lines = [];
        scrollOffset = 0;
        terminal.scheduleRender();
        break;
      case '\u001b[A': // Up arrow
        scrollOffset = Math.max(0, scrollOffset - 1);
        terminal.scheduleRender();
        break;
      case '\u001b[B': // Down arrow
        scrollOffset = Math.min(
          Math.max(0, lines.length - contentHeight),
          scrollOffset + 1
        );
        terminal.scheduleRender();
        break;
      case '\u001b[5~': // Page Up
        scrollOffset = Math.max(0, scrollOffset - contentHeight);
        terminal.scheduleRender();
        break;
      case '\u001b[6~': // Page Down
        scrollOffset = Math.min(
          Math.max(0, lines.length - contentHeight),
          scrollOffset + contentHeight
        );
        terminal.scheduleRender();
        break;
    }
  });
}

function cleanup() {
  clearInterval(addInterval);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  terminal.destroy();
  console.log(`\nProcessed ${messageCount} messages`);
  process.exit(0);
}

process.on('SIGINT', cleanup);

// Initial render
terminal.renderNow();
