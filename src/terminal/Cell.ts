/**
 * Cell representation for terminal buffer
 */

import { Style, EMPTY_STYLE, styleEquals } from './Style';

export interface Cell {
  /** Single grapheme character (or ' ' for empty) */
  char: string;
  /** Display width (0 for wide char continuation, 1 for normal, 2 for wide) */
  width: number;
  /** Cell style */
  style: Style;
}

/**
 * Create an empty cell (space with no style)
 */
export function createEmptyCell(): Cell {
  return { char: ' ', width: 1, style: EMPTY_STYLE };
}

/**
 * Create a cell with specified content
 */
export function createCell(char: string, width: number, style: Style = EMPTY_STYLE): Cell {
  return { char, width, style };
}

/**
 * Compare two cells for equality
 */
export function cellEquals(a: Cell, b: Cell): boolean {
  return a.char === b.char && a.width === b.width && styleEquals(a.style, b.style);
}

/**
 * Clone a cell
 */
export function cloneCell(cell: Cell): Cell {
  return { ...cell, style: { ...cell.style } };
}
