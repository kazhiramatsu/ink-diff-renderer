# ink-diff-renderer

Flicker-free terminal rendering with diff-based updates for React Ink and standalone use.

## Features

- **Diff-based rendering**: Only updates changed cells, eliminating flicker
- **Double buffering**: Smooth updates without tearing
- **Frame rate limiting**: Configurable FPS (default: 60)
- **Synchronized output**: Uses DEC private mode 2026 for compatible terminals
- **React Ink integration**: Drop-in hooks for Ink applications
- **Wide character support**: Proper handling of CJK and emoji characters
- **Full styling**: 256 colors, RGB, bold, italic, underline, etc.

## Installation

```bash
npm install ink-diff-renderer
```

## Quick Start

### Standalone Usage

```typescript
import { Terminal, Colors } from 'ink-diff-renderer';

const terminal = new Terminal({ fps: 60 });

terminal.onRender((buffer) => {
  buffer.write(0, 0, 'Hello World!', {
    style: { fg: Colors.green, bold: true }
  });
  
  buffer.write(0, 1, `Time: ${new Date().toLocaleTimeString()}`);
});

// Update every 100ms
setInterval(() => {
  terminal.scheduleRender();
}, 100);

// Clean up on exit
process.on('SIGINT', () => {
  terminal.destroy();
  process.exit(0);
});

terminal.renderNow();
```

### With React Ink

```tsx
import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import { useThrottledState } from 'ink-diff-renderer';

function App() {
  // Throttled state - batches updates to reduce renders
  const [messages, setMessages] = useThrottledState<string[]>([], 16);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessages(prev => [...prev.slice(-100), `Message ${Date.now()}`]);
    }, 10); // High frequency updates

    return () => clearInterval(interval);
  }, []);

  return (
    <Box flexDirection="column">
      {messages.slice(-20).map((msg, i) => (
        <Text key={i}>{msg}</Text>
      ))}
    </Box>
  );
}

render(<App />);
```

## API Reference

### Terminal

Main class for standalone terminal rendering.

```typescript
const terminal = new Terminal({
  fps: 60,              // Target frame rate
  altScreen: true,      // Use alternate screen buffer
  stdout: process.stdout // Output stream
});

// Set render callback
terminal.onRender((buffer: ScreenBuffer) => {
  // Draw to buffer
});

// Schedule render for next frame
terminal.scheduleRender();

// Render immediately
terminal.renderNow();

// Force full screen refresh
terminal.fullRefresh();

// Clean up
terminal.destroy();
```

### ScreenBuffer

Drawing surface with various primitives.

```typescript
// Write text
buffer.write(x, y, 'text', { 
  style: { fg: Colors.green },
  wrap: false 
});

// Fill rectangle
buffer.fill(x, y, width, height, '█', style);

// Draw box border
buffer.box(x, y, width, height, style);

// Draw lines
buffer.hline(x, y, width, '─', style);
buffer.vline(x, y, height, '│', style);

// Direct cell access
buffer.setCell(x, y, { char: 'A', width: 1, style });
buffer.getCell(x, y);

// Clear
buffer.clear();
```

### Style

Styling options for text.

```typescript
interface Style {
  fg?: number | [number, number, number] | null;  // Foreground (256 or RGB)
  bg?: number | [number, number, number] | null;  // Background
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

// Named colors
import { Colors } from 'ink-diff-renderer';

Colors.red        // 1
Colors.green      // 2
Colors.blue       // 4
Colors.cyan       // 6
Colors.brightRed  // 9
Colors.gray(0.5)  // Grayscale (0-1)
Colors.rgb(1, 0, 0) // RGB cube (0-1 each)
```

### React Hooks

#### useThrottledState

Batches rapid state updates to reduce render frequency.

```typescript
const [value, setValue, latestValue] = useThrottledState(initialValue, throttleMs);
```

#### useBatchedArray

Optimized for high-frequency array appends (logs, streams).

```typescript
const { items, push, pushMany, clear } = useBatchedArray(maxItems, batchMs);
```

#### useTerminal

Full terminal control in React.

```typescript
const {
  width,
  height,
  scheduleRender,
  renderNow,
  fullRefresh,
  setRenderCallback,
} = useTerminal({ fps: 60 });
```

## How It Works

### Double Buffering

```
Frame N:     [Front Buffer] ──render──> stdout
             [Back Buffer]  (previous frame for diff)

Frame N+1:   [Back Buffer]  ──render──> stdout  
             [Front Buffer] (now becomes back)
```

### ScrollbackTerminal (Claude Code-style)

For applications that need history preservation (like Claude Code), use `ScrollbackTerminal`:

```typescript
import { ScrollbackTerminal, Colors, EMPTY_STYLE } from 'ink-diff-renderer';

const terminal = new ScrollbackTerminal({
  inputHeight: 10,  // Fixed region at bottom
  fps: 30,
});

// Write to scrollback (persists after program exit)
terminal.writeLine('▶ You:', { fg: Colors.green, bold: true });
terminal.writeLine('  Hello Claude!');

// Render fixed area at bottom (for input/status)
terminal.onRender((buffer, width, height) => {
  buffer.write(0, height - 1, '> Type here...', { style: { fg: Colors.cyan } });
});

terminal.renderNow();

// Clean up
terminal.destroy();
```

Key differences from `Terminal`:
- Uses main screen buffer (not alternate screen)
- Content scrolls up and persists in terminal history
- Fixed input area at bottom stays in place
- History remains visible after program exits

### Diff Algorithm

1. Compare front (new) and back (old) buffers cell by cell
2. Group consecutive changed cells into chunks
3. Generate minimal ANSI sequences:
   - Cursor movement (relative when possible)
   - Style changes (only when needed)
   - Character output

### Synchronized Output

For terminals supporting DEC private mode 2026:

```
\x1b[?2026h  ← Begin synchronized update
... output ...
\x1b[?2026l  ← End synchronized update (display all at once)
```

## Examples

Run the examples:

```bash
# Basic demo
npx ts-node examples/basic.ts

# High-frequency streaming
npx ts-node examples/streaming.ts

# React Ink integration
npx ts-node examples/with-ink.tsx

# Claude Chat (React Ink)
ANTHROPIC_API_KEY=your-key npm run example:chat

# Claude Chat (Low-level Terminal API)
ANTHROPIC_API_KEY=your-key npm run example:chat-terminal

# Claude Chat (Advanced - recommended)
ANTHROPIC_API_KEY=your-key npm run example:chat-advanced

# Claude Code (with tool execution - like Claude Code CLI)
ANTHROPIC_API_KEY=your-key npm run example:claude-code
```

### Claude Code Demo

The `claude-code-scrollback.ts` example (run with `npm run example:claude-code`) demonstrates a Claude Code-style interface with tool execution. An alternate implementation, `claude-code.ts`, is available via `npm run example:claude-code-alt`. Features:

- **Tool execution**: bash, read_file, write_file, list_files, search_files
- **Visual tool status**: Spinner while running, checkmark on success, X on error
- **Tool output display**: Collapsible output with truncation
- **Automatic continuation**: Tool results are sent back to Claude for follow-up
- **All features from chat-advanced**: Multi-line input, history, Japanese support

```
╭─ Claude Code ── 📁 /home/user/project ────────── ⠋ Running... ESC to cancel ─╮
│                                                                               │
│ ▶ You:                                                                        │
│   List the files in the current directory                                     │
│                                                                               │
│ ◀ Claude:                                                                     │
│   I'll list the files for you.                                                │
│                                                                               │
│   📁 list_files ✓                                                             │
│     Listing: .                                                                │
│     │ src/                                                                    │
│     │ package.json                                                            │
│     │ README.md                                                               │
│                                                                               │
│   The directory contains 3 items...                                           │
│                                                                               │
╰───────────────────────────────────────────────────────────────────────────────╯
╭───────────────────────────────────────────────────────────────────────────────╮
│ > ▋ Type your message...                                                      │
╰───────────────────────────────────────────────────────────────────────────────╯
```

### Claude Chat Demo

The `claude-chat-advanced.ts` example demonstrates a full-featured chat application:

- **Flicker-free streaming**: High-frequency token updates without visual artifacts
- **Scrollable history**: Use PageUp/PageDown to scroll through conversation
- **Word wrapping**: Long messages wrap properly within the terminal width
- **Visual feedback**: Streaming indicator, cursor, scroll position
- **Multiline input**: Full text editing support
- **History navigation**: ↑↓ to recall previous messages
- **Emacs keybindings**: Ctrl+A/E, Ctrl+W, Alt+B/F, etc.
- **Japanese input**: Full Unicode/CJK support

```
─ Claude Chat ───────────────────────────────────────── ESC:quit Ctrl+C:cancel ─
Messages: 3

▶ You (14:32)
  What is the capital of France?

◀ Claude (14:32)
  The capital of France is Paris. Located along the Seine,
  it is home to the Eiffel Tower, the Louvre Museum, and...

╭──────────────────────────────────────────────────────────────────────────────╮
│❯ 東京の天気は？▋                                                             │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## Editor Component

The library includes a complete text editor component with Claude Code-level input quality:

### Features

- **Multi-line editing**: Full support for multi-line text with Shift+Enter for newlines
- **Cursor navigation**: Arrow keys, Home/End, Ctrl+A/E, word movement
- **Text manipulation**: Backspace, Delete, word/line deletion
- **History**: Up/Down arrow navigation through previous inputs
- **Japanese/Unicode**: Full IME and grapheme cluster support
- **Clipboard**: Ctrl+V paste support (OS clipboard integration)
- **Emacs keybindings**: Familiar shortcuts for power users

### Basic Usage

```typescript
import { Editor, Terminal, ScreenBuffer } from 'ink-diff-renderer';

const editor = new Editor({
  placeholder: 'Type your message...',
  maxVisibleLines: 5,
  enableHistory: true,
  prompt: '> ',
  continuationPrompt: '  ',
  keyBindings: {
    submitOnEnter: true,    // Enter submits, Shift+Enter for newline
    enableEmacs: true,      // Ctrl+A/E, etc.
    enableHistory: true,
  },
});

editor.setCallbacks({
  onSubmit: (text) => console.log('Submitted:', text),
  onCancel: () => console.log('Cancelled'),
  onChange: (text) => console.log('Changed:', text),
  onPaste: async () => getClipboardText(),  // Custom paste handler
});

// In render loop
terminal.onRender((buffer) => {
  editor.render(buffer, 0, 10, 80, 5);
});

// Handle keyboard input
process.stdin.on('data', (key) => {
  editor.handleInput(key);
  terminal.scheduleRender();
});
```

### Keybindings

| Key | Action |
|-----|--------|
| **Submission** ||
| Enter | Submit (if submitOnEnter) or newline |
| Shift+Enter | Newline (if submitOnEnter) |
| Ctrl+Enter | Submit (if submitOnCtrlEnter) |
| **Navigation** ||
| ←/→ | Move cursor left/right |
| ↑/↓ | Move cursor up/down or history |
| Ctrl+←/→ | Move word left/right |
| Alt+←/→ | Move word left/right |
| Home | Line start |
| End | Line end |
| Ctrl+A | Line start (Emacs) |
| Ctrl+E | Line end (Emacs) |
| Ctrl+B/F | Char backward/forward (Emacs) |
| Alt+B/F | Word backward/forward (Emacs) |
| **Deletion** ||
| Backspace | Delete char backward |
| Delete | Delete char forward |
| Ctrl+W | Delete word backward |
| Alt+Backspace | Delete word backward |
| Ctrl+U | Delete to line start |
| Ctrl+K | Delete to line end |
| Ctrl+D | Delete forward |
| **Other** ||
| Ctrl+V | Paste from clipboard |
| Ctrl+L | Clear/refresh |
| ESC | Cancel |
| Ctrl+C | Cancel |

### Editor API

```typescript
const editor = new Editor(options);

// Text access
editor.text;              // Get/set full text
editor.isEmpty;           // Check if empty
editor.cursor;            // Get cursor position { line, col }
editor.lineCount;         // Number of lines

// Configuration
editor.setOptions({...}); // Update options
editor.setStyles({...});  // Update styles
editor.setCallbacks({...}); // Set event handlers

// Control
editor.handleInput(key);  // Process keyboard input
editor.clear();           // Clear all text
editor.focus();           // Activate editor
editor.blur();            // Deactivate editor

// Rendering
editor.render(buffer, x, y, width, height);
editor.getDisplayLines(width);  // Get wrapped lines
editor.getRenderInfo(width);    // Get detailed render info

// History access
editor.getHistory();      // Get InputHistory instance
editor.getBuffer();       // Get TextBuffer instance
```

### TextBuffer API

Low-level text manipulation:

```typescript
import { TextBuffer } from 'ink-diff-renderer';

const buffer = new TextBuffer('Initial text');

// Text access
buffer.text;              // Full text
buffer.lines;             // Array of lines
buffer.lineCount;         // Number of lines
buffer.cursor;            // { line, col }
buffer.isEmpty;           // Is empty
buffer.currentLine;       // Current line text

// Cursor movement
buffer.moveCursorLeft(n);
buffer.moveCursorRight(n);
buffer.moveCursorUp(n);
buffer.moveCursorDown(n);
buffer.moveCursorWordLeft();
buffer.moveCursorWordRight();
buffer.moveCursorToLineStart();
buffer.moveCursorToLineEnd();
buffer.moveCursorToStart();
buffer.moveCursorToEnd();
buffer.moveCursorTo(line, col);

// Editing
buffer.insert(text);
buffer.insertNewline();
buffer.backspace();
buffer.delete();
buffer.deleteWordBackward();
buffer.deleteWordForward();
buffer.deleteToLineStart();
buffer.deleteToLineEnd();
buffer.deleteLine();

// Selection
buffer.selectAll();
buffer.clearSelection();
buffer.getSelectedText();
buffer.deleteSelection();

// Display helpers
buffer.getCursorDisplayX();  // Cursor position in display columns
buffer.getLineDisplayWidth(lineIndex);
buffer.displayColToGraphemeIndex(lineIndex, displayCol);
```

## Tool Execution

The library includes a Claude Code-compatible tool execution system:

### Core Tools

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands with timeout support |
| `view` | Read files with line numbers and optional range |
| `write` | Create or overwrite files |
| `edit` | Edit files using search/replace (must be unique) |
| `multiedit` | Apply multiple edits to a file atomically |
| `glob` | Find files matching glob patterns |
| `grep` | Search file contents with regex |
| `ls` | List directory contents with metadata |

### Agent Tools (Claude Code Compatible)

| Agent | Description |
|-------|-------------|
| `Task` | General purpose autonomous agent for complex multi-step tasks |
| `Explore` | Codebase exploration agent - understand code structure without making changes |
| `Plan` | Planning agent - create detailed implementation plans before coding |
| `Code` | Coding agent - focused code writing and modification |
| `Debug` | Debugging agent - find root causes and fix bugs |

### Other Tools

| Tool | Description |
|------|-------------|
| `notebook_read` | Read Jupyter notebook cells |
| `notebook_edit` | Edit Jupyter notebook cells |
| `todo_read` | Read the session TODO list |
| `todo_write` | Update the session TODO list |

### Tool Examples

```typescript
// View file with line numbers
await executor.execute('view', { file_path: 'src/index.ts' });

// View specific line range
await executor.execute('view', { 
  file_path: 'src/index.ts', 
  offset: 100, 
  limit: 50 
});

// Edit a file (old_string must be unique)
await executor.execute('edit', {
  file_path: 'src/index.ts',
  old_string: 'const x = 1;',
  new_string: 'const x = 2;'
});

// Multiple edits in one operation
await executor.execute('multiedit', {
  file_path: 'src/index.ts',
  edits: [
    { old_string: 'foo', new_string: 'bar' },
    { old_string: 'baz', new_string: 'qux' }
  ]
});

// Find files
await executor.execute('glob', { pattern: '**/*.ts' });

// Search in files
await executor.execute('grep', { 
  pattern: 'function.*export', 
  include: '*.ts' 
});

// Task - delegate to autonomous agent (Claude Code compatible)
await executor.execute('Task', {
  prompt: 'Refactor all TypeScript files to use async/await'
});

// Explore - understand codebases
await executor.execute('Explore', {
  prompt: 'How is authentication implemented in this project?'
});

// Plan - create implementation plans
await executor.execute('Plan', {
  prompt: 'Plan the implementation of a REST API for user management'
});
```

### Agent Tools (Claude Code Compatible)

The library provides specialized agent tools that match Claude Code's agent system:

| Agent | Purpose | Use Case |
|-------|---------|----------|
| `Task` | General purpose autonomous work | Complex multi-step tasks |
| `Explore` | Codebase exploration & understanding | Understanding unfamiliar code |
| `Plan` | Create detailed implementation plans | Before starting complex work |
| `Code` | Write and modify code | Focused coding tasks |
| `Debug` | Find and fix bugs | Investigating issues |

```typescript
import { Agent, ToolExecutor, AgentType, subagentTools } from 'ink-diff-renderer';

// Create an agent of any type
const agent = new Agent(
  anthropicClient,
  toolExecutor,
  'Explore',  // AgentType: 'Task' | 'Explore' | 'Plan' | 'Code' | 'Debug'
  {
    maxIterations: 15,      // Max conversation turns
    timeout: 300000,        // 5 minute timeout
    onProgress: (msg, toolCalls) => {
      console.log(`Progress: ${msg} (${toolCalls} tools used)`);
    },
  }
);

// Execute using Claude Code compatible format
const result = await agent.execute({
  prompt: 'Explain how the authentication system works'
});

console.log(result.output);  // Summary of findings
```

#### Agent Specializations

**Task Agent** - General purpose autonomous work:
- Breaks down complex tasks into steps
- Verifies work after making changes
- Handles errors and retries

**Explore Agent** - Read-only codebase exploration:
- Searches files and directories
- Analyzes code structure
- Identifies patterns and architecture
- Does NOT make changes

**Plan Agent** - Implementation planning:
- Analyzes requirements
- Identifies affected components
- Creates step-by-step plans
- Does NOT make changes

**Code Agent** - Focused coding:
- Writes clean, well-structured code
- Follows existing patterns
- Handles edge cases
- Adds documentation

**Debug Agent** - Bug investigation:
- Analyzes error messages
- Traces code flow
- Identifies root causes
- Suggests or implements fixes

All agents:
- Have access to all tools except agent tools (prevents recursion)
- Work autonomously for up to `maxIterations` turns
- Report progress via `onProgress` callback
- Return a summary when complete

### Basic Usage

```typescript
import { ToolExecutor, tools, formatToolResult } from 'ink-diff-renderer';

// Create executor
const executor = new ToolExecutor({
  workingDirectory: process.cwd(),
  timeout: 30000,  // 30 seconds
});

// Execute a tool
const result = await executor.execute('bash', { command: 'ls -la' });
console.log(result.success ? result.output : result.error);

// Use with Anthropic API
const response = await client.messages.create({
  model: 'claude-sonnet-5',
  max_tokens: 4096,
  tools: tools,  // Pass tool definitions
  messages: [...],
});

// Handle tool use in response
for (const block of response.content) {
  if (block.type === 'tool_use') {
    const result = await executor.execute(block.name, block.input);
    // Send result back to Claude...
  }
}
```

### Tool Result Format

```typescript
interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
```

## Performance Tips

1. **Use `scheduleRender()` instead of `renderNow()`** - batches updates within frame time
2. **Minimize style changes** - group text with same style together
3. **Use `useThrottledState` for streaming data** - reduces React re-renders
4. **Consider alternate screen** - prevents scroll history pollution
5. **Set appropriate FPS** - 30-60 FPS is usually sufficient

## License

MIT
