/**
 * Claude Code-style Chat with Scrollback Support
 */

import Anthropic from '@anthropic-ai/sdk';
import { 
  ScrollbackTerminal,
  Colors, 
  Style, 
  ScreenBuffer,
  Editor,
  EditorStyles,
  EMPTY_STYLE,
} from '../src';
import {
  tools,
  ToolExecutor,
  ToolResult,
  AgentType,
  AgentInput,
  SubagentInput,
  Agent,
  isToolUseBlock,
  getToolIcon,
} from '../src/tools';
import stringWidth from 'string-width';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Types
interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  timestamp: Date;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface ToolExecution {
  id: string;
  name: string;
  input: any;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: ToolResult;
  progress?: string;
}

// Theme
const theme = {
  text: { fg: 255 } as Style,
  textMuted: { fg: 245 } as Style,
  textDim: { fg: 240 } as Style,
  accent: { fg: 183 } as Style,
  accentBold: { fg: 183, bold: true } as Style,
  success: { fg: 114 } as Style,
  error: { fg: 203 } as Style,
  warning: { fg: 221 } as Style,
  info: { fg: 117 } as Style,
  border: { fg: 238 } as Style,
  prompt: { fg: 114 } as Style,
  toolName: { fg: 221 } as Style,
  toolRunning: { fg: 117 } as Style,
  toolSuccess: { fg: 114 } as Style,
  toolError: { fg: 203 } as Style,
};

// Editor styles
const editorStyles: EditorStyles = {
  text: theme.text,
  placeholder: theme.textDim,
  cursor: { bg: 255, fg: 0 },
  prompt: theme.prompt,
  continuationPrompt: theme.textDim,
  lineNumber: theme.textDim,
  selection: { bg: 183, fg: 0 },
};

// Spinner (star-based like Claude Code)
const spinnerFrames = ['✶', '✳', '✴', '✳'];

// Clipboard
async function getClipboard(): Promise<string> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync('pbpaste');
      return stdout;
    } else if (process.platform === 'linux') {
      const { stdout } = await execAsync('xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null');
      return stdout;
    }
  } catch (e) {}
  return '';
}

class ClaudeCodeChat {
  private terminal: ScrollbackTerminal;
  private client: Anthropic;
  private editor: Editor;
  private toolExecutor: ToolExecutor;
  
  private messages: Message[] = [];
  private currentToolExecutions: Map<string, ToolExecution> = new Map();
  private isStreaming = false;
  private streamingContent = '';
  private abortController: AbortController | null = null;
  private spinnerFrame = 0;
  private spinnerInterval: NodeJS.Timeout | null = null;
  
  // Token tracking
  private streamStartTime = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  
  // Pricing
  private readonly INPUT_COST_PER_M = 3.00;
  private readonly OUTPUT_COST_PER_M = 15.00;
  
  // Layout:
  // Line 0: Status (spinner during streaming, empty when idle)
  // Line 1: Top border
  // Line 2: Editor
  // Line 3: Bottom border
  // Line 4: Hints
  private readonly FIXED_HEIGHT = 5;
  
  // Buffer for current streaming line (not yet committed)
  private currentLine = '';
  
  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      console.error('Usage: ANTHROPIC_API_KEY=your-key npm run example:claude-code');
      process.exit(1);
    }

    this.client = new Anthropic({ apiKey });
    this.terminal = new ScrollbackTerminal({ 
      fps: 30,
      inputHeight: this.FIXED_HEIGHT,
    });
    this.toolExecutor = new ToolExecutor();
    
    this.toolExecutor.setAgentHandler(
      (agentType: AgentType, input: AgentInput | SubagentInput, onProgress?: (msg: string) => void) => 
        this.executeAgent(agentType, input, onProgress)
    );
    
    this.editor = new Editor({
      placeholder: 'Type a message...',
      maxVisibleLines: 1,
      enableHistory: true,
      historyMaxSize: 100,
      prompt: '❯ ',
      continuationPrompt: '  ',
      useNativeCursor: true,
      keyBindings: {
        submitOnEnter: true,
        enableEmacs: true,
        enableHistory: true,
      },
    });
    
    this.editor.setStyles(editorStyles);
    
    this.editor.setCallbacks({
      onSubmit: (text) => this.handleSubmit(text),
      onCancel: () => this.handleCancel(),
      onChange: () => this.terminal.scheduleRender(),
      onPaste: () => getClipboard(),
    });

    this.terminal.onRender(this.renderFixed.bind(this));
    this.setupInput();
    this.writeWelcome();
  }

  private writeWelcome(): void {
    this.terminal.writeLine('', EMPTY_STYLE);
    this.terminal.writeLine(' Claude Code', theme.accentBold);
    this.terminal.writeLine(' Type a message to start • Ctrl+C to exit', theme.textDim);
    this.terminal.writeLine('', EMPTY_STYLE);
  }

  private setupInput(): void {
    this.terminal.enableRawMode();
    
    process.stdin.on('data', (data: Buffer) => {
      if (this.isStreaming) {
        // ESC to cancel streaming
        if (data[0] === 0x1b && data.length === 1) {
          this.abortController?.abort();
          return;
        }
        return;
      }
      
      // Ctrl+C to exit
      if (data[0] === 0x03) {
        this.quit();
        return;
      }
      
      this.editor.handleInput(data.toString());
      this.terminal.scheduleRender();
    });
  }

  private quit(): void {
    this.terminal.disableRawMode();
    this.terminal.destroy();
    process.exit(0);
  }

  private async handleSubmit(text: string): Promise<void> {
    if (!text.trim()) return;
    
    this.messages.push({ role: 'user', content: text, timestamp: new Date() });
    this.writeUserMessage(text);
    this.editor.clear();
    await this.runConversation();
  }

  private handleCancel(): void {
    if (this.editor.isEmpty) {
      this.quit();
    } else {
      this.editor.clear();
      this.terminal.scheduleRender();
    }
  }

  // Text wrapping utility
  private wrapText(text: string, width: number, indent: string = ''): string[] {
    if (width <= 0) return [text];
    const effectiveWidth = width - stringWidth(indent);
    if (effectiveWidth <= 0) return [text];
    
    const result: string[] = [];
    let currentLine = '';
    let currentWidth = 0;
    
    for (const word of text.split(/(\s+)/)) {
      const wordWidth = stringWidth(word);
      
      if (currentWidth + wordWidth <= effectiveWidth) {
        currentLine += word;
        currentWidth += wordWidth;
      } else {
        if (currentLine) result.push(indent + currentLine);
        
        if (wordWidth > effectiveWidth) {
          let remaining = word;
          while (remaining) {
            let chunk = '';
            let chunkWidth = 0;
            for (const char of remaining) {
              const charWidth = stringWidth(char);
              if (chunkWidth + charWidth <= effectiveWidth) {
                chunk += char;
                chunkWidth += charWidth;
              } else break;
            }
            if (chunk) {
              result.push(indent + chunk);
              remaining = remaining.slice(chunk.length);
            } else {
              result.push(indent + remaining[0]);
              remaining = remaining.slice(1);
            }
          }
          currentLine = '';
          currentWidth = 0;
        } else {
          currentLine = word.trimStart();
          currentWidth = stringWidth(currentLine);
        }
      }
    }
    
    if (currentLine) result.push(indent + currentLine);
    return result.length > 0 ? result : [''];
  }

  private writeUserMessage(text: string): void {
    this.terminal.writeLine('', EMPTY_STYLE);
    const width = this.terminal.terminalWidth;
    for (const [i, line] of text.split('\n').entries()) {
      const prefix = i === 0 ? '❯ ' : '  ';
      for (const wrapped of this.wrapText(line, width, prefix)) {
        this.terminal.writeLine(wrapped, theme.prompt);
      }
    }
  }

  private writeAssistantMessage(content: string): void {
    this.terminal.writeLine('', EMPTY_STYLE);
    const width = this.terminal.terminalWidth;
    for (const line of content.replace(/\n+$/, '').split('\n')) {
      for (const wrapped of this.wrapText(line, width, '')) {
        this.terminal.writeLine(wrapped, theme.text);
      }
    }
  }

  private writeToolStart(name: string, input: any): void {
    const icon = getToolIcon(name);
    const summary = this.summarizeInput(name, input);
    this.terminal.writeLine('', EMPTY_STYLE);
    this.terminal.writeLine(`${icon} ${name}`, theme.toolName);
    if (summary) {
      this.terminal.writeLine(`  ${summary}`, theme.textDim);
    }
  }

  private writeToolResult(name: string, result: ToolResult): void {
    const width = this.terminal.terminalWidth;
    const output = result.success ? result.output : (result.error || 'Error');
    if (output) {
      const outputLines = output.split('\n').slice(0, 5);
      for (const line of outputLines) {
        for (const wrapped of this.wrapText(line, width, '  ')) {
          this.terminal.writeLine(wrapped, theme.textMuted);
        }
      }
      const total = output.split('\n').length;
      if (total > 5) {
        this.terminal.writeLine(`  ... ${total - 5} more lines`, theme.textDim);
      }
    }
  }

  private async runConversation(): Promise<void> {
    this.isStreaming = true;
    this.streamingContent = '';
    this.currentLine = '';
    this.currentToolExecutions.clear();
    this.abortController = new AbortController();
    this.streamStartTime = Date.now();
    this.inputTokens = 0;
    this.outputTokens = 0;
    
    this.terminal.clearInputArea();
    this.terminal.writeLine('', EMPTY_STYLE);  // Space between user message and assistant response
    this.startSpinner();
    this.terminal.scheduleRender();

    try {
      const systemPrompt = `You are Claude, an AI assistant. Be concise and helpful.\n\nWorking directory: ${this.toolExecutor.getWorkingDirectory()}`;
      const apiMessages = this.buildApiMessages();

      const stream = this.client.messages.stream({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools as any,
        messages: apiMessages,
      });

      let fullContent: ContentBlock[] = [];

      stream.on('text', (text: string) => {
        // Process each character
        for (const char of text) {
          if (char === '\n') {
            // Commit current line to terminal buffer
            const width = this.terminal.terminalWidth;
            const wrappedLines = this.wrapText(this.currentLine, width, '');
            
            for (const wrapped of wrappedLines) {
              this.terminal.writeLine(wrapped, theme.text);
            }
            
            this.streamingContent += this.currentLine + '\n';
            this.currentLine = '';
          } else {
            this.currentLine += char;
          }
        }
        this.terminal.scheduleRender();
      });
      
      (stream as any).on('message', (msg: any) => {
        if (msg.usage) {
          this.inputTokens = msg.usage.input_tokens || 0;
          this.outputTokens = msg.usage.output_tokens || 0;
          this.terminal.scheduleRender();
        }
      });

      (stream as any).on('contentBlockStart', (block: any) => {
        if (block.type === 'tool_use' && block.id) {
          this.currentToolExecutions.set(block.id, {
            id: block.id,
            name: block.name || 'unknown',
            input: {},
            status: 'pending',
          });
          this.terminal.scheduleRender();
        }
      });

      (stream as any).on('inputJson', (json: any, snapshot: any) => {
        const toolUse = Array.from(this.currentToolExecutions.values()).find(t => t.status === 'pending');
        if (toolUse) {
          toolUse.input = snapshot;
          this.terminal.scheduleRender();
        }
      });

      const response = await stream.finalMessage();
      
      if (response.usage) {
        this.inputTokens = response.usage.input_tokens;
        this.outputTokens = response.usage.output_tokens;
        this.totalInputTokens += this.inputTokens;
        this.totalOutputTokens += this.outputTokens;
      }

      for (const block of response.content) {
        if (block.type === 'text') {
          fullContent.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          fullContent.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
        }
      }

      this.messages.push({ role: 'assistant', content: fullContent, timestamp: new Date() });

      // Commit any remaining current line (text without trailing newline)
      if (this.currentLine) {
        const width = this.terminal.terminalWidth;
        for (const wrapped of this.wrapText(this.currentLine, width, '')) {
          this.terminal.writeLine(wrapped, theme.text);
        }
        this.streamingContent += this.currentLine;
        this.currentLine = '';
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(isToolUseBlock);
        this.stopSpinner();
        this.streamingContent = '';
        this.currentLine = '';
        this.terminal.clearInputArea();
        
        await this.executeTools(toolUseBlocks);
        
        this.startSpinner();
        await this.runConversation();
        return;
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        this.terminal.writeLine('', EMPTY_STYLE);
        this.terminal.writeLine(`Error: ${error.message}`, theme.error);
      }
    } finally {
      this.stopSpinner();
      this.isStreaming = false;
      this.streamingContent = '';
      this.currentLine = '';
      this.currentToolExecutions.clear();
      this.terminal.clearInputArea();
      this.terminal.scheduleRender();
    }
  }

  private async executeTools(toolUseBlocks: any[]): Promise<void> {
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        const execution = this.currentToolExecutions.get(toolUse.id);
        if (execution) execution.status = 'running';

        this.writeToolStart(toolUse.name, toolUse.input);

        const result = await this.toolExecutor.execute(
          toolUse.name,
          toolUse.input,
          (progress: string) => {
            if (execution) {
              execution.progress = progress;
              this.terminal.scheduleRender();
            }
          }
        );

        if (execution) {
          execution.status = result.success ? 'completed' : 'error';
          execution.result = result;
        }

        this.writeToolResult(toolUse.name, result);

        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: result.success ? (result.output || 'Done') : `Error: ${result.error}`,
          is_error: !result.success,
        };
      })
    );

    this.messages.push({ role: 'user', content: toolResults, timestamp: new Date() });
  }

  private buildApiMessages(): any[] {
    return this.messages.map(msg => {
      if (msg.role === 'user') {
        return { role: 'user', content: msg.content };
      } else {
        if (typeof msg.content === 'string') {
          return { role: 'assistant', content: msg.content };
        }
        const blocks = msg.content.map(block => {
          if (block.type === 'text') return { type: 'text', text: block.text };
          if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
          return block;
        });
        return { role: 'assistant', content: blocks };
      }
    });
  }

  private async executeAgent(
    agentType: AgentType,
    input: AgentInput | SubagentInput,
    onProgress?: (msg: string) => void
  ): Promise<ToolResult> {
    try {
      const agent = new Agent(this.client, this.toolExecutor, agentType, { onProgress });
      const result = await agent.execute(input);
      return { success: result.success, output: result.output || '', error: result.error };
    } catch (error: any) {
      return { success: false, output: '', error: `${agentType} agent error: ${error.message}` };
    }
  }

  private startSpinner(): void {
    this.spinnerFrame = 0;
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % spinnerFrames.length;
      this.terminal.scheduleRender();
    }, 150);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  private formatElapsed(): string {
    const elapsed = Date.now() - this.streamStartTime;
    const seconds = Math.floor(elapsed / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  private formatTokens(count: number): string {
    return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
  }

  private calculateCost(inputTokens: number, outputTokens: number): string {
    const total = (inputTokens / 1_000_000) * this.INPUT_COST_PER_M + 
                  (outputTokens / 1_000_000) * this.OUTPUT_COST_PER_M;
    return total < 0.01 ? `$${total.toFixed(4)}` : `$${total.toFixed(2)}`;
  }

  /**
   * Render the fixed area at bottom
   * Layout:
   *   Line 0: Status (spinner during streaming, empty when idle)
   *   Line 1: Top border
   *   Line 2: Editor / current streaming line
   *   Line 3: Bottom border
   *   Line 4: Hints / pending lines indicator
   */
  private renderFixed(buffer: ScreenBuffer, width: number, height: number): void {
    const borderLine = '─'.repeat(width);
    
    // Line 0: Status (only during streaming)
    if (this.isStreaming) {
      const spinner = spinnerFrames[this.spinnerFrame];
      
      let status = `${spinner} `;
      const runningTool = Array.from(this.currentToolExecutions.values()).find(t => t.status === 'running');
      if (runningTool) {
        status += `${runningTool.name}`;
        if (runningTool.progress) status += `… ${runningTool.progress.slice(0, 30)}`;
        else status += '…';
      } else {
        status += 'Thinking…';
      }
      
      status += ' (Esc to interrupt)';
      
      buffer.write(0, 0, status, { style: theme.textDim });
    }
    
    // Line 1: Top border
    buffer.write(0, 1, borderLine, { style: theme.border });
    
    // Line 2: Editor
    if (this.isStreaming) {
      // Show empty prompt during streaming
      buffer.write(0, 2, '❯', { style: theme.prompt });
    } else {
      this.editor.render(buffer, 0, 2, width, 1);
    }
    
    // Line 3: Bottom border
    buffer.write(0, 3, borderLine, { style: theme.border });
    
    // Line 4: Hints
    buffer.write(2, 4, '? for shortcuts', { style: theme.textDim });
    
    // Session stats on the right
    if (this.totalInputTokens > 0 || this.totalOutputTokens > 0) {
      const totalTokens = `${this.formatTokens(this.totalInputTokens)}→${this.formatTokens(this.totalOutputTokens)}`;
      const totalCost = this.calculateCost(this.totalInputTokens, this.totalOutputTokens);
      const stats = `${totalTokens} │ ${totalCost}`;
      const statsX = width - stats.length - 2;
      if (statsX > 20) buffer.write(statsX, 4, stats, { style: theme.textDim });
    }
  }

  private summarizeInput(toolName: string, input: any): string {
    switch (toolName) {
      case 'bash':
        const cmd = (input.command || '').slice(0, 50);
        return `$ ${cmd}${input.command?.length > 50 ? '...' : ''}`;
      case 'view': return input.file_path || '';
      case 'write': return `${input.file_path} (${input.content?.length || 0} chars)`;
      case 'edit': return input.file_path || '';
      case 'glob': return `${input.pattern}${input.path ? ` in ${input.path}` : ''}`;
      case 'grep': return `"${input.pattern}"${input.include ? ` in ${input.include}` : ''}`;
      case 'ls': return input.path || '.';
      case 'task': case 'explore': case 'plan': case 'code': case 'debug':
        const prompt = input.prompt || input.task || '';
        return prompt.slice(0, 40) + (prompt.length > 40 ? '...' : '');
      default: return '';
    }
  }

  run(): void {
    this.terminal.scheduleRender();
  }
}

// Main
const chat = new ClaudeCodeChat();
chat.run();
