/**
 * Claude Code-compatible Tool definitions and execution
 * 
 * Implements the full set of Claude Code tools:
 * - bash: Execute shell commands
 * - view: Read files with line range support
 * - write: Write/create files
 * - edit: Edit files using search/replace
 * - multiedit: Multiple edits in one operation
 * - glob: Find files by pattern
 * - grep: Search file contents
 * - ls: List directory contents
 * - subagent: Delegate tasks to autonomous sub-agent
 * - notebook_edit: Edit Jupyter notebooks
 * - todo_read/todo_write: Manage TODO lists
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

// =============================================================================
// Tool Input Types
// =============================================================================

export interface BashInput {
  command: string;
  timeout?: number;
}

export interface ViewInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

export interface WriteInput {
  file_path: string;
  content: string;
}

export interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

export interface MultiEditInput {
  file_path: string;
  edits: Array<{
    old_string: string;
    new_string: string;
  }>;
}

export interface GlobInput {
  pattern: string;
  path?: string;
}

export interface GrepInput {
  pattern: string;
  path?: string;
  include?: string;
}

export interface LsInput {
  path?: string;
  ignore?: string[];
}

export interface NotebookEditInput {
  notebook_path: string;
  cell_number: number;
  new_source: string;
}

export interface NotebookReadInput {
  notebook_path: string;
}

export interface TodoReadInput {}

export interface TodoWriteInput {
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'high' | 'medium' | 'low';
  }>;
}

// Legacy compatibility types
export interface BashToolInput extends BashInput {}
export interface ReadFileInput { path: string; }
export interface WriteFileInput { path: string; content: string; }
export interface ListFilesInput { path: string; }
export interface SearchFilesInput { path: string; pattern: string; }

// =============================================================================
// Tool Result Types
// =============================================================================

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface SubagentResult extends ToolResult {
  toolCalls?: number;
  iterations?: number;
}

// =============================================================================
// Tool Definition Type
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

// =============================================================================
// Tool Definitions (Claude Code Compatible)
// =============================================================================

export const tools: ToolDefinition[] = [
  {
    name: 'bash',
    description: `Execute a bash command in the shell. Use this to run CLI tools, scripts, and system commands.

Guidelines:
- Use for file operations, running scripts, git commands, installing packages, etc.
- Commands run in the current working directory
- Long-running commands will timeout (default 30s)
- Prefer built-in tools (view, write, edit) for simple file operations
- Use for complex file manipulations that benefit from shell utilities`,
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute'
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (default: 30000)'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'view',
    description: `Read file contents with optional line range. Returns file content with line numbers.

Use cases:
- Reading source code or configuration files
- Examining specific sections of large files
- Checking file contents before editing

The output includes line numbers for easy reference when using the edit tool.`,
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to read (relative to working directory or absolute)'
        },
        offset: {
          type: 'number',
          description: 'Line number to start from (1-indexed, default: 1)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to return (default: all lines)'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'write',
    description: `Create a new file or completely overwrite an existing file.

Use cases:
- Creating new files from scratch
- Replacing entire file contents
- Writing generated content

Note: For partial modifications, use the 'edit' tool instead.
Creates parent directories if they don't exist.`,
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path where the file should be written'
        },
        content: {
          type: 'string',
          description: 'Complete content to write to the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'edit',
    description: `Make a targeted edit to a file by replacing a specific string.

Guidelines:
- The old_string must match EXACTLY (including whitespace and indentation)
- The old_string must be unique within the file
- Include enough context to ensure uniqueness (usually 3-5 lines)
- Preserve the original indentation in new_string
- For multiple changes, consider using 'multiedit'

This is the preferred method for modifying existing files.`,
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to edit'
        },
        old_string: {
          type: 'string',
          description: 'The exact string to find and replace (must be unique in file)'
        },
        new_string: {
          type: 'string',
          description: 'The replacement string'
        }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  {
    name: 'multiedit',
    description: `Apply multiple edits to a single file in one operation.

Use cases:
- Making several related changes to a file
- Refactoring that requires multiple modifications
- Batch updates across a file

All edits are validated before any changes are applied.
Each edit's old_string must be unique in the file.`,
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to edit'
        },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_string: {
                type: 'string',
                description: 'The exact string to find and replace'
              },
              new_string: {
                type: 'string',
                description: 'The replacement string'
              }
            },
            required: ['old_string', 'new_string']
          },
          description: 'Array of edits to apply'
        }
      },
      required: ['file_path', 'edits']
    }
  },
  {
    name: 'glob',
    description: `Find files matching a glob pattern. Returns list of matching file paths.

Pattern examples:
- "*.ts" - TypeScript files in current directory
- "**/*.ts" - TypeScript files recursively
- "src/**/*.{ts,tsx}" - TS/TSX files in src
- "!node_modules" - Exclude patterns with !

Results are relative to the search path.`,
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files (e.g., "**/*.ts")'
        },
        path: {
          type: 'string',
          description: 'Base directory to search from (default: working directory)'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'grep',
    description: `Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.

Use cases:
- Finding function definitions
- Locating specific code patterns
- Searching for text across files

Results include context for each match.`,
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for'
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: working directory)'
        },
        include: {
          type: 'string',
          description: 'Glob pattern for files to include (e.g., "*.ts")'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'ls',
    description: `List directory contents with file information.

Returns:
- Files and directories with type indicators
- File sizes
- Modification times

Use to explore project structure or verify file existence.`,
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (default: working directory)'
        },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Patterns to ignore (e.g., ["node_modules", ".git"])'
        }
      },
      required: []
    }
  },
  {
    name: 'Task',
    description: `Launch a new agent that has access to the following tools: Bash, View, Write, Edit, MultiEdit, Glob, Grep, LS, NotebookRead, NotebookEdit, TodoRead, TodoWrite.

When to use Task:
- Complex multi-step tasks that benefit from focused work
- Tasks that require exploration and iteration
- Work that can be done independently without your supervision
- Tasks where mistakes can be easily fixed by the sub-agent

The agent will work autonomously and return a summary of what it accomplished.
You will not see the agent's intermediate steps - only the final result.

Cost: Each Task invocation uses additional API calls. Use judiciously for complex tasks.`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The task for the agent to perform. Be specific and include all necessary context.'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'Explore',
    description: `Launch an agent to explore and understand a codebase or topic.

When to use Explore:
- Understanding unfamiliar code or project structure
- Finding relevant files and their relationships
- Discovering how features are implemented
- Investigating dependencies and architecture

The agent will:
- Search through files and directories
- Read and analyze code
- Build a mental model of the codebase
- Return a structured summary of findings

Use this before making changes to understand the context.`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What to explore or understand. Be specific about the area of interest.'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'Plan',
    description: `Launch an agent to create a detailed plan for a task.

When to use Plan:
- Before starting complex implementations
- When you need to break down a large task
- To identify potential issues before coding
- To create a roadmap for multi-step changes

The agent will:
- Analyze requirements
- Identify affected files and components
- Consider edge cases and potential issues
- Create a step-by-step implementation plan
- NOT make any actual changes

Returns a detailed plan you can follow or delegate to Task agents.`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The task or feature to plan. Include requirements and constraints.'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'Code',
    description: `Launch an agent specialized in writing and modifying code.

When to use Code:
- Implementing new features
- Writing functions or classes
- Creating new files with boilerplate
- Making targeted code modifications

The agent focuses on:
- Clean, well-structured code
- Following existing patterns in the codebase
- Adding appropriate comments and documentation
- Handling edge cases

For complex refactoring across many files, consider using Task instead.`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What code to write or modify. Include specifications and context.'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'Debug',
    description: `Launch an agent specialized in debugging issues.

When to use Debug:
- Investigating error messages or stack traces
- Finding the root cause of bugs
- Understanding unexpected behavior
- Tracing data flow issues

The agent will:
- Analyze error messages and logs
- Search for related code
- Add diagnostic logging if needed
- Identify the root cause
- Suggest or implement fixes

Provide error messages, reproduction steps, and expected behavior.`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The bug or issue to debug. Include error messages and reproduction steps.'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'notebook_read',
    description: `Read a Jupyter notebook and display its cells.

Returns the notebook structure with:
- Cell numbers
- Cell types (code/markdown)
- Cell contents
- Output previews`,
    input_schema: {
      type: 'object',
      properties: {
        notebook_path: {
          type: 'string',
          description: 'Path to the .ipynb file'
        }
      },
      required: ['notebook_path']
    }
  },
  {
    name: 'notebook_edit',
    description: `Edit a cell in a Jupyter notebook.

Replaces the source content of a specific cell.
Cell numbers are 0-indexed.`,
    input_schema: {
      type: 'object',
      properties: {
        notebook_path: {
          type: 'string',
          description: 'Path to the .ipynb file'
        },
        cell_number: {
          type: 'number',
          description: 'Cell index to edit (0-indexed)'
        },
        new_source: {
          type: 'string',
          description: 'New source content for the cell'
        }
      },
      required: ['notebook_path', 'cell_number', 'new_source']
    }
  },
  {
    name: 'todo_read',
    description: `Read the current TODO list.

Returns all todos with their:
- ID
- Content
- Status (pending/in_progress/completed)
- Priority (high/medium/low)`,
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'todo_write',
    description: `Update the TODO list.

Replaces the entire TODO list with the provided items.
Use todo_read first to get current items, then modify and write back.`,
    input_schema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: { 
                type: 'string',
                enum: ['pending', 'in_progress', 'completed']
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low']
              }
            },
            required: ['id', 'content', 'status', 'priority']
          }
        }
      },
      required: ['todos']
    }
  }
];

// Agent tool names (excluded from sub-agent tools to prevent recursion)
export const agentToolNames = ['Task', 'Explore', 'Plan', 'Code', 'Debug', 'subagent'];

// Agent type
export type AgentType = 'Task' | 'Explore' | 'Plan' | 'Code' | 'Debug';

// Subagent/Task tools (excludes all agent tools to prevent recursion)
export const subagentTools: ToolDefinition[] = tools.filter(t => !agentToolNames.includes(t.name));

// Legacy compatibility exports
export const baseTools = subagentTools;

// Agent input (Claude Code compatible)
export interface AgentInput {
  prompt: string;
}

// Task input (alias for AgentInput)
export interface TaskInput extends AgentInput {}

// Legacy SubagentInput (maps to TaskInput)
export interface SubagentInput {
  task?: string;      // Legacy
  prompt?: string;    // Claude Code compatible
  context?: string;   // Legacy
}

// =============================================================================
// Tool Executor Class
// =============================================================================

export class ToolExecutor {
  private workingDirectory: string;
  private timeout: number;
  private agentHandler: ((agentType: AgentType, input: AgentInput | SubagentInput, onProgress?: (msg: string) => void) => Promise<ToolResult>) | null = null;
  private todos: Array<{ id: string; content: string; status: string; priority: string }> = [];

  constructor(options: { workingDirectory?: string; timeout?: number } = {}) {
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.timeout = options.timeout || 30000;
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  setWorkingDirectory(dir: string): void {
    this.workingDirectory = dir;
  }

  /**
   * Set the agent handler for Task, Explore, Plan, Code, Debug tools
   */
  setAgentHandler(handler: (agentType: AgentType, input: AgentInput | SubagentInput, onProgress?: (msg: string) => void) => Promise<ToolResult>): void {
    this.agentHandler = handler;
  }

  /**
   * @deprecated Use setAgentHandler instead
   */
  setSubagentHandler(handler: (input: SubagentInput, onProgress?: (msg: string) => void) => Promise<ToolResult>): void {
    // Wrap legacy handler
    this.agentHandler = (agentType: AgentType, input: AgentInput | SubagentInput, onProgress?: (msg: string) => void) => {
      return handler(input as SubagentInput, onProgress);
    };
  }

  async execute(toolName: string, input: any, onProgress?: (msg: string) => void): Promise<ToolResult> {
    try {
      switch (toolName) {
        // Core tools
        case 'bash':
          return await this.executeBash(input as BashInput);
        case 'view':
          return await this.executeView(input as ViewInput);
        case 'write':
          return await this.executeWrite(input as WriteInput);
        case 'edit':
          return await this.executeEdit(input as EditInput);
        case 'multiedit':
          return await this.executeMultiEdit(input as MultiEditInput);
        case 'glob':
          return await this.executeGlob(input as GlobInput);
        case 'grep':
          return await this.executeGrep(input as GrepInput);
        case 'ls':
          return await this.executeLs(input as LsInput);
        
        // Agent tools (Claude Code compatible)
        case 'Task':
        case 'Explore':
        case 'Plan':
        case 'Code':
        case 'Debug':
        case 'subagent':
          return await this.executeAgent(toolName as AgentType | 'subagent', input as AgentInput | SubagentInput, onProgress);
        
        // Notebook tools
        case 'notebook_read':
          return await this.executeNotebookRead(input as NotebookReadInput);
        case 'notebook_edit':
          return await this.executeNotebookEdit(input as NotebookEditInput);
        
        // TODO tools
        case 'todo_read':
          return await this.executeTodoRead();
        case 'todo_write':
          return await this.executeTodoWrite(input as TodoWriteInput);
        
        // Legacy compatibility
        case 'read_file':
          return await this.executeView({ file_path: (input as ReadFileInput).path });
        case 'write_file':
          return await this.executeWrite({ file_path: (input as WriteFileInput).path, content: (input as WriteFileInput).content });
        case 'list_files':
          return await this.executeLs({ path: (input as ListFilesInput).path });
        case 'search_files':
          return await this.executeGlob({ pattern: (input as SearchFilesInput).pattern, path: (input as SearchFilesInput).path });
        
        default:
          return {
            success: false,
            output: '',
            error: `Unknown tool: ${toolName}`
          };
      }
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message || String(error)
      };
    }
  }

  // ===========================================================================
  // Tool Implementations
  // ===========================================================================

  private async executeBash(input: BashInput): Promise<ToolResult> {
    try {
      const timeout = input.timeout || this.timeout;
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: this.workingDirectory,
        timeout: timeout,
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env, LANG: 'en_US.UTF-8' },
      });

      let output = stdout;
      if (stderr) {
        output += (output ? '\n' : '') + `STDERR:\n${stderr}`;
      }
      
      return {
        success: true,
        output: output || '(command completed with no output)'
      };
    } catch (error: any) {
      const parts: string[] = [];
      if (error.stdout) parts.push(`STDOUT:\n${error.stdout}`);
      if (error.stderr) parts.push(`STDERR:\n${error.stderr}`);

      let errorMsg: string;
      if (error.killed && error.signal === 'SIGTERM') {
        errorMsg = `Command timed out after ${(input.timeout || this.timeout) / 1000} seconds`;
      } else if (error.code !== undefined) {
        errorMsg = `Command failed with exit code ${error.code}`;
      } else {
        errorMsg = error.message || 'Unknown error';
      }

      return {
        success: false,
        output: parts.join('\n\n'),
        error: errorMsg
      };
    }
  }

  private async executeView(input: ViewInput): Promise<ToolResult> {
    try {
      const filePath = path.resolve(this.workingDirectory, input.file_path);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      const offset = Math.max(1, input.offset || 1);
      const limit = input.limit || lines.length;
      const endLine = Math.min(offset + limit - 1, lines.length);
      
      // Format with line numbers
      const numberedLines: string[] = [];
      const lineNumWidth = String(endLine).length;
      
      for (let i = offset - 1; i < endLine; i++) {
        const lineNum = String(i + 1).padStart(lineNumWidth, ' ');
        numberedLines.push(`${lineNum} │ ${lines[i]}`);
      }

      const header = `File: ${input.file_path} (lines ${offset}-${endLine} of ${lines.length})`;
      return {
        success: true,
        output: `${header}\n${'─'.repeat(60)}\n${numberedLines.join('\n')}`
      };
    } catch (error: any) {
      let errorMsg: string;
      if (error.code === 'ENOENT') {
        errorMsg = `File not found: ${input.file_path}`;
      } else if (error.code === 'EACCES') {
        errorMsg = `Permission denied: ${input.file_path}`;
      } else if (error.code === 'EISDIR') {
        errorMsg = `Path is a directory: ${input.file_path}`;
      } else {
        errorMsg = error.message || 'Failed to read file';
      }
      return { success: false, output: '', error: errorMsg };
    }
  }

  private async executeWrite(input: WriteInput): Promise<ToolResult> {
    try {
      const filePath = path.resolve(this.workingDirectory, input.file_path);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, input.content, 'utf-8');
      
      const lines = input.content.split('\n').length;
      return {
        success: true,
        output: `Wrote ${input.content.length} characters (${lines} lines) to ${input.file_path}`
      };
    } catch (error: any) {
      let errorMsg: string;
      if (error.code === 'EACCES') {
        errorMsg = `Permission denied: ${input.file_path}`;
      } else if (error.code === 'ENOSPC') {
        errorMsg = `No space left on device`;
      } else if (error.code === 'EROFS') {
        errorMsg = `Read-only file system`;
      } else {
        errorMsg = error.message || 'Failed to write file';
      }
      return { success: false, output: '', error: errorMsg };
    }
  }

  private async executeEdit(input: EditInput): Promise<ToolResult> {
    try {
      const filePath = path.resolve(this.workingDirectory, input.file_path);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Check if old_string exists
      const index = content.indexOf(input.old_string);
      if (index === -1) {
        return {
          success: false,
          output: '',
          error: `String not found in file. Make sure old_string matches exactly including whitespace.`
        };
      }
      
      // Check if old_string is unique
      const secondIndex = content.indexOf(input.old_string, index + 1);
      if (secondIndex !== -1) {
        return {
          success: false,
          output: '',
          error: `String appears multiple times in file. Include more context to make it unique.`
        };
      }
      
      // Apply the edit
      const newContent = content.replace(input.old_string, input.new_string);
      await fs.writeFile(filePath, newContent, 'utf-8');
      
      // Calculate line number of edit
      const linesBefore = content.substring(0, index).split('\n').length;
      
      return {
        success: true,
        output: `Edited ${input.file_path} at line ${linesBefore}`
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { success: false, output: '', error: `File not found: ${input.file_path}` };
      }
      return { success: false, output: '', error: error.message || 'Failed to edit file' };
    }
  }

  private async executeMultiEdit(input: MultiEditInput): Promise<ToolResult> {
    try {
      const filePath = path.resolve(this.workingDirectory, input.file_path);
      let content = await fs.readFile(filePath, 'utf-8');
      
      // Validate all edits first
      for (let i = 0; i < input.edits.length; i++) {
        const edit = input.edits[i];
        const count = (content.match(new RegExp(this.escapeRegex(edit.old_string), 'g')) || []).length;
        
        if (count === 0) {
          return {
            success: false,
            output: '',
            error: `Edit ${i + 1}: String not found in file`
          };
        }
        if (count > 1) {
          return {
            success: false,
            output: '',
            error: `Edit ${i + 1}: String appears ${count} times. Include more context.`
          };
        }
      }
      
      // Apply all edits
      const editLines: number[] = [];
      for (const edit of input.edits) {
        const index = content.indexOf(edit.old_string);
        const lineNum = content.substring(0, index).split('\n').length;
        editLines.push(lineNum);
        content = content.replace(edit.old_string, edit.new_string);
      }
      
      await fs.writeFile(filePath, content, 'utf-8');
      
      return {
        success: true,
        output: `Applied ${input.edits.length} edits to ${input.file_path} at lines: ${editLines.join(', ')}`
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { success: false, output: '', error: `File not found: ${input.file_path}` };
      }
      return { success: false, output: '', error: error.message || 'Failed to edit file' };
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async executeGlob(input: GlobInput): Promise<ToolResult> {
    const basePath = path.resolve(this.workingDirectory, input.path || '.');
    
    try {
      // Use find command for glob matching
      const pattern = input.pattern.replace(/\*\*/g, '*');
      const { stdout } = await execAsync(
        `find "${basePath}" -name "${pattern}" -type f 2>/dev/null | head -200`,
        { timeout: this.timeout }
      );
      
      const files = stdout.trim().split('\n').filter(Boolean);
      const relativePaths = files.map(f => path.relative(basePath, f));
      
      return {
        success: true,
        output: relativePaths.length > 0 
          ? `Found ${relativePaths.length} files:\n${relativePaths.join('\n')}`
          : '(no matches found)'
      };
    } catch {
      // Fallback: recursive scan
      const matches: string[] = [];
      await this.searchRecursive(basePath, input.pattern, matches);
      return {
        success: true,
        output: matches.length > 0 
          ? `Found ${matches.length} files:\n${matches.join('\n')}`
          : '(no matches found)'
      };
    }
  }

  private async searchRecursive(dir: string, pattern: string, matches: string[]): Promise<void> {
    if (matches.length >= 200) return;
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const regex = this.globToRegex(pattern);
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.workingDirectory, fullPath);
        
        if (entry.isDirectory()) {
          await this.searchRecursive(fullPath, pattern, matches);
        } else if (regex.test(entry.name)) {
          matches.push(relativePath);
        }
      }
    } catch {}
  }

  private globToRegex(pattern: string): RegExp {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`);
  }

  private async executeGrep(input: GrepInput): Promise<ToolResult> {
    const searchPath = path.resolve(this.workingDirectory, input.path || '.');
    
    try {
      let cmd = `grep -rn --color=never "${input.pattern}" "${searchPath}"`;
      if (input.include) {
        cmd += ` --include="${input.include}"`;
      }
      cmd += ' 2>/dev/null | head -100';
      
      const { stdout } = await execAsync(cmd, { timeout: this.timeout });
      
      if (!stdout.trim()) {
        return { success: true, output: '(no matches found)' };
      }
      
      // Format output
      const lines = stdout.trim().split('\n');
      const formatted = lines.map(line => {
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          const [, file, lineNum, content] = match;
          const relPath = path.relative(this.workingDirectory, file);
          return `${relPath}:${lineNum}: ${content.trim()}`;
        }
        return line;
      });
      
      return {
        success: true,
        output: `Found ${lines.length} matches:\n${formatted.join('\n')}`
      };
    } catch (error: any) {
      if (error.code === 1) {
        return { success: true, output: '(no matches found)' };
      }
      return { success: false, output: '', error: error.message || 'Grep failed' };
    }
  }

  private async executeLs(input: LsInput): Promise<ToolResult> {
    try {
      const dirPath = path.resolve(this.workingDirectory, input.path || '.');
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      const ignore = new Set(input.ignore || ['node_modules', '.git']);
      const lines: string[] = [];
      
      for (const entry of entries) {
        if (ignore.has(entry.name)) continue;
        
        const fullPath = path.join(dirPath, entry.name);
        
        try {
          const stat = await fs.stat(fullPath);
          const type = entry.isDirectory() ? 'd' : '-';
          const size = entry.isDirectory() ? '-' : this.formatSize(stat.size);
          const mtime = stat.mtime.toISOString().split('T')[0];
          const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
          
          lines.push(`${type} ${size.padStart(8)} ${mtime} ${name}`);
        } catch {
          lines.push(`? ${'-'.padStart(8)} ---------- ${entry.name}`);
        }
      }
      
      return {
        success: true,
        output: lines.length > 0 
          ? `${input.path || '.'} (${lines.length} items):\n${lines.join('\n')}`
          : '(empty directory)'
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { success: false, output: '', error: `Directory not found: ${input.path}` };
      }
      if (error.code === 'ENOTDIR') {
        return { success: false, output: '', error: `Not a directory: ${input.path}` };
      }
      return { success: false, output: '', error: error.message || 'Failed to list directory' };
    }
  }

  private formatSize(bytes: number): string {
    const units = ['B', 'K', 'M', 'G'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${Math.round(size)}${units[unit]}`;
  }

  private async executeAgent(agentType: AgentType | 'subagent', input: AgentInput | SubagentInput, onProgress?: (msg: string) => void): Promise<ToolResult> {
    if (!this.agentHandler) {
      return { success: false, output: '', error: 'Agent handler not configured. Use setAgentHandler() to configure.' };
    }
    
    // Normalize agent type (subagent -> Task for legacy compatibility)
    const normalizedAgentType: AgentType = agentType === 'subagent' ? 'Task' : agentType;
    
    // Normalize input
    const normalizedInput: AgentInput & SubagentInput = {
      // Claude Code uses 'prompt', legacy uses 'task'
      prompt: (input as AgentInput).prompt || (input as SubagentInput).task || '',
      task: (input as SubagentInput).task || (input as AgentInput).prompt,
      context: (input as SubagentInput).context,
    };
    
    return await this.agentHandler(normalizedAgentType, normalizedInput, onProgress);
  }

  private async executeNotebookRead(input: NotebookReadInput): Promise<ToolResult> {
    try {
      const notebookPath = path.resolve(this.workingDirectory, input.notebook_path);
      const content = await fs.readFile(notebookPath, 'utf-8');
      const notebook = JSON.parse(content);
      
      const cells = notebook.cells || [];
      const lines: string[] = [`Notebook: ${input.notebook_path} (${cells.length} cells)\n`];
      
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const type = cell.cell_type || 'unknown';
        const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
        const preview = source.split('\n').slice(0, 5).join('\n');
        
        lines.push(`─── Cell ${i} [${type}] ${'─'.repeat(40)}`);
        lines.push(preview);
        if (source.split('\n').length > 5) {
          lines.push('...');
        }
        lines.push('');
      }
      
      return { success: true, output: lines.join('\n') };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { success: false, output: '', error: `Notebook not found: ${input.notebook_path}` };
      }
      return { success: false, output: '', error: error.message || 'Failed to read notebook' };
    }
  }

  private async executeNotebookEdit(input: NotebookEditInput): Promise<ToolResult> {
    try {
      const notebookPath = path.resolve(this.workingDirectory, input.notebook_path);
      const content = await fs.readFile(notebookPath, 'utf-8');
      const notebook = JSON.parse(content);
      
      const cells = notebook.cells || [];
      if (input.cell_number < 0 || input.cell_number >= cells.length) {
        return { 
          success: false, 
          output: '', 
          error: `Cell ${input.cell_number} does not exist. Notebook has ${cells.length} cells (0-${cells.length - 1}).`
        };
      }
      
      // Update cell source
      const newSource = input.new_source.split('\n').map((line, i, arr) => 
        i < arr.length - 1 ? line + '\n' : line
      );
      cells[input.cell_number].source = newSource;
      
      await fs.writeFile(notebookPath, JSON.stringify(notebook, null, 2), 'utf-8');
      
      return {
        success: true,
        output: `Updated cell ${input.cell_number} in ${input.notebook_path}`
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { success: false, output: '', error: `Notebook not found: ${input.notebook_path}` };
      }
      return { success: false, output: '', error: error.message || 'Failed to edit notebook' };
    }
  }

  private async executeTodoRead(): Promise<ToolResult> {
    if (this.todos.length === 0) {
      return { success: true, output: '(no todos)' };
    }
    
    const lines = this.todos.map(todo => {
      const status = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◐' : '○';
      const priority = todo.priority === 'high' ? '‼️' : todo.priority === 'medium' ? '!' : ' ';
      return `${status} [${todo.id}] ${priority} ${todo.content}`;
    });
    
    return { success: true, output: lines.join('\n') };
  }

  private async executeTodoWrite(input: TodoWriteInput): Promise<ToolResult> {
    this.todos = input.todos;
    return {
      success: true,
      output: `Updated TODO list with ${input.todos.length} items`
    };
  }
}

// =============================================================================
// Agent Class (Claude Code Compatible)
// =============================================================================

export interface AgentOptions {
  maxIterations?: number;
  timeout?: number;
  onProgress?: (message: string, toolCalls: number) => void;
}

// Legacy alias
export type SubagentOptions = AgentOptions;

export interface AgentStep {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'complete';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: ToolResult;
}

// Legacy alias
export type SubagentStep = AgentStep;

// System prompts for different agent types
const agentSystemPrompts: Record<AgentType, string> = {
  Task: `You are a task-focused agent. Complete the assigned task efficiently and thoroughly.

You have access to the following tools:
- Bash: Execute shell commands
- View: Read file contents with line numbers
- Write: Create or overwrite files
- Edit: Make targeted edits using search/replace
- MultiEdit: Apply multiple edits to a file
- Glob: Find files by pattern
- Grep: Search file contents
- LS: List directory contents
- NotebookRead: Read Jupyter notebooks
- NotebookEdit: Edit notebook cells
- TodoRead/TodoWrite: Manage task lists

Guidelines:
1. Break down complex tasks into smaller steps
2. Verify your work after making changes
3. If you encounter an error, try to fix it
4. Be concise in your responses

When complete, summarize what you accomplished.`,

  Explore: `You are an exploration agent. Your goal is to understand codebases, find information, and discover how things work.

You have access to tools for reading files, searching, and navigating directories.

Guidelines:
1. Start with a broad overview (list directories, find key files)
2. Dive deeper into relevant areas
3. Look for patterns, conventions, and architecture
4. Note dependencies and relationships between components
5. DO NOT make any changes to files

Your output should be a clear, organized summary of what you found:
- Project structure and key directories
- Important files and their purposes
- Patterns and conventions used
- Relevant code sections for the query
- Recommendations for further investigation`,

  Plan: `You are a planning agent. Your goal is to create detailed, actionable plans for implementation tasks.

You have access to tools for reading files and searching the codebase.

Guidelines:
1. Analyze the requirements thoroughly
2. Explore relevant code to understand the current state
3. Identify all affected files and components
4. Consider edge cases and potential issues
5. DO NOT make any actual changes

Your output should be a detailed plan including:
- Overview of the approach
- Step-by-step implementation plan
- Files to create or modify
- Potential risks and how to mitigate them
- Testing strategy
- Estimated complexity`,

  Code: `You are a coding agent. Your goal is to write clean, well-structured code.

You have access to tools for reading, writing, and editing files.

Guidelines:
1. Follow existing patterns and conventions in the codebase
2. Write clean, readable code with appropriate comments
3. Handle edge cases and errors appropriately
4. Use meaningful variable and function names
5. Verify your changes work correctly

Focus on:
- Code quality over speed
- Consistency with existing code
- Proper error handling
- Clear documentation`,

  Debug: `You are a debugging agent. Your goal is to find and fix bugs.

You have access to tools for reading files, searching, and making edits.

Guidelines:
1. Analyze error messages and stack traces carefully
2. Reproduce the issue if possible
3. Trace the code flow to understand the problem
4. Look for similar patterns that might have the same issue
5. Add diagnostic logging if needed
6. Implement a fix and verify it works

Your output should include:
- Root cause analysis
- How you found the issue
- The fix you implemented
- Any related issues discovered
- Suggestions for preventing similar bugs`,
};

export class Agent {
  private client: any;
  private toolExecutor: ToolExecutor;
  private options: AgentOptions;
  private agentType: AgentType;
  private messages: any[] = [];
  private toolCalls: number = 0;
  private iterations: number = 0;
  private steps: AgentStep[] = [];

  constructor(
    client: any, 
    toolExecutor: ToolExecutor, 
    agentType: AgentType = 'Task',
    options: AgentOptions = {}
  ) {
    this.client = client;
    this.toolExecutor = toolExecutor;
    this.agentType = agentType;
    this.options = {
      maxIterations: options.maxIterations ?? 15,
      timeout: options.timeout ?? 300000,
      onProgress: options.onProgress,
    };
  }

  async execute(input: AgentInput | SubagentInput): Promise<SubagentResult> {
    const startTime = Date.now();
    
    // Get the prompt (Claude Code uses 'prompt', legacy uses 'task')
    const taskPrompt = (input as AgentInput).prompt || (input as SubagentInput).task || '';
    
    // Get system prompt for agent type
    const baseSystemPrompt = agentSystemPrompts[this.agentType];
    const systemPrompt = `${baseSystemPrompt}

Working directory: ${this.toolExecutor.getWorkingDirectory()}`;

    // Build user message
    let userMessage = taskPrompt;
    if ((input as SubagentInput).context) {
      userMessage += `\n\nAdditional context: ${(input as SubagentInput).context}`;
    }

    this.messages = [{ role: 'user', content: userMessage }];
    this.steps = [];
    this.toolCalls = 0;
    this.iterations = 0;

    try {
      while (this.iterations < this.options.maxIterations!) {
        if (Date.now() - startTime > this.options.timeout!) {
          return {
            success: false,
            output: this.buildSummary(),
            error: `${this.agentType} agent timed out`,
            toolCalls: this.toolCalls,
            iterations: this.iterations,
          };
        }

        this.iterations++;
        this.options.onProgress?.(`${this.agentType}: Iteration ${this.iterations}`, this.toolCalls);

        const response = await this.client.messages.create({
          model: 'claude-sonnet-5',
          max_tokens: 4096,
          system: systemPrompt,
          tools: subagentTools,
          messages: this.messages,
        });

        const assistantContent: any[] = [];
        const toolUseBlocks: any[] = [];

        for (const block of response.content) {
          if (block.type === 'text') {
            assistantContent.push({ type: 'text', text: block.text });
            this.steps.push({ type: 'thinking', content: block.text });
          } else if (block.type === 'tool_use') {
            assistantContent.push(block);
            toolUseBlocks.push(block);
            this.steps.push({ type: 'tool_use', toolName: block.name, toolInput: block.input });
          }
        }

        this.messages.push({ role: 'assistant', content: assistantContent });

        if (toolUseBlocks.length > 0) {
          const toolResults = await Promise.all(
            toolUseBlocks.map(async (toolUse: any) => {
              this.toolCalls++;
              this.options.onProgress?.(`${this.agentType}: ${toolUse.name}`, this.toolCalls);

              const result = await this.toolExecutor.execute(toolUse.name, toolUse.input);
              this.steps.push({ type: 'tool_result', toolName: toolUse.name, toolResult: result });

              return {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: result.success ? result.output || '(no output)' : `Error: ${result.error}\n${result.output}`,
                is_error: !result.success,
              };
            })
          );

          this.messages.push({ role: 'user', content: toolResults });
        }

        if (response.stop_reason !== 'tool_use') {
          return {
            success: true,
            output: this.buildSummary(),
            toolCalls: this.toolCalls,
            iterations: this.iterations,
          };
        }
      }

      return {
        success: false,
        output: this.buildSummary(),
        error: `Max iterations (${this.options.maxIterations}) reached`,
        toolCalls: this.toolCalls,
        iterations: this.iterations,
      };
    } catch (error: any) {
      return {
        success: false,
        output: this.buildSummary(),
        error: error.message || 'Unknown error',
        toolCalls: this.toolCalls,
        iterations: this.iterations,
      };
    }
  }

  private buildSummary(): string {
    const parts: string[] = [];

    // Find the last text response
    let lastThinking: AgentStep | undefined;
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].type === 'thinking') {
        lastThinking = this.steps[i];
        break;
      }
    }

    if (lastThinking?.content) {
      // Truncate if too long
      const content = lastThinking.content;
      if (content.length > 500) {
        parts.push(content.slice(0, 500) + '...');
      } else {
        parts.push(content);
      }
    } else {
      // Fallback: list tools used
      const toolsUsed = this.steps.filter(s => s.type === 'tool_use').map(s => s.toolName);
      if (toolsUsed.length > 0) {
        const uniqueTools = [...new Set(toolsUsed)];
        parts.push(`Used tools: ${uniqueTools.join(', ')}`);
      }
    }

    parts.push(`\n[${this.agentType}: ${this.iterations} iterations, ${this.toolCalls} tool calls]`);
    return parts.join('\n');
  }

  getSteps(): AgentStep[] {
    return [...this.steps];
  }

  getAgentType(): AgentType {
    return this.agentType;
  }
}

// Legacy alias
export class Subagent extends Agent {
  constructor(client: any, toolExecutor: ToolExecutor, options: SubagentOptions = {}) {
    super(client, toolExecutor, 'Task', options);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: any;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export function isToolUseBlock(block: any): block is ToolUseBlock {
  return block && block.type === 'tool_use';
}

export function formatToolResult(result: ToolResult, maxLength: number = 500): string {
  let output = result.output;
  if (result.error) {
    output = `Error: ${result.error}\n${output}`;
  }
  if (output.length > maxLength) {
    output = output.slice(0, maxLength) + `\n... (${output.length - maxLength} more chars)`;
  }
  return output;
}

export function getToolIcon(toolName: string): string {
  const icons: Record<string, string> = {
    // Core tools
    bash: '$',
    view: '👁',
    write: '✏️',
    edit: '📝',
    multiedit: '📝',
    glob: '🔍',
    grep: '🔎',
    ls: '📁',
    // Agent tools
    Task: '🤖',
    Explore: '🔭',
    Plan: '📋',
    Code: '💻',
    Debug: '🐛',
    subagent: '🤖',
    // Notebook tools
    notebook_read: '📓',
    notebook_edit: '📓',
    // TODO tools
    todo_read: '☑️',
    todo_write: '☑️',
    // Legacy
    read_file: '📄',
    write_file: '✏️',
    list_files: '📁',
    search_files: '🔍',
  };
  return icons[toolName] || '🔧';
}
