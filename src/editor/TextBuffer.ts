/**
 * TextBuffer - Core text editing data structure
 * Handles multi-line text with cursor position tracking
 */

import GraphemeSplitter from 'grapheme-splitter';
import stringWidth from 'string-width';

const splitter = new GraphemeSplitter();

export interface Position {
  line: number;
  col: number;  // Grapheme index within line
}

export interface Selection {
  start: Position;
  end: Position;
}

export interface TextBufferState {
  lines: string[];
  cursor: Position;
  selection: Selection | null;
}

export class TextBuffer {
  private _lines: string[][] = [[]];  // Array of grapheme arrays
  private _cursor: Position = { line: 0, col: 0 };
  private _selection: Selection | null = null;
  private _preferredCol: number = 0;  // For vertical movement

  constructor(initialText: string = '') {
    if (initialText) {
      this.setText(initialText);
    }
  }

  // === Getters ===
  
  get lines(): string[] {
    return this._lines.map(line => line.join(''));
  }

  get lineCount(): number {
    return this._lines.length;
  }

  get cursor(): Position {
    return { ...this._cursor };
  }

  get selection(): Selection | null {
    return this._selection ? {
      start: { ...this._selection.start },
      end: { ...this._selection.end }
    } : null;
  }

  get text(): string {
    return this.lines.join('\n');
  }

  get isEmpty(): boolean {
    return this._lines.length === 1 && this._lines[0].length === 0;
  }

  get currentLine(): string {
    return this._lines[this._cursor.line].join('');
  }

  get currentLineGraphemes(): string[] {
    return this._lines[this._cursor.line];
  }

  getLine(index: number): string {
    if (index < 0 || index >= this._lines.length) return '';
    return this._lines[index].join('');
  }

  getLineGraphemes(index: number): string[] {
    if (index < 0 || index >= this._lines.length) return [];
    return this._lines[index];
  }

  getLineLength(index: number): number {
    if (index < 0 || index >= this._lines.length) return 0;
    return this._lines[index].length;
  }

  // === Text Manipulation ===

  setText(text: string): void {
    const lines = text.split('\n');
    this._lines = lines.map(line => splitter.splitGraphemes(line));
    this._cursor = { line: 0, col: 0 };
    this._selection = null;
  }

  clear(): void {
    this._lines = [[]];
    this._cursor = { line: 0, col: 0 };
    this._selection = null;
    this._preferredCol = 0;
  }

  // === Cursor Movement ===

  moveCursorTo(line: number, col: number): void {
    this._cursor.line = Math.max(0, Math.min(line, this._lines.length - 1));
    const maxCol = this._lines[this._cursor.line].length;
    this._cursor.col = Math.max(0, Math.min(col, maxCol));
    this._preferredCol = this._cursor.col;
  }

  moveCursorLeft(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      if (this._cursor.col > 0) {
        this._cursor.col--;
      } else if (this._cursor.line > 0) {
        this._cursor.line--;
        this._cursor.col = this._lines[this._cursor.line].length;
      }
    }
    this._preferredCol = this._cursor.col;
  }

  moveCursorRight(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      const lineLen = this._lines[this._cursor.line].length;
      if (this._cursor.col < lineLen) {
        this._cursor.col++;
      } else if (this._cursor.line < this._lines.length - 1) {
        this._cursor.line++;
        this._cursor.col = 0;
      }
    }
    this._preferredCol = this._cursor.col;
  }

  moveCursorUp(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      if (this._cursor.line > 0) {
        this._cursor.line--;
        const maxCol = this._lines[this._cursor.line].length;
        this._cursor.col = Math.min(this._preferredCol, maxCol);
      }
    }
  }

  moveCursorDown(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      if (this._cursor.line < this._lines.length - 1) {
        this._cursor.line++;
        const maxCol = this._lines[this._cursor.line].length;
        this._cursor.col = Math.min(this._preferredCol, maxCol);
      }
    }
  }

  moveCursorToLineStart(): void {
    this._cursor.col = 0;
    this._preferredCol = 0;
  }

  moveCursorToLineEnd(): void {
    this._cursor.col = this._lines[this._cursor.line].length;
    this._preferredCol = this._cursor.col;
  }

  moveCursorToStart(): void {
    this._cursor = { line: 0, col: 0 };
    this._preferredCol = 0;
  }

  moveCursorToEnd(): void {
    this._cursor.line = this._lines.length - 1;
    this._cursor.col = this._lines[this._cursor.line].length;
    this._preferredCol = this._cursor.col;
  }

  // Word movement
  moveCursorWordLeft(): void {
    const line = this._lines[this._cursor.line];
    
    if (this._cursor.col === 0) {
      if (this._cursor.line > 0) {
        this._cursor.line--;
        this._cursor.col = this._lines[this._cursor.line].length;
      }
      this._preferredCol = this._cursor.col;
      return;
    }

    let col = this._cursor.col - 1;
    while (col > 0 && this.isWhitespace(line[col])) {
      col--;
    }
    while (col > 0 && !this.isWhitespace(line[col - 1])) {
      col--;
    }

    this._cursor.col = col;
    this._preferredCol = col;
  }

  moveCursorWordRight(): void {
    const line = this._lines[this._cursor.line];
    
    if (this._cursor.col >= line.length) {
      if (this._cursor.line < this._lines.length - 1) {
        this._cursor.line++;
        this._cursor.col = 0;
      }
      this._preferredCol = this._cursor.col;
      return;
    }

    let col = this._cursor.col;
    while (col < line.length && !this.isWhitespace(line[col])) {
      col++;
    }
    while (col < line.length && this.isWhitespace(line[col])) {
      col++;
    }

    this._cursor.col = col;
    this._preferredCol = col;
  }

  private isWhitespace(char: string): boolean {
    return /\s/.test(char);
  }

  // === Editing Operations ===

  insert(text: string): void {
    if (this._selection) {
      this.deleteSelection();
    }

    const graphemes = splitter.splitGraphemes(text);
    const insertLines = this.splitIntoLines(graphemes);

    if (insertLines.length === 1) {
      this._lines[this._cursor.line].splice(this._cursor.col, 0, ...insertLines[0]);
      this._cursor.col += insertLines[0].length;
    } else {
      const currentLine = this._lines[this._cursor.line];
      const before = currentLine.slice(0, this._cursor.col);
      const after = currentLine.slice(this._cursor.col);

      this._lines[this._cursor.line] = [...before, ...insertLines[0]];

      const middleLines = insertLines.slice(1, -1);
      const lastInsertLine = insertLines[insertLines.length - 1];
      
      this._lines.splice(
        this._cursor.line + 1, 
        0, 
        ...middleLines.map(l => [...l]),
        [...lastInsertLine, ...after]
      );

      this._cursor.line += insertLines.length - 1;
      this._cursor.col = lastInsertLine.length;
    }

    this._preferredCol = this._cursor.col;
  }

  private splitIntoLines(graphemes: string[]): string[][] {
    const lines: string[][] = [[]];
    for (const g of graphemes) {
      if (g === '\n') {
        lines.push([]);
      } else {
        lines[lines.length - 1].push(g);
      }
    }
    return lines;
  }

  insertNewline(): void {
    const currentLine = this._lines[this._cursor.line];
    const before = currentLine.slice(0, this._cursor.col);
    const after = currentLine.slice(this._cursor.col);

    this._lines[this._cursor.line] = before;
    this._lines.splice(this._cursor.line + 1, 0, after);

    this._cursor.line++;
    this._cursor.col = 0;
    this._preferredCol = 0;
  }

  backspace(): boolean {
    if (this._selection) {
      this.deleteSelection();
      return true;
    }

    if (this._cursor.col > 0) {
      this._lines[this._cursor.line].splice(this._cursor.col - 1, 1);
      this._cursor.col--;
      this._preferredCol = this._cursor.col;
      return true;
    } else if (this._cursor.line > 0) {
      const prevLineLen = this._lines[this._cursor.line - 1].length;
      this._lines[this._cursor.line - 1].push(...this._lines[this._cursor.line]);
      this._lines.splice(this._cursor.line, 1);
      this._cursor.line--;
      this._cursor.col = prevLineLen;
      this._preferredCol = this._cursor.col;
      return true;
    }
    return false;
  }

  delete(): boolean {
    if (this._selection) {
      this.deleteSelection();
      return true;
    }

    const lineLen = this._lines[this._cursor.line].length;
    if (this._cursor.col < lineLen) {
      this._lines[this._cursor.line].splice(this._cursor.col, 1);
      return true;
    } else if (this._cursor.line < this._lines.length - 1) {
      this._lines[this._cursor.line].push(...this._lines[this._cursor.line + 1]);
      this._lines.splice(this._cursor.line + 1, 1);
      return true;
    }
    return false;
  }

  deleteWordBackward(): boolean {
    if (this._cursor.col === 0 && this._cursor.line === 0) {
      return false;
    }

    const startCol = this._cursor.col;
    const startLine = this._cursor.line;
    
    this.moveCursorWordLeft();
    
    if (this._cursor.line === startLine) {
      this._lines[this._cursor.line].splice(this._cursor.col, startCol - this._cursor.col);
    } else {
      const before = this._lines[this._cursor.line].slice(0, this._cursor.col);
      const after = this._lines[startLine].slice(startCol);
      this._lines[this._cursor.line] = [...before, ...after];
      this._lines.splice(this._cursor.line + 1, startLine - this._cursor.line);
    }
    
    this._preferredCol = this._cursor.col;
    return true;
  }

  deleteWordForward(): boolean {
    const startCol = this._cursor.col;
    const startLine = this._cursor.line;
    
    this.moveCursorWordRight();
    
    if (this._cursor.line === startLine) {
      this._lines[startLine].splice(startCol, this._cursor.col - startCol);
      this._cursor.col = startCol;
    } else {
      const before = this._lines[startLine].slice(0, startCol);
      const after = this._lines[this._cursor.line].slice(this._cursor.col);
      this._lines[startLine] = [...before, ...after];
      this._lines.splice(startLine + 1, this._cursor.line - startLine);
      this._cursor.line = startLine;
      this._cursor.col = startCol;
    }
    
    this._preferredCol = this._cursor.col;
    return true;
  }

  deleteToLineStart(): string {
    const deleted = this._lines[this._cursor.line].slice(0, this._cursor.col).join('');
    this._lines[this._cursor.line].splice(0, this._cursor.col);
    this._cursor.col = 0;
    this._preferredCol = 0;
    return deleted;
  }

  deleteToLineEnd(): string {
    const deleted = this._lines[this._cursor.line].slice(this._cursor.col).join('');
    this._lines[this._cursor.line].splice(this._cursor.col);
    return deleted;
  }

  deleteLine(): string {
    const deleted = this._lines[this._cursor.line].join('');
    if (this._lines.length > 1) {
      this._lines.splice(this._cursor.line, 1);
      if (this._cursor.line >= this._lines.length) {
        this._cursor.line = this._lines.length - 1;
      }
    } else {
      this._lines[0] = [];
    }
    this._cursor.col = Math.min(this._cursor.col, this._lines[this._cursor.line].length);
    this._preferredCol = this._cursor.col;
    return deleted;
  }

  // === Selection ===

  selectAll(): void {
    this._selection = {
      start: { line: 0, col: 0 },
      end: { 
        line: this._lines.length - 1, 
        col: this._lines[this._lines.length - 1].length 
      }
    };
    this._cursor = { ...this._selection.end };
  }

  clearSelection(): void {
    this._selection = null;
  }

  getSelectedText(): string {
    if (!this._selection) return '';
    
    const { start, end } = this.normalizeSelection(this._selection);
    
    if (start.line === end.line) {
      return this._lines[start.line].slice(start.col, end.col).join('');
    }

    const lines: string[] = [];
    lines.push(this._lines[start.line].slice(start.col).join(''));
    
    for (let i = start.line + 1; i < end.line; i++) {
      lines.push(this._lines[i].join(''));
    }
    
    lines.push(this._lines[end.line].slice(0, end.col).join(''));
    
    return lines.join('\n');
  }

  deleteSelection(): void {
    if (!this._selection) return;
    
    const { start, end } = this.normalizeSelection(this._selection);
    
    if (start.line === end.line) {
      this._lines[start.line].splice(start.col, end.col - start.col);
    } else {
      const before = this._lines[start.line].slice(0, start.col);
      const after = this._lines[end.line].slice(end.col);
      this._lines[start.line] = [...before, ...after];
      this._lines.splice(start.line + 1, end.line - start.line);
    }
    
    this._cursor = { ...start };
    this._selection = null;
    this._preferredCol = this._cursor.col;
  }

  private normalizeSelection(sel: Selection): Selection {
    const { start, end } = sel;
    if (start.line < end.line || (start.line === end.line && start.col <= end.col)) {
      return { start, end };
    }
    return { start: end, end: start };
  }

  // === Display Helpers ===

  getCursorDisplayX(): number {
    let width = 0;
    const line = this._lines[this._cursor.line];
    for (let i = 0; i < this._cursor.col && i < line.length; i++) {
      width += stringWidth(line[i]);
    }
    return width;
  }

  getLineDisplayWidth(lineIndex: number): number {
    if (lineIndex < 0 || lineIndex >= this._lines.length) return 0;
    return this._lines[lineIndex].reduce((w, g) => w + stringWidth(g), 0);
  }

  displayColToGraphemeIndex(lineIndex: number, displayCol: number): number {
    if (lineIndex < 0 || lineIndex >= this._lines.length) return 0;
    
    const line = this._lines[lineIndex];
    let width = 0;
    for (let i = 0; i < line.length; i++) {
      const charWidth = stringWidth(line[i]);
      if (width + charWidth > displayCol) {
        return i;
      }
      width += charWidth;
    }
    return line.length;
  }

  // === State Management ===

  getState(): TextBufferState {
    return {
      lines: this.lines,
      cursor: this.cursor,
      selection: this.selection
    };
  }

  setState(state: TextBufferState): void {
    this._lines = state.lines.map(line => splitter.splitGraphemes(line));
    this._cursor = { ...state.cursor };
    this._selection = state.selection ? {
      start: { ...state.selection.start },
      end: { ...state.selection.end }
    } : null;
    this._preferredCol = this._cursor.col;
  }
}
