/**
 * Style definitions for terminal cells
 */

export interface Style {
  fg?: number | [number, number, number] | null;  // 256-color or RGB
  bg?: number | [number, number, number] | null;  // 256-color or RGB
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

export const EMPTY_STYLE: Style = Object.freeze({});

/**
 * Compare two styles for equality
 */
export function styleEquals(a: Style, b: Style): boolean {
  if (a === b) return true;
  
  // Compare colors
  const fgEqual = colorEquals(a.fg, b.fg);
  const bgEqual = colorEquals(a.bg, b.bg);
  
  return (
    fgEqual &&
    bgEqual &&
    !!a.bold === !!b.bold &&
    !!a.dim === !!b.dim &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.inverse === !!b.inverse &&
    !!a.strikethrough === !!b.strikethrough
  );
}

function colorEquals(
  a: number | [number, number, number] | null | undefined,
  b: number | [number, number, number] | null | undefined
): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b;
  }
  
  if (Array.isArray(a) && Array.isArray(b)) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }
  
  return false;
}

/**
 * Convert style to ANSI escape sequence
 */
export function styleToAnsi(style: Style): string {
  const codes: number[] = [];
  
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.inverse) codes.push(7);
  if (style.strikethrough) codes.push(9);
  
  if (style.fg !== undefined && style.fg !== null) {
    if (typeof style.fg === 'number') {
      codes.push(38, 5, style.fg);
    } else {
      codes.push(38, 2, style.fg[0], style.fg[1], style.fg[2]);
    }
  }
  
  if (style.bg !== undefined && style.bg !== null) {
    if (typeof style.bg === 'number') {
      codes.push(48, 5, style.bg);
    } else {
      codes.push(48, 2, style.bg[0], style.bg[1], style.bg[2]);
    }
  }
  
  return codes.length > 0 ? `\x1b[${codes.join(';')}m` : '';
}

/**
 * Named color constants (256-color palette)
 */
export const Colors = {
  // Basic colors (0-15)
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightBlack: 8,
  brightRed: 9,
  brightGreen: 10,
  brightYellow: 11,
  brightBlue: 12,
  brightMagenta: 13,
  brightCyan: 14,
  brightWhite: 15,
  
  // Grayscale (232-255)
  gray: (level: number): number => {
    return Math.max(232, Math.min(255, 232 + Math.floor(level * 23)));
  },
  
  // RGB cube (16-231)
  rgb: (r: number, g: number, b: number): number => {
    const ri = Math.max(0, Math.min(5, Math.floor(r * 6)));
    const gi = Math.max(0, Math.min(5, Math.floor(g * 6)));
    const bi = Math.max(0, Math.min(5, Math.floor(b * 6)));
    return 16 + (36 * ri) + (6 * gi) + bi;
  },
} as const;
