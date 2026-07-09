/**
 * Editor - High-level text editor with full input handling
 * Claude Code-level input processing
 */

import { TextBuffer, Position } from './TextBuffer';
import { InputHistory } from './InputHistory';
import { KeyBindings, KeyBindingConfig, KeyAction } from './KeyBindings';
import { ScreenBuffer } from '../terminal/ScreenBuffer';
import { Style } from '../terminal/Style';
import stringWidth from 'string-width';

export interface EditorOptions {
  /** Placeholder text when empty */
  placeholder?: string;
  /** Max number of visible lines (0 = unlimited) */
  maxVisibleLines?: number;
  /** Enable line numbers */
  showLineNumbers?: boolean;
  /** Enable history */
  enableHistory?: boolean;
  /** History max size */
  historyMaxSize?: number;
  /** Key binding configuration */
  keyBindings?: KeyBindingConfig;
  /** Prompt string (shown before first line) */
  prompt?: string;
  /** Continuation prompt (shown before subsequent lines) */
  continuationPrompt?: string;
  /** Use native terminal cursor instead of visual cursor character (default: false) */
  useNativeCursor?: boolean;
}

export interface EditorStyles {
  text: Style;
  placeholder: Style;
  cursor: Style;
  lineNumber: Style;
  prompt: Style;
  continuationPrompt: Style;
  selection: Style;
}

export interface EditorCallbacks {
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
  onChange?: (text: string) => void;
  onPaste?: () => Promise<string>;  // Custom paste handler
}

export interface RenderInfo {
  lines: Array<{
    lineIndex: number;
    content: string;
    displayRows: string[];  // After wrapping
  }>;
  cursorRow: number;
  cursorCol: number;
  scrollOffset: number;
  totalRows: number;
}

const DEFAULT_OPTIONS: EditorOptions = {
  placeholder: '',
  maxVisibleLines: 10,
  showLineNumbers: false,
  enableHistory: true,
  historyMaxSize: 1000,
  prompt: '> ',
  continuationPrompt: '  ',
};

const DEFAULT_STYLES: EditorStyles = {
  text: { fg: 15 },  // White
  placeholder: { fg: 8 },  // Gray
  cursor: { fg: 14, bold: true },  // Cyan
  lineNumber: { fg: 8 },  // Gray
  prompt: { fg: 10, bold: true },  // Green
  continuationPrompt: { fg: 8 },  // Gray
  selection: { bg: 4 },  // Blue background
};

export class Editor {
  private buffer: TextBuffer;
  private history: InputHistory;
  private keyBindings: KeyBindings;
  private options: EditorOptions;
  private styles: EditorStyles;
  private callbacks: EditorCallbacks = {};
  
  private scrollOffset: number = 0;
  private active: boolean = true;
  private historyBrowsing: boolean = false;

  constructor(options: EditorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.styles = { ...DEFAULT_STYLES };
    
    this.buffer = new TextBuffer();
    this.history = new InputHistory({ 
      maxSize: this.options.historyMaxSize 
    });
    this.keyBindings = new KeyBindings({
      enableHistory: this.options.enableHistory,
      ...this.options.keyBindings,
    });
  }

  // === Configuration ===

  setOptions(options: Partial<EditorOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.keyBindings) {
      this.keyBindings.setConfig(options.keyBindings);
    }
  }

  setStyles(styles: Partial<EditorStyles>): void {
    this.styles = { ...this.styles, ...styles };
  }

  setCallbacks(callbacks: EditorCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // === Text Access ===

  get text(): string {
    return this.buffer.text;
  }

  set text(value: string) {
    this.buffer.setText(value);
    this.scrollToCursor();
  }

  get isEmpty(): boolean {
    return this.buffer.isEmpty;
  }

  get cursor(): Position {
    return this.buffer.cursor;
  }

  get lineCount(): number {
    return this.buffer.lineCount;
  }

  // === Input Handling ===

  handleInput(key: string): void {
    if (!this.active) return;

    const parsed = this.keyBindings.parseKey(key);
    const { action, data } = this.keyBindings.getAction(parsed);

    // Execute action (don't await - let it run)
    this.executeAction(action, data);
  }

  /**
   * Handle input and return a promise (for async workflows)
   */
  async handleInputAsync(key: string): Promise<void> {
    if (!this.active) return;

    const parsed = this.keyBindings.parseKey(key);
    const { action, data } = this.keyBindings.getAction(parsed);

    await this.executeAction(action, data);
  }

  private async executeAction(action: KeyAction, data?: string): Promise<void> {
    // Exit history browsing on any edit action
    if (this.historyBrowsing && !['historyPrevious', 'historyNext', 'cancel'].includes(action)) {
      this.historyBrowsing = false;
      this.history.reset();
    }

    switch (action) {
      // Cursor movement
      case 'cursorLeft':
        this.buffer.moveCursorLeft();
        break;
      case 'cursorRight':
        this.buffer.moveCursorRight();
        break;
      case 'cursorUp':
        this.buffer.moveCursorUp();
        break;
      case 'cursorDown':
        this.buffer.moveCursorDown();
        break;
      case 'cursorWordLeft':
        this.buffer.moveCursorWordLeft();
        break;
      case 'cursorWordRight':
        this.buffer.moveCursorWordRight();
        break;
      case 'cursorLineStart':
        this.buffer.moveCursorToLineStart();
        break;
      case 'cursorLineEnd':
        this.buffer.moveCursorToLineEnd();
        break;
      case 'cursorDocStart':
        this.buffer.moveCursorToStart();
        break;
      case 'cursorDocEnd':
        this.buffer.moveCursorToEnd();
        break;

      // Editing
      case 'backspace':
        this.buffer.backspace();
        this.notifyChange();
        break;
      case 'delete':
        this.buffer.delete();
        this.notifyChange();
        break;
      case 'deleteWordBackward':
        this.buffer.deleteWordBackward();
        this.notifyChange();
        break;
      case 'deleteWordForward':
        this.buffer.deleteWordForward();
        this.notifyChange();
        break;
      case 'deleteToLineStart':
        this.buffer.deleteToLineStart();
        this.notifyChange();
        break;
      case 'deleteToLineEnd':
        this.buffer.deleteToLineEnd();
        this.notifyChange();
        break;
      case 'deleteLine':
        this.buffer.deleteLine();
        this.notifyChange();
        break;
      case 'newline':
        this.buffer.insertNewline();
        this.notifyChange();
        break;
      case 'input':
        if (data) {
          this.buffer.insert(data);
          this.notifyChange();
        }
        break;

      // Selection
      case 'selectAll':
        this.buffer.selectAll();
        break;

      // Clipboard
      case 'paste':
        await this.handlePaste();
        break;
      case 'copy':
        // Copy needs external implementation
        break;
      case 'cut':
        // Cut needs external implementation
        break;

      // History
      case 'historyPrevious':
        this.navigateHistoryPrevious();
        break;
      case 'historyNext':
        this.navigateHistoryNext();
        break;

      // Submit/Cancel
      case 'submit':
        this.submit();
        break;
      case 'cancel':
        this.cancel();
        break;

      // Other
      case 'clear':
        this.clear();
        break;
    }

    this.scrollToCursor();
  }

  private notifyChange(): void {
    if (this.callbacks.onChange) {
      this.callbacks.onChange(this.buffer.text);
    }
  }

  private async handlePaste(): Promise<void> {
    if (this.callbacks.onPaste) {
      try {
        const text = await this.callbacks.onPaste();
        if (text) {
          this.buffer.insert(text);
          this.notifyChange();
        }
      } catch (e) {
        // Paste failed silently
      }
    }
  }

  private navigateHistoryPrevious(): void {
    // Only navigate if on single line or at first line
    if (this.buffer.lineCount > 1 && this.buffer.cursor.line > 0) {
      this.buffer.moveCursorUp();
      return;
    }

    this.history.saveCurrentInput(this.buffer.text);
    const entry = this.history.previous(this.buffer.text);
    if (entry !== null) {
      this.buffer.setText(entry);
      this.buffer.moveCursorToEnd();
      this.historyBrowsing = true;
    }
  }

  private navigateHistoryNext(): void {
    // Only navigate if on single line or at last line
    if (this.buffer.lineCount > 1 && this.buffer.cursor.line < this.buffer.lineCount - 1) {
      this.buffer.moveCursorDown();
      return;
    }

    if (!this.historyBrowsing) return;

    const entry = this.history.next();
    if (entry !== null) {
      this.buffer.setText(entry);
      this.buffer.moveCursorToEnd();
    }
    
    if (!this.history.isBrowsing) {
      this.historyBrowsing = false;
    }
  }

  private submit(): void {
    const text = this.buffer.text;
    
    if (text.trim()) {
      this.history.add(text);
    }
    
    if (this.callbacks.onSubmit) {
      this.callbacks.onSubmit(text);
    }
  }

  private cancel(): void {
    if (this.historyBrowsing) {
      // Cancel history browsing
      this.history.reset();
      this.historyBrowsing = false;
      return;
    }

    if (this.callbacks.onCancel) {
      this.callbacks.onCancel();
    }
  }

  clear(): void {
    this.buffer.clear();
    this.scrollOffset = 0;
    this.notifyChange();
  }

  // === Scrolling ===

  private scrollToCursor(): void {
    const renderInfo = this.getRenderInfo(80);  // Approximate width
    const maxVisible = this.options.maxVisibleLines || 10;
    
    // Ensure cursor is visible
    if (renderInfo.cursorRow < this.scrollOffset) {
      this.scrollOffset = renderInfo.cursorRow;
    } else if (renderInfo.cursorRow >= this.scrollOffset + maxVisible) {
      this.scrollOffset = renderInfo.cursorRow - maxVisible + 1;
    }
  }

  // === Rendering ===

  /**
   * Get render information for current state
   */
  getRenderInfo(width: number): RenderInfo {
    const promptWidth = stringWidth(this.options.prompt || '');
    const contPromptWidth = stringWidth(this.options.continuationPrompt || '');
    const contentWidth = width - Math.max(promptWidth, contPromptWidth);

    const lines: RenderInfo['lines'] = [];
    let totalRows = 0;
    let cursorRow = 0;
    let cursorCol = 0;

    for (let i = 0; i < this.buffer.lineCount; i++) {
      const lineContent = this.buffer.getLine(i);
      const displayRows = this.wrapLine(lineContent, contentWidth);
      
      // Calculate cursor position if on this line
      if (i === this.buffer.cursor.line) {
        const cursorDisplayX = this.buffer.getCursorDisplayX();
        let row = 0;
        let col = cursorDisplayX;
        
        // Find which wrapped row the cursor is on
        let accWidth = 0;
        for (let r = 0; r < displayRows.length; r++) {
          const rowWidth = stringWidth(displayRows[r]);
          if (accWidth + rowWidth >= cursorDisplayX) {
            row = r;
            col = cursorDisplayX - accWidth;
            break;
          }
          accWidth += rowWidth;
          if (r === displayRows.length - 1) {
            row = r;
            col = cursorDisplayX - accWidth;
          }
        }
        
        cursorRow = totalRows + row;
        cursorCol = col + (i === 0 ? promptWidth : contPromptWidth);
      }

      lines.push({
        lineIndex: i,
        content: lineContent,
        displayRows,
      });

      totalRows += displayRows.length;
    }

    return {
      lines,
      cursorRow,
      cursorCol,
      scrollOffset: this.scrollOffset,
      totalRows,
    };
  }

  private wrapLine(text: string, width: number): string[] {
    if (width <= 0) return [text];
    if (!text) return [''];

    const rows: string[] = [];
    let currentRow = '';
    let currentWidth = 0;

    // Split into graphemes for proper handling
    const chars = [...text];

    for (const char of chars) {
      const charWidth = stringWidth(char);
      
      if (currentWidth + charWidth > width) {
        rows.push(currentRow);
        currentRow = char;
        currentWidth = charWidth;
      } else {
        currentRow += char;
        currentWidth += charWidth;
      }
    }

    rows.push(currentRow);
    return rows;
  }

  /**
   * Render editor to a ScreenBuffer
   */
  render(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const renderInfo = this.getRenderInfo(width);
    const prompt = this.options.prompt || '';
    const contPrompt = this.options.continuationPrompt || '';

    // Show placeholder if empty
    if (this.buffer.isEmpty && this.options.placeholder) {
      buffer.write(x, y, prompt, { style: this.styles.prompt });
      // Cursor at start position
      const cursorX = x + stringWidth(prompt);
      
      if (this.options.useNativeCursor) {
        // Native cursor only - no visual cursor character
        buffer.setCursorPosition(cursorX, y);
        buffer.write(cursorX, y, this.options.placeholder, { style: this.styles.placeholder });
      } else {
        // Visual cursor character
        buffer.write(cursorX, y, '▋', { style: this.styles.cursor });
        buffer.setCursorPosition(cursorX, y);
        // Placeholder after cursor (no overlapping)
        buffer.write(cursorX + 1, y, this.options.placeholder, { style: this.styles.placeholder });
      }
      return;
    }

    // Render visible rows
    let displayRow = 0;
    let screenY = y;

    for (const line of renderInfo.lines) {
      for (let rowIdx = 0; rowIdx < line.displayRows.length; rowIdx++) {
        // Skip if before scroll offset
        if (displayRow < this.scrollOffset) {
          displayRow++;
          continue;
        }

        // Stop if past visible area
        if (screenY >= y + height) {
          break;
        }

        const row = line.displayRows[rowIdx];
        const isFirstRow = line.lineIndex === 0 && rowIdx === 0;
        const isLineStart = rowIdx === 0;

        // Draw prompt
        if (isFirstRow) {
          buffer.write(x, screenY, prompt, { style: this.styles.prompt });
        } else if (isLineStart) {
          buffer.write(x, screenY, contPrompt, { style: this.styles.continuationPrompt });
        }

        // Draw content
        const contentX = x + stringWidth(isFirstRow ? prompt : (isLineStart ? contPrompt : ''));
        buffer.write(contentX, screenY, row, { style: this.styles.text });

        displayRow++;
        screenY++;
      }
    }

    // Draw cursor and set native cursor position for IME
    const cursorScreenY = y + (renderInfo.cursorRow - this.scrollOffset);
    if (cursorScreenY >= y && cursorScreenY < y + height) {
      const cursorScreenX = x + renderInfo.cursorCol;
      
      if (!this.options.useNativeCursor) {
        // Visual cursor character
        buffer.write(cursorScreenX, cursorScreenY, '▋', { style: this.styles.cursor });
      }
      
      // Set native cursor position for IME input
      buffer.setCursorPosition(cursorScreenX, cursorScreenY);
    }

    // Scroll indicator
    if (renderInfo.totalRows > height) {
      const maxScroll = renderInfo.totalRows - height;
      const scrollPercent = this.scrollOffset / maxScroll;
      const indicatorY = y + Math.floor(scrollPercent * (height - 1));
      buffer.write(x + width - 1, indicatorY, '█', { style: { fg: 11 } });
    }
  }

  /**
   * Get lines for simple rendering (without ScreenBuffer)
   */
  getDisplayLines(width: number): string[] {
    const renderInfo = this.getRenderInfo(width);
    const prompt = this.options.prompt || '';
    const contPrompt = this.options.continuationPrompt || '';
    const result: string[] = [];

    for (const line of renderInfo.lines) {
      for (let rowIdx = 0; rowIdx < line.displayRows.length; rowIdx++) {
        const row = line.displayRows[rowIdx];
        const isFirstRow = line.lineIndex === 0 && rowIdx === 0;
        const isLineStart = rowIdx === 0;

        let prefix = '';
        if (isFirstRow) {
          prefix = prompt;
        } else if (isLineStart) {
          prefix = contPrompt;
        }

        result.push(prefix + row);
      }
    }

    return result;
  }

  // === State Management ===

  setActive(active: boolean): void {
    this.active = active;
  }

  isActive(): boolean {
    return this.active;
  }

  focus(): void {
    this.active = true;
  }

  blur(): void {
    this.active = false;
  }

  getHistory(): InputHistory {
    return this.history;
  }

  getBuffer(): TextBuffer {
    return this.buffer;
  }
}
