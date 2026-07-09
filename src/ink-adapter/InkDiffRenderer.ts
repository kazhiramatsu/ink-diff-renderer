/**
 * React Ink integration adapter
 * Intercepts Ink's output and uses diff-based rendering
 */

import { Terminal, TerminalOptions } from '../terminal/Terminal';
import { ScreenBuffer } from '../terminal/ScreenBuffer';
import { Style, EMPTY_STYLE } from '../terminal/Style';

interface ParsedLine {
  segments: Array<{
    text: string;
    style: Style;
  }>;
}

export interface InkDiffRendererOptions extends TerminalOptions {
  /** Strip ANSI from output before parsing (useful for debugging) */
  stripAnsi?: boolean;
}

/**
 * Adapter to use diff-based rendering with React Ink
 */
export class InkDiffRenderer {
  private terminal: Terminal;
  private stripAnsi: boolean;
  private stdout: NodeJS.WriteStream;

  constructor(options: InkDiffRendererOptions = {}) {
    this.terminal = new Terminal({
      ...options,
      altScreen: options.altScreen ?? true,
    });
    this.stripAnsi = options.stripAnsi ?? false;
    this.stdout = options.stdout ?? process.stdout;
  }

  /**
   * Get the underlying terminal
   */
  getTerminal(): Terminal {
    return this.terminal;
  }

  /**
   * Get terminal dimensions
   */
  get width(): number {
    return this.terminal.width;
  }

  get height(): number {
    return this.terminal.height;
  }

  /**
   * Render Ink's string output using diff-based rendering
   */
  render(output: string): void {
    const buffer = this.terminal.getBuffer();
    buffer.clear();

    this.parseAndRender(buffer, output);

    const renderer = this.terminal.getRenderer();
    // renderer.render() swaps the buffers itself — swapping again here would
    // leave the back buffer empty, so vanished cells would never be erased.
    const rendered = renderer.render();

    if (rendered.length > 0) {
      this.stdout.write(rendered);
    }
  }

  /**
   * Schedule a render (batched with frame rate limiting)
   */
  scheduleRender(output: string): void {
    // Store latest output for next render
    this.terminal.onRender((buffer) => {
      this.parseAndRender(buffer, output);
    });
    this.terminal.scheduleRender();
  }

  private parseAndRender(buffer: ScreenBuffer, output: string): void {
    const lines = output.split('\n');

    let currentStyle: Style = {};

    for (let y = 0; y < Math.min(lines.length, buffer.height); y++) {
      const line = lines[y];
      let x = 0;
      let i = 0;
      let run = '';

      // Write the pending text run with the current style. ScreenBuffer.write
      // splits by grapheme and measures display width, so surrogate pairs
      // (emoji) and combining characters stay intact — iterating UTF-16 code
      // units here would tear them apart.
      const flushRun = () => {
        if (run.length === 0) return;
        x = buffer.write(x, y, run, { style: currentStyle }).x;
        run = '';
      };

      while (i < line.length) {
        // Parse ANSI escape sequences
        if (line[i] === '\x1b' && line[i + 1] === '[') {
          const match = line.slice(i).match(/^\x1b\[([0-9;]*)m/);
          if (match) {
            flushRun();
            currentStyle = this.parseAnsiCodes(match[1], currentStyle);
            i += match[0].length;
            continue;
          }

          // Skip other escape sequences
          const otherMatch = line.slice(i).match(/^\x1b\[[0-9;]*[A-Za-z]/);
          if (otherMatch) {
            flushRun();
            i += otherMatch[0].length;
            continue;
          }
        }

        run += line[i];
        i++;
      }

      flushRun();
    }
  }

  private parseAnsiCodes(codes: string, current: Style): Style {
    if (!codes || codes === '0') {
      return {};
    }
    
    const style: Style = { ...current };
    const parts = codes.split(';').map(Number);
    
    for (let i = 0; i < parts.length; i++) {
      const code = parts[i];
      
      switch (code) {
        case 0:
          return {};
        case 1:
          style.bold = true;
          break;
        case 2:
          style.dim = true;
          break;
        case 3:
          style.italic = true;
          break;
        case 4:
          style.underline = true;
          break;
        case 7:
          style.inverse = true;
          break;
        case 9:
          style.strikethrough = true;
          break;
        case 22:
          style.bold = false;
          style.dim = false;
          break;
        case 23:
          style.italic = false;
          break;
        case 24:
          style.underline = false;
          break;
        case 27:
          style.inverse = false;
          break;
        case 29:
          style.strikethrough = false;
          break;
        case 38:
          // Foreground color
          if (parts[i + 1] === 5) {
            style.fg = parts[i + 2];
            i += 2;
          } else if (parts[i + 1] === 2) {
            style.fg = [parts[i + 2], parts[i + 3], parts[i + 4]];
            i += 4;
          }
          break;
        case 39:
          style.fg = null;
          break;
        case 48:
          // Background color
          if (parts[i + 1] === 5) {
            style.bg = parts[i + 2];
            i += 2;
          } else if (parts[i + 1] === 2) {
            style.bg = [parts[i + 2], parts[i + 3], parts[i + 4]];
            i += 4;
          }
          break;
        case 49:
          style.bg = null;
          break;
        default:
          // Basic 16 colors
          if (code >= 30 && code <= 37) {
            style.fg = code - 30;
          } else if (code >= 40 && code <= 47) {
            style.bg = code - 40;
          } else if (code >= 90 && code <= 97) {
            style.fg = code - 90 + 8;
          } else if (code >= 100 && code <= 107) {
            style.bg = code - 100 + 8;
          }
      }
    }
    
    return style;
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.terminal.destroy();
  }
}

/**
 * Create a custom stdout stream that uses diff-based rendering
 */
export function createDiffOutputStream(options: InkDiffRendererOptions = {}): {
  stream: NodeJS.WriteStream;
  renderer: InkDiffRenderer;
} {
  const renderer = new InkDiffRenderer(options);
  let buffer = '';
  let flushScheduled = false;

  // Batch all writes from the same tick into one frame. Ink emits a complete
  // frame per render, but it may arrive split across several write() calls —
  // rendering each chunk as it arrives would paint partial frames.
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    setImmediate(() => {
      flushScheduled = false;
      if (buffer.length > 0) {
        renderer.render(buffer);
        buffer = '';
      }
    });
  };

  // Create a fake write stream
  const stream = {
    write(data: string | Buffer): boolean {
      buffer += typeof data === 'string' ? data : data.toString();
      scheduleFlush();
      return true;
    },
    
    // Proxy other properties from process.stdout
    get columns() {
      return renderer.width;
    },
    get rows() {
      return renderer.height;
    },
    
    on: process.stdout.on.bind(process.stdout),
    off: process.stdout.off.bind(process.stdout),
    once: process.stdout.once.bind(process.stdout),
    emit: process.stdout.emit.bind(process.stdout),
  } as unknown as NodeJS.WriteStream;
  
  return { stream, renderer };
}
