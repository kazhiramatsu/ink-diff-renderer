/**
 * Claude Chat Demo with low-level Terminal API
 * Full-featured chat with scrolling, history, and flicker-free streaming
 * 
 * Run with: ANTHROPIC_API_KEY=your-key npm run example:chat-terminal
 */

import Anthropic from '@anthropic-ai/sdk';
import { Terminal, Colors, Style, ScreenBuffer } from '../src';
import stringWidth from 'string-width';
import GraphemeSplitter from 'grapheme-splitter';

const splitter = new GraphemeSplitter();

// Types
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatState {
  messages: Message[];
  input: string;
  cursorPos: number;
  scrollOffset: number;
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
}

// Styles
const styles = {
  header: { fg: Colors.cyan, bold: true } as Style,
  headerBorder: { fg: Colors.brightBlack } as Style,
  userLabel: { fg: Colors.green, bold: true } as Style,
  userText: { fg: Colors.white } as Style,
  assistantLabel: { fg: Colors.cyan, bold: true } as Style,
  assistantText: { fg: Colors.white } as Style,
  inputBorder: { fg: Colors.green } as Style,
  inputBorderStreaming: { fg: Colors.yellow } as Style,
  inputText: { fg: Colors.white } as Style,
  cursor: { fg: Colors.cyan, bold: true } as Style,
  placeholder: { fg: Colors.brightBlack } as Style,
  streaming: { fg: Colors.yellow } as Style,
  error: { fg: Colors.red } as Style,
  help: { fg: Colors.brightBlack } as Style,
  scrollIndicator: { fg: Colors.yellow } as Style,
};

// Box drawing characters
const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
};

class ClaudeChat {
  private terminal: Terminal;
  private client: Anthropic;
  private state: ChatState;
  private abortController: AbortController | null = null;

  constructor() {
    // Check API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      console.error('Usage: ANTHROPIC_API_KEY=your-key npm run example:chat-terminal');
      process.exit(1);
    }

    this.client = new Anthropic({ apiKey });
    
    this.terminal = new Terminal({ fps: 60 });
    
    this.state = {
      messages: [],
      input: '',
      cursorPos: 0,
      scrollOffset: 0,
      isStreaming: false,
      streamingContent: '',
      error: null,
    };

    this.terminal.onRender(this.render.bind(this));
    this.setupInput();
  }

  private setupInput(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key: string) => {
      this.handleInput(key);
    });

    process.on('SIGINT', () => this.quit());
  }

  private handleInput(key: string): void {
    // Escape or Ctrl+C - quit
    if (key === '\x1b' || key === '\x03') {
      this.quit();
      return;
    }

    // Don't process input while streaming (except for abort)
    if (this.state.isStreaming) {
      return;
    }

    // Enter - send message
    if (key === '\r' || key === '\n') {
      this.sendMessage();
      return;
    }

    // Backspace - delete one grapheme before cursor
    if (key === '\x7f' || key === '\b') {
      if (this.state.cursorPos > 0) {
        const graphemes = splitter.splitGraphemes(this.state.input);
        graphemes.splice(this.state.cursorPos - 1, 1);
        this.state.input = graphemes.join('');
        this.state.cursorPos--;
        this.terminal.scheduleRender();
      }
      return;
    }

    // Delete - delete one grapheme at cursor
    if (key === '\x1b[3~') {
      const graphemes = splitter.splitGraphemes(this.state.input);
      if (this.state.cursorPos < graphemes.length) {
        graphemes.splice(this.state.cursorPos, 1);
        this.state.input = graphemes.join('');
        this.terminal.scheduleRender();
      }
      return;
    }

    // Arrow keys
    if (key === '\x1b[A') { // Up - scroll up
      this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
      this.terminal.scheduleRender();
      return;
    }
    if (key === '\x1b[B') { // Down - scroll down
      this.state.scrollOffset++;
      this.terminal.scheduleRender();
      return;
    }
    if (key === '\x1b[C') { // Right
      const graphemeCount = splitter.splitGraphemes(this.state.input).length;
      this.state.cursorPos = Math.min(graphemeCount, this.state.cursorPos + 1);
      this.terminal.scheduleRender();
      return;
    }
    if (key === '\x1b[D') { // Left
      this.state.cursorPos = Math.max(0, this.state.cursorPos - 1);
      this.terminal.scheduleRender();
      return;
    }

    // Home
    if (key === '\x1b[H' || key === '\x01') {
      this.state.cursorPos = 0;
      this.terminal.scheduleRender();
      return;
    }

    // End
    if (key === '\x1b[F' || key === '\x05') {
      this.state.cursorPos = splitter.splitGraphemes(this.state.input).length;
      this.terminal.scheduleRender();
      return;
    }

    // Page Up
    if (key === '\x1b[5~') {
      const contentHeight = this.terminal.height - 6;
      this.state.scrollOffset = Math.max(0, this.state.scrollOffset - contentHeight);
      this.terminal.scheduleRender();
      return;
    }

    // Page Down
    if (key === '\x1b[6~') {
      const contentHeight = this.terminal.height - 6;
      this.state.scrollOffset += contentHeight;
      this.terminal.scheduleRender();
      return;
    }

    // Ctrl+L - clear screen / refresh
    if (key === '\x0c') {
      this.terminal.fullRefresh();
      return;
    }

    // Regular character input (including multi-byte characters like Japanese)
    // Accept if not an escape sequence and contains printable characters
    if (!key.startsWith('\x1b') && key.length > 0) {
      // Filter out control characters, keep printable chars including Unicode
      const printable = key.replace(/[\x00-\x1f\x7f]/g, '');
      if (printable) {
        // Split current input into graphemes
        const graphemes = splitter.splitGraphemes(this.state.input);
        const before = graphemes.slice(0, this.state.cursorPos);
        const after = graphemes.slice(this.state.cursorPos);
        
        // Split new input into graphemes and insert
        const newGraphemes = splitter.splitGraphemes(printable);
        this.state.input = [...before, ...newGraphemes, ...after].join('');
        this.state.cursorPos += newGraphemes.length;
        this.terminal.scheduleRender();
      }
    }
  }

  private async sendMessage(): Promise<void> {
    const content = this.state.input.trim();
    if (!content) return;

    // Add user message
    this.state.messages.push({
      role: 'user',
      content,
      timestamp: new Date(),
    });

    this.state.input = '';
    this.state.cursorPos = 0;
    this.state.isStreaming = true;
    this.state.streamingContent = '';
    this.state.error = null;
    
    // Auto-scroll to bottom
    this.scrollToBottom();
    this.terminal.scheduleRender();

    try {
      this.abortController = new AbortController();

      const stream = this.client.messages.stream({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        messages: this.state.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }, {
        signal: this.abortController.signal,
      });

      stream.on('text', (text) => {
        this.state.streamingContent += text;
        this.scrollToBottom();
        this.terminal.scheduleRender();
      });

      await stream.finalMessage();

      // Add assistant message
      this.state.messages.push({
        role: 'assistant',
        content: this.state.streamingContent,
        timestamp: new Date(),
      });

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        this.state.error = error.message;
      }
    } finally {
      this.state.isStreaming = false;
      this.state.streamingContent = '';
      this.abortController = null;
      this.terminal.scheduleRender();
    }
  }

  private scrollToBottom(): void {
    // Will be clamped in render
    this.state.scrollOffset = Number.MAX_SAFE_INTEGER;
  }

  private render(buffer: ScreenBuffer): void {
    const { width, height } = buffer;
    const headerHeight = 2;
    const inputHeight = 3;
    const contentHeight = height - headerHeight - inputHeight;

    // Header
    this.renderHeader(buffer, width);

    // Messages
    this.renderMessages(buffer, 0, headerHeight, width, contentHeight);

    // Input
    this.renderInput(buffer, 0, height - inputHeight, width, inputHeight);
  }

  private renderHeader(buffer: ScreenBuffer, width: number): void {
    // Top border
    buffer.write(0, 0, box.topLeft + box.horizontal.repeat(width - 2) + box.topRight, 
      { style: styles.headerBorder });
    
    // Title
    const title = ' Claude Chat ';
    const help = ' ESC:quit ↑↓:scroll ';
    buffer.write(0, 1, box.vertical, { style: styles.headerBorder });
    buffer.write(2, 1, title, { style: styles.header });
    buffer.write(width - help.length - 1, 1, help, { style: styles.help });
    buffer.write(width - 1, 1, box.vertical, { style: styles.headerBorder });
  }

  private renderMessages(
    buffer: ScreenBuffer, 
    x: number, 
    y: number, 
    width: number, 
    height: number
  ): void {
    // Build all lines from messages
    const lines: Array<{ text: string; style: Style }> = [];
    
    const addWrappedText = (text: string, style: Style, indent: number = 0) => {
      const maxWidth = width - 2 - indent;
      const words = text.split(' ');
      let currentLine = '';
      
      for (const word of words) {
        if (currentLine.length + word.length + 1 <= maxWidth) {
          currentLine += (currentLine ? ' ' : '') + word;
        } else {
          if (currentLine) {
            lines.push({ text: ' '.repeat(indent) + currentLine, style });
          }
          currentLine = word;
        }
      }
      if (currentLine) {
        lines.push({ text: ' '.repeat(indent) + currentLine, style });
      }
    };

    // Render each message
    for (const msg of this.state.messages) {
      if (msg.role === 'user') {
        lines.push({ text: '▶ You:', style: styles.userLabel });
        addWrappedText(msg.content, styles.userText, 2);
      } else {
        lines.push({ text: '◀ Claude:', style: styles.assistantLabel });
        addWrappedText(msg.content, styles.assistantText, 2);
      }
      lines.push({ text: '', style: styles.userText }); // Blank line
    }

    // Add streaming content
    if (this.state.isStreaming && this.state.streamingContent) {
      lines.push({ text: '◀ Claude: ●', style: styles.streaming });
      addWrappedText(this.state.streamingContent, styles.assistantText, 2);
    } else if (this.state.isStreaming) {
      lines.push({ text: '◀ Claude: ●', style: styles.streaming });
    }

    // Show error if any
    if (this.state.error) {
      lines.push({ text: `Error: ${this.state.error}`, style: styles.error });
    }

    // Show placeholder if empty
    if (lines.length === 0) {
      lines.push({ 
        text: 'Type a message to start chatting with Claude...', 
        style: styles.placeholder 
      });
    }

    // Clamp scroll offset
    const maxScroll = Math.max(0, lines.length - height);
    this.state.scrollOffset = Math.min(this.state.scrollOffset, maxScroll);
    
    // Render visible lines
    const visibleLines = lines.slice(this.state.scrollOffset, this.state.scrollOffset + height);
    
    for (let i = 0; i < height; i++) {
      const line = visibleLines[i];
      if (line) {
        buffer.write(x + 1, y + i, line.text.slice(0, width - 2), { style: line.style });
      }
    }

    // Scroll indicator
    if (maxScroll > 0) {
      const scrollPercent = this.state.scrollOffset / maxScroll;
      const indicatorPos = Math.floor(scrollPercent * (height - 1));
      buffer.write(width - 1, y + indicatorPos, '█', { style: styles.scrollIndicator });
    }
  }

  private renderInput(
    buffer: ScreenBuffer, 
    x: number, 
    y: number, 
    width: number, 
    height: number
  ): void {
    const borderStyle = this.state.isStreaming ? styles.inputBorderStreaming : styles.inputBorder;
    
    // Top border
    buffer.write(x, y, box.topLeft + box.horizontal.repeat(width - 2) + box.topRight, 
      { style: borderStyle });
    
    // Input line
    buffer.write(x, y + 1, box.vertical, { style: borderStyle });
    buffer.write(x + width - 1, y + 1, box.vertical, { style: borderStyle });
    
    // Bottom border
    buffer.write(x, y + 2, box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight, 
      { style: borderStyle });

    // Prompt
    const prompt = this.state.isStreaming ? ' ● ' : ' > ';
    buffer.write(x + 1, y + 1, prompt, { style: borderStyle });

    // Input text
    const inputX = x + 4;
    const inputWidth = width - 6;
    
    if (this.state.isStreaming) {
      buffer.write(inputX, y + 1, 'Streaming response...', { style: styles.streaming });
    } else if (this.state.input) {
      // Split input into graphemes for proper Unicode handling
      const graphemes = splitter.splitGraphemes(this.state.input);
      
      // Calculate display width up to cursor position
      let cursorDisplayPos = 0;
      for (let i = 0; i < this.state.cursorPos && i < graphemes.length; i++) {
        cursorDisplayPos += stringWidth(graphemes[i]);
      }
      
      // Calculate visible start position (in graphemes)
      let visibleStart = 0;
      let displayOffset = 0;
      
      if (cursorDisplayPos >= inputWidth) {
        // Need to scroll - find the starting grapheme
        let accWidth = 0;
        for (let i = 0; i < graphemes.length; i++) {
          const gWidth = stringWidth(graphemes[i]);
          if (cursorDisplayPos - accWidth < inputWidth) {
            visibleStart = i;
            displayOffset = accWidth;
            break;
          }
          accWidth += gWidth;
        }
      }
      
      // Build visible string that fits within inputWidth
      let visibleStr = '';
      let visibleWidth = 0;
      for (let i = visibleStart; i < graphemes.length; i++) {
        const gWidth = stringWidth(graphemes[i]);
        if (visibleWidth + gWidth > inputWidth) break;
        visibleStr += graphemes[i];
        visibleWidth += gWidth;
      }
      
      buffer.write(inputX, y + 1, visibleStr, { style: styles.inputText });
      
      // Cursor position (in display columns)
      const cursorX = inputX + (cursorDisplayPos - displayOffset);
      if (cursorX < x + width - 1) {
        buffer.write(cursorX, y + 1, '▋', { style: styles.cursor });
        // Set native cursor position for IME input
        buffer.setCursorPosition(cursorX, y + 1);
      }
    } else {
      // Cursor first, then placeholder
      buffer.write(inputX, y + 1, '▋', { style: styles.cursor });
      // Set native cursor position for IME input
      buffer.setCursorPosition(inputX, y + 1);
      buffer.write(inputX + 1, y + 1, 'Type your message...', { style: styles.placeholder });
    }
  }

  private quit(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    
    this.terminal.destroy();
    
    console.log('\nGoodbye!');
    process.exit(0);
  }

  start(): void {
    this.terminal.renderNow();
  }
}

// Start the chat
const chat = new ClaudeChat();
chat.start();
