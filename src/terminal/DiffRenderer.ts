/**
 * Diff-based renderer that generates minimal ANSI escape sequences
 */

import { ScreenBuffer, DiffChunk } from './ScreenBuffer';
import { Cell } from './Cell';
import { Style, styleEquals, styleToAnsi, EMPTY_STYLE } from './Style';

export interface RenderOptions {
  /** Use synchronized output mode (DEC private mode 2026) */
  sync?: boolean;
  /** Hide cursor during render */
  hideCursor?: boolean;
  /** Force full redraw */
  force?: boolean;
}

export class DiffRenderer {
  private buffer: ScreenBuffer;
  private currentStyle: Style = EMPTY_STYLE;
  private cursorX = 0;
  private cursorY = 0;
  private isFirstRender = true;

  constructor(width: number, height: number) {
    this.buffer = new ScreenBuffer(width, height);
  }

  get width(): number {
    return this.buffer.width;
  }

  get height(): number {
    return this.buffer.height;
  }

  /**
   * Get the underlying buffer for drawing
   */
  getBuffer(): ScreenBuffer {
    return this.buffer;
  }

  /**
   * Resize the buffer (creates new buffer)
   */
  resize(width: number, height: number): void {
    this.buffer = new ScreenBuffer(width, height);
    this.isFirstRender = true;
  }

  /**
   * Clear buffer and prepare for new frame
   */
  begin(): ScreenBuffer {
    this.buffer.clear();
    return this.buffer;
  }

  /**
   * Render diff and return ANSI sequence
   */
  render(options: RenderOptions = {}): string {
    const { sync = true, hideCursor = true, force = false } = options;
    
    // Force full refresh on first render or if requested
    if (this.isFirstRender || force) {
      this.isFirstRender = false;
      return this.fullRefresh(options);
    }
    
    // Check if there are any differences
    if (!this.buffer.hasDiff()) {
      return '';
    }
    
    const parts: string[] = [];

    // Start sequence
    if (sync) {
      parts.push('\x1b[?2026h');  // Begin synchronized output
    }
    if (hideCursor) {
      parts.push('\x1b[?25l');    // Hide cursor
    }

    // Render diff chunks
    this.currentStyle = EMPTY_STYLE;
    
    for (const chunk of this.buffer.diff()) {
      parts.push(this.renderChunk(chunk));
    }

    // Reset style if changed
    if (!styleEquals(this.currentStyle, EMPTY_STYLE)) {
      parts.push('\x1b[0m');
      this.currentStyle = EMPTY_STYLE;
    }

    // Move native cursor to input position (for IME support)
    const cursorPos = this.buffer.getCursorPosition();
    if (cursorPos) {
      parts.push(this.moveCursorAbsolute(cursorPos.x, cursorPos.y));
    }

    // End sequence
    if (sync) {
      parts.push('\x1b[?2026l');  // End synchronized output
    }

    // Swap buffers
    this.buffer.swap();

    return parts.join('');
  }

  private renderChunk(chunk: DiffChunk): string {
    const parts: string[] = [];
    
    // Move cursor to chunk position
    parts.push(this.moveCursor(chunk.x, chunk.y));
    
    // Render cells
    for (const cell of chunk.cells) {
      // Skip continuation cells (width 0)
      if (cell.width === 0) continue;
      
      // Update style if needed
      if (!styleEquals(cell.style, this.currentStyle)) {
        parts.push('\x1b[0m');  // Reset
        const styleStr = styleToAnsi(cell.style);
        if (styleStr) parts.push(styleStr);
        this.currentStyle = cell.style;
      }
      
      parts.push(cell.char);
      this.cursorX += cell.width;
    }
    
    return parts.join('');
  }

  private moveCursor(x: number, y: number): string {
    if (x === this.cursorX && y === this.cursorY) {
      return '';
    }

    let seq: string;

    if (y === this.cursorY) {
      // Same line - use relative movement
      const dx = x - this.cursorX;
      if (dx === 1) {
        seq = '\x1b[C';
      } else if (dx === -1) {
        seq = '\x1b[D';
      } else if (dx > 0) {
        seq = `\x1b[${dx}C`;
      } else if (dx < 0) {
        seq = `\x1b[${-dx}D`;
      } else {
        seq = '';
      }
    } else if (x === 0) {
      // Moving to start of line
      const dy = y - this.cursorY;
      if (dy === 1) {
        seq = '\r\n';
      } else if (dy > 0) {
        seq = `\x1b[${dy}B\r`;
      } else {
        seq = `\x1b[${y + 1};1H`;
      }
    } else {
      // Absolute positioning
      seq = `\x1b[${y + 1};${x + 1}H`;
    }

    this.cursorX = x;
    this.cursorY = y;
    return seq;
  }

  /**
   * Move cursor to absolute position (always uses absolute ANSI sequence)
   */
  private moveCursorAbsolute(x: number, y: number): string {
    this.cursorX = x;
    this.cursorY = y;
    return `\x1b[${y + 1};${x + 1}H`;
  }

  /**
   * Full screen refresh (used for first render or on demand)
   */
  fullRefresh(options: RenderOptions = {}): string {
    const { sync = true, hideCursor = true } = options;
    const parts: string[] = [];

    // Start sequence
    if (sync) {
      parts.push('\x1b[?2026h');
    }
    if (hideCursor) {
      parts.push('\x1b[?25l');
    }
    
    // Clear screen and home cursor
    parts.push('\x1b[2J\x1b[H');

    this.currentStyle = EMPTY_STYLE;
    this.cursorX = 0;
    this.cursorY = 0;

    const buffer = this.buffer.getRawBuffer();
    
    for (let y = 0; y < this.buffer.height; y++) {
      for (let x = 0; x < this.buffer.width; x++) {
        const cell = buffer[y][x];
        
        // Skip continuation cells
        if (cell.width === 0) continue;

        // Update style
        if (!styleEquals(cell.style, this.currentStyle)) {
          parts.push('\x1b[0m');
          const styleStr = styleToAnsi(cell.style);
          if (styleStr) parts.push(styleStr);
          this.currentStyle = cell.style;
        }

        parts.push(cell.char);
        this.cursorX += cell.width;
      }
      
      // Move to next line
      if (y < this.buffer.height - 1) {
        parts.push('\r\n');
        this.cursorX = 0;
        this.cursorY++;
      }
    }

    // Reset style
    parts.push('\x1b[0m');
    this.currentStyle = EMPTY_STYLE;

    // Move native cursor to input position (for IME support)
    const cursorPos = this.buffer.getCursorPosition();
    if (cursorPos) {
      parts.push(this.moveCursorAbsolute(cursorPos.x, cursorPos.y));
    }

    // End sequence
    if (sync) {
      parts.push('\x1b[?2026l');
    }

    // Swap buffers
    this.buffer.swap();

    return parts.join('');
  }

  /**
   * Generate sequence to clear the screen
   */
  static clearScreen(): string {
    return '\x1b[2J\x1b[H';
  }

  /**
   * Generate sequence to enter alternate screen buffer
   */
  static enterAltScreen(): string {
    return '\x1b[?1049h';
  }

  /**
   * Generate sequence to leave alternate screen buffer
   */
  static leaveAltScreen(): string {
    return '\x1b[?1049l';
  }

  /**
   * Generate sequence to show cursor
   */
  static showCursor(): string {
    return '\x1b[?25h';
  }

  /**
   * Generate sequence to hide cursor
   */
  static hideCursor(): string {
    return '\x1b[?25l';
  }
}
