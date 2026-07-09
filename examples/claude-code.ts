/**
 * Claude Code-style Chat with Tool Execution
 * 
 * Features:
 * - All features from claude-chat-advanced
 * - Claude Code-compatible tools: bash, view, write, edit, multiedit, glob, grep, ls
 * - Task tool for complex autonomous sub-tasks (Claude Code compatible)
 * - Jupyter notebook editing (notebook_read, notebook_edit)
 * - TODO list management (todo_read, todo_write)
 * - Tool call display with collapsible results
 * - Parallel tool execution with progress tracking
 * - Automatic tool result handling loop
 * 
 * Run with: ANTHROPIC_API_KEY=your-key npm run example:claude-code
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
import {
  tools,
  subagentTools,
  ToolExecutor,
  ToolUseBlock,
  ToolResultBlock,
  ToolResult,
  AgentType,
  AgentInput,
  TaskInput,
  SubagentInput,
  SubagentResult,
  Agent,
  Subagent,
  isToolUseBlock,
  formatToolResult,
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
  collapsed: boolean;
  progress?: string; // For subagent progress updates
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
  // Tool styles
  toolHeader: { fg: Colors.magenta, bold: true } as Style,
  // Subagent styles
  subagentHeader: { fg: Colors.blue, bold: true } as Style,
  subagentProgress: { fg: Colors.brightBlue } as Style,
  toolName: { fg: Colors.yellow } as Style,
  toolRunning: { fg: Colors.yellow } as Style,
  toolSuccess: { fg: Colors.green } as Style,
  toolError: { fg: Colors.red } as Style,
  toolOutput: { fg: Colors.brightBlack } as Style,
  toolBorder: { fg: Colors.brightBlack } as Style,
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
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync('pbpaste');
      return stdout;
    }
    if (process.platform === 'linux') {
      const { stdout } = await execAsync('xclip -selection clipboard -o');
      return stdout;
    }
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('powershell.exe -command "Get-Clipboard"');
      return stdout;
    }
  } catch (e) {}
  return '';
}

class ClaudeCodeChat {
  private terminal: Terminal;
  private client: Anthropic;
  private editor: Editor;
  private toolExecutor: ToolExecutor;
  
  private messages: Message[] = [];
  private toolExecutions: Map<string, ToolExecution> = new Map();
  private messagesScrollOffset: number = 0;
  private isStreaming: boolean = false;
  private streamingContent: string = '';
  private error: string | null = null;
  private abortController: AbortController | null = null;
  private spinnerFrame: number = 0;
  private spinnerInterval: NodeJS.Timeout | null = null;
  
  private readonly spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  
  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      console.error('Usage: ANTHROPIC_API_KEY=your-key npm run example:claude-code');
      process.exit(1);
    }

    this.client = new Anthropic({ apiKey });
    this.terminal = new Terminal({ fps: 60 });
    this.toolExecutor = new ToolExecutor();
    
    // Set up agent handler for Task, Explore, Plan, Code, Debug
    this.toolExecutor.setAgentHandler(
      (agentType: AgentType, input: AgentInput | SubagentInput, onProgress?: (msg: string) => void) => 
        this.executeAgent(agentType, input, onProgress)
    );
    
    this.editor = new Editor({
      placeholder: 'Type your message... (Enter to send, Shift+Enter for newline)',
      maxVisibleLines: 5,
      enableHistory: true,
      historyMaxSize: 100,
      prompt: ' > ',
      continuationPrompt: '   ',
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
    // Global shortcuts
    if (key === '\x1b' || key === '\x03') {
      if (this.isStreaming) {
        this.abortController?.abort();
        return;
      }
      this.quit();
      return;
    }

    // Page up/down for scrolling
    if (key === '\x1b[5~') {
      this.scrollMessages(-10);
      this.terminal.scheduleRender();
      return;
    }
    if (key === '\x1b[6~') {
      this.scrollMessages(10);
      this.terminal.scheduleRender();
      return;
    }

    // Ctrl+L - refresh
    if (key === '\x0c') {
      this.terminal.fullRefresh();
      return;
    }

    if (this.isStreaming) {
      return;
    }

    this.editor.handleInput(key);
    this.terminal.scheduleRender();
  }

  private scrollMessages(delta: number): void {
    this.messagesScrollOffset = Math.max(0, this.messagesScrollOffset + delta);
  }

  private startSpinner(): void {
    if (this.spinnerInterval) return;
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % this.spinnerChars.length;
      this.terminal.scheduleRender();
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  private async handleSubmit(text: string): Promise<void> {
    if (!text.trim()) return;

    this.messages.push({
      role: 'user',
      content: text,
      timestamp: new Date(),
    });

    this.editor.clear();
    this.error = null;
    this.scrollToBottom();
    
    await this.runConversation();
  }

  private async runConversation(): Promise<void> {
    this.isStreaming = true;
    this.streamingContent = '';
    this.startSpinner();
    this.terminal.scheduleRender();

    try {
      this.abortController = new AbortController();

      // Build messages for API
      const apiMessages = this.buildApiMessages();

      const response = await this.client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        tools: tools,
        messages: apiMessages,
      }, {
        signal: this.abortController.signal,
      });

      // Process response
      const contentBlocks: ContentBlock[] = [];
      const toolUseBlocks: ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          contentBlocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          contentBlocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
          toolUseBlocks.push(block as ToolUseBlock);
        }
      }

      // Add assistant message
      this.messages.push({
        role: 'assistant',
        content: contentBlocks,
        timestamp: new Date(),
      });

      this.terminal.scheduleRender();

      // Execute tools if any (parallel execution like Claude Code)
      if (toolUseBlocks.length > 0) {
        await this.executeTools(toolUseBlocks);
        
        // Continue conversation with tool results
        if (response.stop_reason === 'tool_use') {
          await this.runConversation();
          return;
        }
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        this.error = error.message;
      }
    } finally {
      this.isStreaming = false;
      this.streamingContent = '';
      this.abortController = null;
      this.stopSpinner();
      this.terminal.scheduleRender();
    }
  }

  private buildApiMessages(): any[] {
    const apiMessages: any[] = [];

    for (const msg of this.messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          apiMessages.push({ role: 'user', content: msg.content });
        } else {
          // Tool results from user
          apiMessages.push({ role: 'user', content: msg.content });
        }
      } else {
        // Assistant message
        if (typeof msg.content === 'string') {
          apiMessages.push({ role: 'assistant', content: msg.content });
        } else {
          const blocks = msg.content.map(block => {
            if (block.type === 'text') {
              return { type: 'text', text: block.text };
            } else if (block.type === 'tool_use') {
              return {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input,
              };
            }
            return block;
          });
          apiMessages.push({ role: 'assistant', content: blocks });
        }
      }
    }

    return apiMessages;
  }

  private async executeTools(toolUseBlocks: ToolUseBlock[]): Promise<void> {
    // Set all tools to pending first
    for (const toolUse of toolUseBlocks) {
      this.toolExecutions.set(toolUse.id, {
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
        status: 'pending',
        collapsed: false,
      });
    }
    this.terminal.scheduleRender();

    // Execute all tools in parallel (like Claude Code)
    const executeOne = async (toolUse: ToolUseBlock): Promise<ToolResultBlock> => {
      const execution = this.toolExecutions.get(toolUse.id);
      if (execution) {
        execution.status = 'running';
        this.terminal.scheduleRender();
      }

      // Progress callback for subagent
      const onProgress = (msg: string) => {
        if (execution) {
          execution.progress = msg;
          this.terminal.scheduleRender();
        }
      };

      const result = await this.toolExecutor.execute(toolUse.name, toolUse.input, onProgress);

      if (execution) {
        execution.status = result.success ? 'completed' : 'error';
        execution.result = result;
        execution.progress = undefined;
        this.terminal.scheduleRender();
      }

      // Format tool result content for Claude
      let content: string;
      if (result.success) {
        content = result.output || '(no output)';
      } else {
        const parts: string[] = [];
        if (result.output) {
          parts.push(`Output:\n${result.output}`);
        }
        if (result.error) {
          parts.push(`Error: ${result.error}`);
        }
        content = parts.join('\n\n') || 'Tool execution failed with unknown error';
      }

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: content,
        is_error: !result.success,
      };
    };

    // Run all tools in parallel
    const toolResults = await Promise.all(
      toolUseBlocks.map(toolUse => executeOne(toolUse))
    );

    // Add tool results as user message
    this.messages.push({
      role: 'user',
      content: toolResults as any,
      timestamp: new Date(),
    });

    this.scrollToBottom();
  }

  /**
   * Execute an agent task (Task, Explore, Plan, Code, Debug)
   * Creates a new Agent instance and runs it autonomously
   */
  private async executeAgent(
    agentType: AgentType,
    input: AgentInput | SubagentInput, 
    onProgress?: (msg: string) => void
  ): Promise<ToolResult> {
    // Create a separate tool executor for the agent (without agent tools to prevent recursion)
    const agentToolExecutor = new ToolExecutor({
      workingDirectory: this.toolExecutor.getWorkingDirectory(),
    });

    const agent = new Agent(
      this.client,
      agentToolExecutor,
      agentType,
      {
        maxIterations: 15,
        timeout: 300000, // 5 minutes
        onProgress: (message: string, toolCalls: number) => {
          onProgress?.(`${message} (${toolCalls} tools)`);
        },
      }
    );

    try {
      const result = await agent.execute(input);
      return {
        success: result.success,
        output: result.output,
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: `${agentType} agent error: ${error.message}`,
      };
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
    
    const headerHeight = 2;
    const editorHeight = Math.min(7, Math.max(3, this.editor.lineCount + 2));
    const messagesHeight = height - headerHeight - editorHeight;

    this.renderHeader(buffer, 0, 0, width);
    this.renderMessages(buffer, 0, headerHeight, width, messagesHeight);
    this.renderEditor(buffer, 0, height - editorHeight, width, editorHeight);
  }

  private renderHeader(buffer: ScreenBuffer, x: number, y: number, width: number): void {
    buffer.write(x, y, box.topLeft + box.horizontal.repeat(width - 2) + box.topRight, 
      { style: styles.headerBorder });
    
    const title = ' Claude Code ';
    const cwd = ` 📁 ${this.toolExecutor.getWorkingDirectory().slice(-30)} `;
    const help = this.isStreaming 
      ? ` ${this.spinnerChars[this.spinnerFrame]} Running... ESC to cancel `
      : ' ESC:quit  PgUp/Dn:scroll ';
    
    buffer.write(x, y + 1, box.vertical, { style: styles.headerBorder });
    buffer.write(x + 2, y + 1, title, { style: styles.header });
    
    const cwdX = x + stringWidth(title) + 4;
    buffer.write(cwdX, y + 1, cwd, { style: styles.help });
    
    const helpX = width - stringWidth(help) - 1;
    if (helpX > cwdX + stringWidth(cwd)) {
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
        if (typeof msg.content === 'string') {
          lines.push({ text: '▶ You:', style: styles.userLabel });
          addWrapped(msg.content, styles.userText, 2);
        } else {
          // Tool results - don't display in chat
          const hasToolResults = msg.content.some(b => b.type === 'tool_result');
          if (!hasToolResults) {
            lines.push({ text: '▶ You:', style: styles.userLabel });
            for (const block of msg.content) {
              if (block.type === 'text' && block.text) {
                addWrapped(block.text, styles.userText, 2);
              }
            }
          }
        }
      } else {
        // Assistant message
        lines.push({ text: '◀ Claude:', style: styles.assistantLabel });
        
        if (typeof msg.content === 'string') {
          addWrapped(msg.content, styles.assistantText, 2);
        } else {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              addWrapped(block.text, styles.assistantText, 2);
            } else if (block.type === 'tool_use' && block.id) {
              // Render tool use block
              const execution = this.toolExecutions.get(block.id);
              this.renderToolBlock(lines, block, execution, contentWidth);
            }
          }
        }
      }
      lines.push({ text: '', style: styles.userText });
    }

    // Streaming indicator
    if (this.isStreaming && !this.toolExecutions.size) {
      lines.push({ 
        text: `  ${this.spinnerChars[this.spinnerFrame]} Thinking...`, 
        style: styles.streaming 
      });
    }

    // Error
    if (this.error) {
      lines.push({ text: `Error: ${this.error}`, style: styles.error });
    }

    // Empty state
    if (lines.length === 0) {
      lines.push({ 
        text: 'Claude Code - AI assistant with tool execution', 
        style: styles.help 
      });
      lines.push({ 
        text: 'Tools: bash, view, write, edit, glob, grep, ls | Agents: Task, Explore, Plan, Code, Debug', 
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

  private renderToolBlock(
    lines: Array<{ text: string; style: Style }>,
    block: ContentBlock,
    execution: ToolExecution | undefined,
    width: number
  ): void {
    const icon = getToolIcon(block.name || '');
    const status = execution?.status || 'pending';
    
    let statusIcon: string;
    let statusStyle: Style;
    
    switch (status) {
      case 'running':
        statusIcon = this.spinnerChars[this.spinnerFrame];
        statusStyle = styles.toolRunning;
        break;
      case 'completed':
        statusIcon = '✓';
        statusStyle = styles.toolSuccess;
        break;
      case 'error':
        statusIcon = '✗';
        statusStyle = styles.toolError;
        break;
      default:
        statusIcon = '○';
        statusStyle = styles.toolBorder;
    }

    // Tool header
    const toolHeader = `  ${icon} ${block.name} ${statusIcon}`;
    lines.push({ text: toolHeader, style: statusStyle });

    // Tool input (summarized)
    if (block.input) {
      const inputStr = this.summarizeInput(block.name || '', block.input);
      lines.push({ text: `    ${inputStr}`, style: styles.toolBorder });
    }

    // Subagent progress (while running)
    if (block.name === 'subagent' && execution?.status === 'running' && execution?.progress) {
      lines.push({ text: `    ⟳ ${execution.progress}`, style: styles.subagentProgress });
    }

    // Tool output (if completed)
    if (execution?.result && !execution.collapsed) {
      const output = formatToolResult(execution.result, 200);
      const outputLines = output.split('\n').slice(0, 5);
      
      for (const line of outputLines) {
        lines.push({ text: `    │ ${line.slice(0, width - 8)}`, style: styles.toolOutput });
      }
      
      if (output.split('\n').length > 5) {
        lines.push({ text: `    │ ... (more output)`, style: styles.toolOutput });
      }
    }
  }

  private summarizeInput(toolName: string, input: any): string {
    switch (toolName) {
      case 'bash':
        return `$ ${(input.command || '').slice(0, 50)}${input.command?.length > 50 ? '...' : ''}`;
      case 'read_file':
        return `Reading: ${input.path}`;
      case 'write_file':
        return `Writing: ${input.path} (${input.content?.length || 0} chars)`;
      case 'list_files':
        return `Listing: ${input.path}`;
      case 'search_files':
        return `Searching: ${input.pattern} in ${input.path}`;
      // New Claude Code tools
      case 'view':
        const range = input.offset ? ` from line ${input.offset}` : '';
        return `Viewing: ${input.file_path}${range}`;
      case 'write':
        return `Writing: ${input.file_path} (${input.content?.length || 0} chars)`;
      case 'edit':
        return `Editing: ${input.file_path}`;
      case 'multiedit':
        return `Multi-edit: ${input.file_path} (${input.edits?.length || 0} edits)`;
      case 'glob':
        return `Finding: ${input.pattern}${input.path ? ` in ${input.path}` : ''}`;
      case 'grep':
        return `Searching: "${input.pattern}"${input.include ? ` in ${input.include}` : ''}`;
      case 'ls':
        return `Listing: ${input.path || '.'}`;
      case 'notebook_read':
        return `Reading notebook: ${input.notebook_path}`;
      case 'notebook_edit':
        return `Editing notebook cell ${input.cell_number}: ${input.notebook_path}`;
      case 'todo_read':
        return `Reading TODO list`;
      case 'todo_write':
        return `Updating TODO list (${input.todos?.length || 0} items)`;
      // Agent tools
      case 'Task':
      case 'Explore':
      case 'Plan':
      case 'Code':
      case 'Debug':
      case 'subagent':
        // Handle both 'prompt' (Claude Code) and 'task' (legacy)
        const agentPrompt = (input.prompt || input.task || '').slice(0, 55);
        return `${toolName}: ${agentPrompt}${(input.prompt || input.task)?.length > 55 ? '...' : ''}`;
      default:
        return JSON.stringify(input).slice(0, 50);
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

    buffer.write(x, y, box.topLeft + box.horizontal.repeat(width - 2) + box.topRight, 
      { style: borderStyle });

    for (let i = 1; i < height - 1; i++) {
      buffer.write(x, y + i, box.vertical, { style: borderStyle });
      buffer.write(x + width - 1, y + i, box.vertical, { style: borderStyle });
    }

    buffer.write(x, y + height - 1, 
      box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight, 
      { style: borderStyle });

    if (this.isStreaming) {
      buffer.write(x + 2, y + 1, `${this.spinnerChars[this.spinnerFrame]} Processing...`, 
        { style: styles.streaming });
    } else {
      this.editor.render(buffer, x + 1, y + 1, width - 2, height - 2);
    }
  }

  private quit(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.stopSpinner();
    
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
const chat = new ClaudeCodeChat();
chat.start();
