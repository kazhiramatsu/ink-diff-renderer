/**
 * Claude Chat - Advanced Demo with Claude Code-level input
 * 
 * Features:
 * - Multi-line input (Shift+Enter for newline, Enter to send)
 * - Full cursor movement (arrows, Home/End, Ctrl+A/E)
 * - Word-level navigation (Ctrl+Left/Right, Alt+Left/Right)
 * - Line editing (Ctrl+U, Ctrl+K, Ctrl+W)
 * - Input history (Up/Down arrows)
 * - Japanese input (IME) support
 * - Clipboard paste (Ctrl+V)
 * - Scrollable message history
 * 
 * Run with: ANTHROPIC_API_KEY=your-key npm run example:chat-advanced
 */

import Anthropic from '@anthropic-ai/sdk';
import { 
  Terminal, 
  Colors, 
  Style, 
  ScreenBuffer,
  Editor,
  EditorStyles,
} from '../src';
import stringWidth from 'string-width';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Types
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Styles
const styles = {
  header: { fg: Colors.cyan, bold: true } as Style,
  headerBorder: { fg: Colors.brightBlack } as Style,
  userLabel: { fg: Colors.green, bold: true } as Style,
  userText: { fg: Colors.white } as Style,
  assistantLabel: { fg: Colors.cyan, bold: true } as Style,
  assistantText: { fg: Colors.white } as Style,
  streaming: { fg: Colors.yellow } as Style,
  error: { fg: Colors.red } as Style,
  help: { fg: Colors.brightBlack } as Style,
  inputBorder: { fg: Colors.green } as Style,
  inputBorderStreaming: { fg: Colors.yellow } as Style,
  scrollIndicator: { fg: Colors.yellow } as Style,
};

const editorStyles: Partial<EditorStyles> = {
  text: { fg: Colors.white },
  placeholder: { fg: Colors.brightBlack },
  cursor: { fg: Colors.cyan, bold: true },
  prompt: { fg: Colors.green, bold: true },
  continuationPrompt: { fg: Colors.brightBlack },
};

// Box drawing
const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
};

// Clipboard handling
async function getClipboard(): Promise<string> {
  try {
    // macOS
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync('pbpaste');
      return stdout;
    }
    // Linux with xclip
    if (process.platform === 'linux') {
      const { stdout } = await execAsync('xclip -selection clipboard -o');
      return stdout;
    }
    // Windows
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('powershell.exe -command "Get-Clipboard"');
      return stdout;
    }
  } catch (e) {
    // Clipboard access failed
  }
  return '';
}

class ClaudeChatAdvanced {
  private terminal: Terminal;
  private client: Anthropic;
  private editor: Editor;
  
  private messages: Message[] = [];
  private messagesScrollOffset: number = 0;
  private isStreaming: boolean = false;
  private streamingContent: string = '';
  private error: string | null = null;
  private abortController: AbortController | null = null;
  
  constructor() {
    // Check API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      console.error('Usage: ANTHROPIC_API_KEY=your-key npm run example:chat-advanced');
      process.exit(1);
    }

    this.client = new Anthropic({ apiKey });
    this.terminal = new Terminal({ fps: 60 });
    
    // Initialize editor with advanced options
    this.editor = new Editor({
      placeholder: 'Type your message... (Enter to send, Shift+Enter for newline)',
      maxVisibleLines: 5,
      enableHistory: true,
      historyMaxSize: 100,
      prompt: ' > ',
      continuationPrompt: '   ',
      keyBindings: {
        submitOnEnter: true,      // Enter sends, Shift+Enter for newline
        enableEmacs: true,        // Enable Ctrl+A, Ctrl+E, etc.
        enableHistory: true,
      },
    });
    
    this.editor.setStyles(editorStyles);
    
    // Set up editor callbacks
    this.editor.setCallbacks({
      onSubmit: (text) => this.handleSubmit(text),
      onCancel: () => this.handleCancel(),
      onChange: () => this.terminal.scheduleRender(),
      onPaste: () => getClipboard(),
    });

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
    // Global shortcuts (work even during streaming)
    if (key === '\x1b' || key === '\x03') { // ESC or Ctrl+C
      if (this.isStreaming) {
        this.abortController?.abort();
        return;
      }
      this.quit();
      return;
    }

    // Page up/down for message scrolling
    if (key === '\x1b[5~') { // Page Up
      this.scrollMessages(-10);
      this.terminal.scheduleRender();
      return;
    }
    if (key === '\x1b[6~') { // Page Down
      this.scrollMessages(10);
      this.terminal.scheduleRender();
      return;
    }

    // Ctrl+L - refresh
    if (key === '\x0c') {
      this.terminal.fullRefresh();
      return;
    }

    // Don't process editor input while streaming
    if (this.isStreaming) {
      return;
    }

    // Debug: log raw key codes
    // const codes = [...key].map(c => c.charCodeAt(0).toString(16)).join(' ');
    // console.error(`Key: [${codes}]`);

    // Pass to editor
    this.editor.handleInput(key);
    this.terminal.scheduleRender();
  }

  private scrollMessages(delta: number): void {
    this.messagesScrollOffset = Math.max(0, this.messagesScrollOffset + delta);
  }

  private async handleSubmit(text: string): Promise<void> {
    if (!text.trim()) return;

    // Add user message
    this.messages.push({
      role: 'user',
      content: text,
      timestamp: new Date(),
    });

    this.editor.clear();
    this.isStreaming = true;
    this.streamingContent = '';
    this.error = null;
    this.scrollToBottom();
    this.terminal.scheduleRender();

    try {
      this.abortController = new AbortController();

      const stream = this.client.messages.stream({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: this.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }, {
        signal: this.abortController.signal,
      });

      stream.on('text', (text) => {
        this.streamingContent += text;
        this.scrollToBottom();
        this.terminal.scheduleRender();
      });

      await stream.finalMessage();

      // Add assistant message
      this.messages.push({
        role: 'assistant',
        content: this.streamingContent,
        timestamp: new Date(),
      });

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        this.error = error.message;
      }
    } finally {
      this.isStreaming = false;
      this.streamingContent = '';
      this.abortController = null;
      this.terminal.scheduleRender();
    }
  }

  private handleCancel(): void {
    if (this.editor.isEmpty) {
      this.quit();
    } else {
      this.editor.clear();
      this.terminal.scheduleRender();
    }
  }

  private scrollToBottom(): void {
    this.messagesScrollOffset = Number.MAX_SAFE_INTEGER;
  }

  private render(buffer: ScreenBuffer): void {
    const { width, height } = buffer;
    
    // Layout calculation
    const headerHeight = 2;
    const editorHeight = Math.min(7, Math.max(3, this.editor.lineCount + 2));
    const messagesHeight = height - headerHeight - editorHeight;

    // Render sections
    this.renderHeader(buffer, 0, 0, width);
    this.renderMessages(buffer, 0, headerHeight, width, messagesHeight);
    this.renderEditor(buffer, 0, height - editorHeight, width, editorHeight);
  }

  private renderHeader(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    // Border
    buffer.write(x, y, box.topLeft + box.horizontal.repeat(width - 2) + box.topRight, 
      { style: styles.headerBorder });
    
    // Content
    const title = ' Claude Chat (Advanced) ';
    const help = this.isStreaming 
      ? ' [Streaming... ESC to cancel] '
      : ' ESC:quit  PgUp/Dn:scroll  Enter:send  Shift+Enter:newline ';
    
    buffer.write(x, y + 1, box.vertical, { style: styles.headerBorder });
    buffer.write(x + 2, y + 1, title, { style: styles.header });
    
    const helpX = width - stringWidth(help) - 1;
    if (helpX > stringWidth(title) + 3) {
      buffer.write(helpX, y + 1, help, { style: styles.help });
    }
    
    buffer.write(x + width - 1, y + 1, box.vertical, { style: styles.headerBorder });
  }

  private renderMessages(
    buffer: ScreenBuffer, 
    x: number, 
    y: number, 
    width: number, 
    height: number
  ): void {
    // Build all display lines
    const lines: Array<{ text: string; style: Style }> = [];
    const contentWidth = width - 2;

    const addWrapped = (text: string, style: Style, indent: number = 0) => {
      const maxWidth = contentWidth - indent;
      let currentLine = '';
      let currentWidth = 0;

      for (const char of text) {
        if (char === '\n') {
          lines.push({ text: ' '.repeat(indent) + currentLine, style });
          currentLine = '';
          currentWidth = 0;
          continue;
        }

        const charWidth = stringWidth(char);
        if (currentWidth + charWidth > maxWidth) {
          lines.push({ text: ' '.repeat(indent) + currentLine, style });
          currentLine = char;
          currentWidth = charWidth;
        } else {
          currentLine += char;
          currentWidth += charWidth;
        }
      }
      
      if (currentLine) {
        lines.push({ text: ' '.repeat(indent) + currentLine, style });
      }
    };

    // Render messages
    for (const msg of this.messages) {
      if (msg.role === 'user') {
        lines.push({ text: '▶ You:', style: styles.userLabel });
        addWrapped(msg.content, styles.userText, 2);
      } else {
        lines.push({ text: '◀ Claude:', style: styles.assistantLabel });
        addWrapped(msg.content, styles.assistantText, 2);
      }
      lines.push({ text: '', style: styles.userText });
    }

    // Streaming content
    if (this.isStreaming) {
      if (this.streamingContent) {
        lines.push({ text: '◀ Claude: ●', style: styles.streaming });
        addWrapped(this.streamingContent, styles.assistantText, 2);
      } else {
        lines.push({ text: '◀ Claude: ● Thinking...', style: styles.streaming });
      }
    }

    // Error
    if (this.error) {
      lines.push({ text: `Error: ${this.error}`, style: styles.error });
    }

    // Empty state
    if (lines.length === 0) {
      lines.push({ 
        text: 'Start a conversation with Claude...', 
        style: styles.help 
      });
    }

    // Clamp scroll
    const maxScroll = Math.max(0, lines.length - height);
    this.messagesScrollOffset = Math.min(this.messagesScrollOffset, maxScroll);

    // Render visible lines
    const visible = lines.slice(this.messagesScrollOffset, this.messagesScrollOffset + height);
    
    for (let i = 0; i < height; i++) {
      const line = visible[i];
      if (line) {
        buffer.write(x + 1, y + i, line.text.slice(0, contentWidth), { style: line.style });
      }
    }

    // Scroll indicator
    if (maxScroll > 0) {
      const scrollPercent = this.messagesScrollOffset / maxScroll;
      const indicatorY = y + Math.floor(scrollPercent * (height - 1));
      buffer.write(x + width - 1, indicatorY, '█', { style: styles.scrollIndicator });
    }
  }

  private renderEditor(
    buffer: ScreenBuffer, 
    x: number, 
    y: number, 
    width: number, 
    height: number
  ): void {
    const borderStyle = this.isStreaming ? styles.inputBorderStreaming : styles.inputBorder;

    // Top border
    buffer.write(x, y, box.topLeft + box.horizontal.repeat(width - 2) + box.topRight, 
      { style: borderStyle });

    // Side borders
    for (let i = 1; i < height - 1; i++) {
      buffer.write(x, y + i, box.vertical, { style: borderStyle });
      buffer.write(x + width - 1, y + i, box.vertical, { style: borderStyle });
    }

    // Bottom border
    buffer.write(x, y + height - 1, 
      box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight, 
      { style: borderStyle });

    // Editor content
    if (this.isStreaming) {
      buffer.write(x + 2, y + 1, '● Waiting for response...', { style: styles.streaming });
    } else {
      this.editor.render(buffer, x + 1, y + 1, width - 2, height - 2);
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

// Start
const chat = new ClaudeChatAdvanced();
chat.start();
