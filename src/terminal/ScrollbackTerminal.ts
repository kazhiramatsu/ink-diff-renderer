/**
 * ScrollbackTerminal - Terminal with fixed input area at bottom
 * 
 * New lines are written at the bottom of the content area,
 * pushing older content upward (bottom-up scrolling).
 * 
 * Layout:
 * ┌─────────────────────────────────┐ 
 * │ Content area (scrollable)       │
 * │ ← older content scrolls up      │
 * │ ← new content appears here      │
 * ├─────────────────────────────────┤ inputAreaStartRow
 * │ Fixed area (status/input)       │ (inputHeight lines)
 * │                                 │
 * ├─────────────────────────────────┤
 * │ Bottom margin (empty)           │ (bottomMargin lines)
 * └─────────────────────────────────┘
 */

import { ScreenBuffer } from './ScreenBuffer';
import { Style, styleToAnsi, EMPTY_STYLE } from './Style';

export interface ScrollbackTerminalOptions {
  /** Output stream (default: process.stdout) */
  stdout?: NodeJS.WriteStream;
  /** Input stream for raw mode (default: process.stdin) */
  stdin?: NodeJS.ReadStream;
  /** Height of the fixed input area (default: 3) */
  inputHeight?: number;
  /** Margin below the input area (default: 0) */
  bottomMargin?: number;
  /** Target frames per second (default: 30) */
  fps?: number;
}

export type ScrollbackRenderCallback = (
  buffer: ScreenBuffer,
  width: number,
  height: number
) => void;

export class ScrollbackTerminal {
  private stdout: NodeJS.WriteStream;
  private stdin: NodeJS.ReadStream;
  private inputHeight: number;
  private bottomMargin: number;
  private fps: number;
  private frameTime: number;
  
  private width: number;
  private height: number;
  private fixedBuffer: ScreenBuffer;
  
  // History buffer for redrawing on resize
  private historyBuffer: Array<{ text: string; style: Style }> = [];
  private maxHistoryLines: number = 10000;
  
  // Flag to prevent rendering during resize
  private isResizing: boolean = false;
  private resizeTimeout: NodeJS.Timeout | null = null;
  
  private renderCallback: ScrollbackRenderCallback | null = null;
  private resizeHandler: (() => void) | null = null;
  private destroyed = false;
  
  private pendingRender = false;
  private lastRenderTime = 0;
  
  constructor(options: ScrollbackTerminalOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.stdin = options.stdin ?? process.stdin;
    this.inputHeight = options.inputHeight ?? 3;
    this.bottomMargin = options.bottomMargin ?? 0;
    this.fps = options.fps ?? 30;
    this.frameTime = 1000 / this.fps;
    
    this.width = this.stdout.columns || 80;
    this.height = this.stdout.rows || 24;
    
    this.fixedBuffer = new ScreenBuffer(this.width, this.inputHeight);
    
    this.setupResizeHandler();
    this.initialize();
  }

  private initialize(): void {
    // Clear screen
    this.stdout.write('\x1b[2J\x1b[H');
    
    // Set scroll region to content area only (exclude input area)
    this.setScrollRegion();
    
    // Initial render of fixed area
    this.renderInputArea();
  }

  /**
   * Set scroll region to content area only
   */
  private setScrollRegion(): void {
    const contentHeight = this.contentAreaHeight;
    // \x1b[1;Nr sets scroll region from line 1 to line N
    this.stdout.write(`\x1b[1;${contentHeight}r`);
  }

  /** Total reserved height at bottom (input + margin) */
  private get reservedHeight(): number {
    return this.inputHeight + this.bottomMargin;
  }

  /** Height of the scrollable content area */
  get contentAreaHeight(): number {
    return this.height - this.reservedHeight;
  }

  /** Alias for contentAreaHeight */
  get scrollAreaHeight(): number {
    return this.contentAreaHeight;
  }

  private get inputAreaStartRow(): number {
    return this.height - this.reservedHeight + 1;
  }

  private setupResizeHandler(): void {
    this.resizeHandler = () => {
      if (this.destroyed) return;
      
      // Mark as resizing to block other renders
      this.isResizing = true;
      
      // Update dimensions immediately
      this.width = this.stdout.columns || 80;
      this.height = this.stdout.rows || 24;
      this.fixedBuffer = new ScreenBuffer(this.width, this.inputHeight);
      
      // Reset scroll region, clear screen AND scrollback buffer
      // \x1b[3J clears scrollback buffer - we'll redraw from historyBuffer
      this.stdout.write('\x1b[?2026h\x1b[?25l\x1b[r\x1b[2J\x1b[3J\x1b[?2026l');
      
      // Debounce: wait for resize to settle before redrawing
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      
      this.resizeTimeout = setTimeout(() => {
        this.performResizeRedraw();
        this.isResizing = false;
        this.resizeTimeout = null;
      }, 50);
    };
    this.stdout.on('resize', this.resizeHandler);
  }

  private performResizeRedraw(): void {
    // Build entire screen in one synchronized write
    const parts: string[] = [];
    
    // Begin sync, hide cursor
    parts.push('\x1b[?2026h');
    parts.push('\x1b[?25l');
    
    // Reset scroll region to full screen first
    parts.push('\x1b[r');
    
    // Clear entire screen
    parts.push('\x1b[2J\x1b[H');
    
    // Redraw content from history
    const contentHeight = this.contentAreaHeight;
    const startIndex = Math.max(0, this.historyBuffer.length - contentHeight);
    const visibleLines = this.historyBuffer.slice(startIndex);
    const startRow = contentHeight - visibleLines.length + 1;
    
    for (let i = 0; i < visibleLines.length; i++) {
      const row = startRow + i;
      if (row < 1) continue;
      
      const { text, style } = visibleLines[i];
      parts.push(`\x1b[${row};1H`);
      
      const styleStr = styleToAnsi(style);
      if (styleStr) {
        parts.push(`${styleStr}${text}\x1b[0m`);
      } else {
        parts.push(text);
      }
    }
    
    // Render input area into buffer
    this.fixedBuffer = new ScreenBuffer(this.width, this.inputHeight);
    if (this.renderCallback) {
      try {
        this.renderCallback(this.fixedBuffer, this.width, this.inputHeight);
      } catch (e) {}
    }
    
    // Draw input area
    const fixedStartY = this.inputAreaStartRow;
    const rawBuffer = this.fixedBuffer.getRawBuffer();
    let currentStyle: Style = EMPTY_STYLE;
    
    for (let y = 0; y < this.inputHeight; y++) {
      parts.push(`\x1b[${fixedStartY + y};1H\x1b[2K`);
      
      for (let x = 0; x < this.width; x++) {
        const cell = rawBuffer[y]?.[x];
        if (!cell || cell.width === 0) continue;
        
        if (cell.style !== currentStyle) {
          parts.push('\x1b[0m');
          const styleStr = styleToAnsi(cell.style);
          if (styleStr) parts.push(styleStr);
          currentStyle = cell.style;
        }
        parts.push(cell.char);
      }
    }
    parts.push('\x1b[0m');
    
    // Set scroll region back to content area only
    parts.push(`\x1b[1;${contentHeight}r`);
    
    // Position cursor
    const cursorPos = this.fixedBuffer.getCursorPosition();
    if (cursorPos) {
      const absY = fixedStartY + cursorPos.y;
      const absX = cursorPos.x + 1;
      parts.push(`\x1b[${absY};${absX}H`);
      parts.push('\x1b[?25h');
    }
    
    // End sync
    parts.push('\x1b[?2026l');
    
    // Write all at once
    this.stdout.write(parts.join(''));
  }

  // === Public getters ===

  get terminalWidth(): number { return this.width; }
  get terminalHeight(): number { return this.height; }
  get fixedAreaHeight(): number { return this.inputHeight; }
  get isDestroyed(): boolean { return this.destroyed; }

  onRender(callback: ScrollbackRenderCallback): void {
    this.renderCallback = callback;
  }

  /**
   * Write a line to the content area (bottom-up: new lines appear at bottom, push old lines up)
   */
  writeLine(text: string, style: Style = EMPTY_STYLE): void {
    if (this.destroyed) return;
    
    // Add to history buffer
    this.historyBuffer.push({ text, style });
    if (this.historyBuffer.length > this.maxHistoryLines) {
      this.historyBuffer.shift();
    }
    
    // Skip actual rendering during resize - resize handler will redraw
    if (this.isResizing) return;
    
    const contentHeight = this.contentAreaHeight;
    const writeRow = contentHeight;  // Always write at the last line of content area
    
    // Scroll up within scroll region: output newline at bottom of scroll region
    this.stdout.write(`\x1b[${contentHeight};1H\n`);
    
    // Move to the write position and write
    this.stdout.write(`\x1b[${writeRow};1H`);
    this.stdout.write('\x1b[2K');  // Clear line
    
    const styleStr = styleToAnsi(style);
    const line = styleStr ? `${styleStr}${text}\x1b[0m` : text;
    this.stdout.write(line);
    
    // Input area should not need redrawing since it's outside scroll region
    // but call it anyway to update dynamic content
    this.renderInputArea();
  }

  /**
   * Write multiple lines
   */
  writeLines(lines: Array<{ text: string; style?: Style }>): void {
    if (this.destroyed || lines.length === 0) return;
    
    // Add to history buffer
    for (const line of lines) {
      this.historyBuffer.push({ text: line.text, style: line.style || EMPTY_STYLE });
    }
    while (this.historyBuffer.length > this.maxHistoryLines) {
      this.historyBuffer.shift();
    }
    
    // Skip actual rendering during resize - resize handler will redraw
    if (this.isResizing) return;
    
    const contentHeight = this.contentAreaHeight;
    const totalLines = lines.length;
    
    // Scroll up by totalLines within scroll region
    this.stdout.write(`\x1b[${contentHeight};1H`);
    for (let i = 0; i < totalLines; i++) {
      this.stdout.write('\n');
    }
    
    // Write all lines from (contentHeight - totalLines + 1) to contentHeight
    const startRow = contentHeight - totalLines + 1;
    for (let i = 0; i < totalLines; i++) {
      const row = startRow + i;
      if (row < 1) continue;  // Skip if would be above screen
      
      this.stdout.write(`\x1b[${row};1H`);
      this.stdout.write('\x1b[2K');
      
      const line = lines[i];
      const styleStr = styleToAnsi(line.style || EMPTY_STYLE);
      const text = styleStr ? `${styleStr}${line.text}\x1b[0m` : line.text;
      this.stdout.write(text);
    }
    
    // Input area should not need redrawing since it's outside scroll region
    this.renderInputArea();
  }

  /**
   * Clear the input area
   */
  clearInputArea(): void {
    if (this.destroyed || this.isResizing) return;
    
    for (let row = this.inputAreaStartRow; row <= this.height; row++) {
      this.stdout.write(`\x1b[${row};1H\x1b[2K`);
    }
  }

  /**
   * Clear the history buffer
   */
  clearHistory(): void {
    this.historyBuffer = [];
  }

  scheduleRender(): void {
    if (this.destroyed || this.pendingRender || this.isResizing) return;
    this.pendingRender = true;
    
    const now = Date.now();
    const elapsed = now - this.lastRenderTime;
    const delay = Math.max(0, this.frameTime - elapsed);
    
    setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    // Always clear the pending flag first: if a resize starts between
    // scheduleRender() and flush(), returning with pendingRender still true
    // would block every future scheduleRender() call permanently.
    this.pendingRender = false;
    if (this.destroyed || this.isResizing) return;

    this.lastRenderTime = Date.now();
    this.renderInputArea();
  }

  renderNow(): void {
    if (this.destroyed || this.isResizing) return;
    
    this.pendingRender = false;
    this.lastRenderTime = Date.now();
    this.renderInputArea();
  }

  getFixedBuffer(): ScreenBuffer {
    return this.fixedBuffer;
  }

  /**
   * Render the fixed input area at the bottom
   */
  private renderInputArea(): void {
    if (this.destroyed || this.isResizing) return;
    
    // Recreate buffer and call render callback
    this.fixedBuffer = new ScreenBuffer(this.width, this.inputHeight);
    
    if (this.renderCallback) {
      try {
        this.renderCallback(this.fixedBuffer, this.width, this.inputHeight);
      } catch (e) {
        // Ignore render errors
      }
    }
    
    const parts: string[] = [];
    
    // Synchronized output
    parts.push('\x1b[?2026h');
    parts.push('\x1b[?25l');
    
    const fixedStartY = this.inputAreaStartRow;
    const rawBuffer = this.fixedBuffer.getRawBuffer();
    let currentStyle: Style = EMPTY_STYLE;
    
    for (let y = 0; y < this.inputHeight; y++) {
      parts.push(`\x1b[${fixedStartY + y};1H`);
      parts.push('\x1b[2K');
      
      for (let x = 0; x < this.width; x++) {
        const cell = rawBuffer[y]?.[x];
        if (!cell || cell.width === 0) continue;
        
        if (cell.style !== currentStyle) {
          parts.push('\x1b[0m');
          const styleStr = styleToAnsi(cell.style);
          if (styleStr) parts.push(styleStr);
          currentStyle = cell.style;
        }
        parts.push(cell.char);
      }
    }
    
    parts.push('\x1b[0m');
    
    // Position cursor
    const cursorPos = this.fixedBuffer.getCursorPosition();
    if (cursorPos) {
      const absY = fixedStartY + cursorPos.y;
      const absX = cursorPos.x + 1;
      parts.push(`\x1b[${absY};${absX}H`);
      parts.push('\x1b[?25h');
    }
    
    // End synchronized output
    parts.push('\x1b[?2026l');
    
    this.stdout.write(parts.join(''));
  }

  showCursor(): void {
    this.stdout.write('\x1b[?25h');
  }

  hideCursor(): void {
    this.stdout.write('\x1b[?25l');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
    
    if (this.resizeHandler) {
      this.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    
    // Reset scroll region to full screen
    this.stdout.write('\x1b[r');
    this.stdout.write('\x1b[?25h');
    this.stdout.write(`\x1b[${this.height};1H\n`);
    this.stdout.write('\x1b[0m');
  }

  enableRawMode(): void {
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(true);
    }
  }

  disableRawMode(): void {
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(false);
    }
  }
}
