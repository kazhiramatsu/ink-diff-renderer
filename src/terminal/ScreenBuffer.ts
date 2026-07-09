/**
 * Double-buffered screen buffer with diff detection
 */

import { Cell, createEmptyCell, cellEquals } from './Cell';
import { Style, EMPTY_STYLE } from './Style';
import GraphemeSplitter from 'grapheme-splitter';
import stringWidth from 'string-width';

const splitter = new GraphemeSplitter();

export interface WriteOptions {
  style?: Style;
  wrap?: boolean;
}

export interface DiffChunk {
  x: number;
  y: number;
  cells: Cell[];
}

export interface CursorPosition {
  x: number;
  y: number;
}

export class ScreenBuffer {
  readonly width: number;
  readonly height: number;
  
  private front: Cell[][];   // Current frame being drawn
  private back: Cell[][];    // Previous frame (for diff)
  private _cursorPosition: CursorPosition | null = null;  // Where to place native cursor
  
  constructor(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.front = this.createBuffer();
    this.back = this.createBuffer();
  }

  private createBuffer(): Cell[][] {
    return Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => createEmptyCell())
    );
  }

  /**
   * Set the native cursor position (for IME input)
   */
  setCursorPosition(x: number, y: number): void {
    this._cursorPosition = { x, y };
  }

  /**
   * Get the native cursor position
   */
  getCursorPosition(): CursorPosition | null {
    return this._cursorPosition;
  }

  /**
   * Clear cursor position
   */
  clearCursorPosition(): void {
    this._cursorPosition = null;
  }

  /**
   * Create a new buffer with different dimensions
   */
  resize(width: number, height: number): ScreenBuffer {
    return new ScreenBuffer(width, height);
  }

  /**
   * Clear the front buffer
   */
  clear(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.front[y][x] = createEmptyCell();
      }
    }
    this._cursorPosition = null;
  }

  /**
   * Get cell at position
   */
  getCell(x: number, y: number): Cell | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.front[y][x];
  }

  /**
   * Set cell at position
   */
  setCell(x: number, y: number, cell: Cell): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }
    this.front[y][x] = cell;
  }

  /**
   * Write text at position
   * Returns the position after the last character
   */
  write(x: number, y: number, text: string, options: WriteOptions = {}): { x: number; y: number } {
    const { style = EMPTY_STYLE, wrap = false } = options;
    
    let curX = x;
    let curY = y;
    
    const graphemes = splitter.splitGraphemes(text);
    
    for (const grapheme of graphemes) {
      // Handle newline
      if (grapheme === '\n') {
        curX = wrap ? 0 : x;
        curY++;
        continue;
      }
      
      // Skip if past bottom
      if (curY >= this.height) break;
      
      const charWidth = stringWidth(grapheme);
      
      // Handle wrap or skip if past right edge
      if (curX + charWidth > this.width) {
        if (wrap) {
          curX = 0;
          curY++;
          if (curY >= this.height) break;
        } else {
          // Skip character that doesn't fit
          continue;
        }
      }
      
      // Write the character
      if (curX >= 0 && curX < this.width && curY >= 0) {
        this.front[curY][curX] = { char: grapheme, width: charWidth, style };
        
        // Fill continuation cells for wide characters
        for (let i = 1; i < charWidth && curX + i < this.width; i++) {
          this.front[curY][curX + i] = { char: '', width: 0, style };
        }
      }
      
      curX += charWidth;
    }
    
    return { x: curX, y: curY };
  }

  /**
   * Write multiple lines in a box region
   */
  writeBox(
    x: number,
    y: number,
    width: number,
    height: number,
    lines: string[],
    style: Style = EMPTY_STYLE
  ): void {
    for (let i = 0; i < Math.min(lines.length, height); i++) {
      const line = lines[i];
      // Truncate line to fit width
      const graphemes = splitter.splitGraphemes(line);
      let currentWidth = 0;
      let truncatedLine = '';
      
      for (const g of graphemes) {
        const w = stringWidth(g);
        if (currentWidth + w > width) break;
        truncatedLine += g;
        currentWidth += w;
      }
      
      this.write(x, y + i, truncatedLine, { style });
    }
  }

  /**
   * Fill a rectangular region with a character
   */
  fill(x: number, y: number, width: number, height: number, char: string, style: Style = EMPTY_STYLE): void {
    const charWidth = stringWidth(char);
    
    for (let row = y; row < y + height && row < this.height; row++) {
      if (row < 0) continue;
      
      for (let col = x; col < x + width && col < this.width; col += charWidth) {
        if (col < 0) continue;
        
        this.front[row][col] = { char, width: charWidth, style };
        
        // Fill continuation for wide chars
        for (let i = 1; i < charWidth && col + i < this.width; i++) {
          this.front[row][col + i] = { char: '', width: 0, style };
        }
      }
    }
  }

  /**
   * Draw a horizontal line
   */
  hline(x: number, y: number, width: number, char = '─', style: Style = EMPTY_STYLE): void {
    this.fill(x, y, width, 1, char, style);
  }

  /**
   * Draw a vertical line
   */
  vline(x: number, y: number, height: number, char = '│', style: Style = EMPTY_STYLE): void {
    for (let row = y; row < y + height && row < this.height; row++) {
      if (row >= 0 && x >= 0 && x < this.width) {
        this.front[row][x] = { char, width: 1, style };
      }
    }
  }

  /**
   * Draw a box border
   */
  box(x: number, y: number, width: number, height: number, style: Style = EMPTY_STYLE): void {
    // Corners
    this.write(x, y, '┌', { style });
    this.write(x + width - 1, y, '┐', { style });
    this.write(x, y + height - 1, '└', { style });
    this.write(x + width - 1, y + height - 1, '┘', { style });
    
    // Edges
    this.hline(x + 1, y, width - 2, '─', style);
    this.hline(x + 1, y + height - 1, width - 2, '─', style);
    this.vline(x, y + 1, height - 2, '│', style);
    this.vline(x + width - 1, y + 1, height - 2, '│', style);
  }

  /**
   * Generate diff chunks between front and back buffers
   */
  *diff(): Generator<DiffChunk> {
    for (let y = 0; y < this.height; y++) {
      let chunkStart: number | null = null;
      let chunkCells: Cell[] = [];
      
      for (let x = 0; x < this.width; x++) {
        const front = this.front[y][x];
        const back = this.back[y][x];
        
        if (!cellEquals(front, back)) {
          if (chunkStart === null) {
            chunkStart = x;
          }
          chunkCells.push(front);
        } else {
          if (chunkStart !== null) {
            yield { x: chunkStart, y, cells: chunkCells };
            chunkStart = null;
            chunkCells = [];
          }
        }
      }
      
      // Yield remaining chunk at end of line
      if (chunkStart !== null) {
        yield { x: chunkStart, y, cells: chunkCells };
      }
    }
  }

  /**
   * Check if there are any differences
   */
  hasDiff(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!cellEquals(this.front[y][x], this.back[y][x])) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Swap front and back buffers, clear front
   */
  swap(): void {
    [this.front, this.back] = [this.back, this.front];
    this.clear();
  }

  /**
   * Get the front buffer as a plain string (for debugging)
   */
  toString(): string {
    return this.front
      .map(row => row.map(cell => cell.char || ' ').join(''))
      .join('\n');
  }

  /**
   * Get raw access to front buffer (for advanced use)
   */
  getRawBuffer(): ReadonlyArray<ReadonlyArray<Cell>> {
    return this.front;
  }
}
