/**
 * Terminal output controller with frame rate limiting
 */

import { DiffRenderer, RenderOptions } from './DiffRenderer';
import { ScreenBuffer } from './ScreenBuffer';

export interface TerminalOptions {
  /** Output stream (default: process.stdout) */
  stdout?: NodeJS.WriteStream;
  /** Target frames per second (default: 60) */
  fps?: number;
  /** Use alternate screen buffer (default: true) */
  altScreen?: boolean;
}

export type RenderCallback = (buffer: ScreenBuffer) => void;

export class Terminal {
  private renderer: DiffRenderer;
  private stdout: NodeJS.WriteStream;
  private fps: number;
  private frameTime: number;
  private lastRenderTime = 0;
  private pendingRender = false;
  private renderCallback: RenderCallback | null = null;
  private resizeHandler: (() => void) | null = null;
  private destroyed = false;
  private inAltScreen = false;

  constructor(options: TerminalOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.fps = options.fps ?? 60;
    this.frameTime = 1000 / this.fps;
    
    const { columns = 80, rows = 24 } = this.stdout;
    this.renderer = new DiffRenderer(columns, rows);
    
    this.setupResizeHandler();
    
    if (options.altScreen !== false) {
      this.enterAltScreen();
    }
  }

  get width(): number {
    return this.renderer.width;
  }

  get height(): number {
    return this.renderer.height;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  private setupResizeHandler(): void {
    this.resizeHandler = () => {
      if (this.destroyed) return;
      
      const { columns = 80, rows = 24 } = this.stdout;
      this.renderer.resize(columns, rows);
      this.scheduleRender();
    };
    
    this.stdout.on('resize', this.resizeHandler);
  }

  /**
   * Set the render callback
   */
  onRender(callback: RenderCallback): void {
    this.renderCallback = callback;
  }

  /**
   * Schedule a render for the next frame
   */
  scheduleRender(): void {
    if (this.destroyed || this.pendingRender) return;
    
    this.pendingRender = true;
    
    const now = Date.now();
    const elapsed = now - this.lastRenderTime;
    const delay = Math.max(0, this.frameTime - elapsed);
    
    setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    if (this.destroyed) return;
    
    this.pendingRender = false;
    this.lastRenderTime = Date.now();
    
    // Clear buffer and call render callback
    const buffer = this.renderer.begin();
    
    if (this.renderCallback) {
      try {
        this.renderCallback(buffer);
      } catch (e) {
        // Don't let render errors break the terminal
        console.error('Render error:', e);
      }
    }
    
    // Generate and output diff
    const output = this.renderer.render();
    
    if (output.length > 0) {
      this.stdout.write(output);
    }
  }

  /**
   * Render immediately without waiting for frame timing
   */
  renderNow(): void {
    if (this.destroyed) return;
    
    this.pendingRender = false;
    this.lastRenderTime = Date.now();
    
    const buffer = this.renderer.begin();
    
    if (this.renderCallback) {
      try {
        this.renderCallback(buffer);
      } catch (e) {
        console.error('Render error:', e);
      }
    }
    
    const output = this.renderer.render();
    this.stdout.write(output);
  }

  /**
   * Force a full screen refresh
   */
  fullRefresh(): void {
    if (this.destroyed) return;
    
    const buffer = this.renderer.begin();
    
    if (this.renderCallback) {
      try {
        this.renderCallback(buffer);
      } catch (e) {
        console.error('Render error:', e);
      }
    }
    
    const output = this.renderer.render({ force: true });
    this.stdout.write(output);
  }

  /**
   * Get direct access to the buffer (for manual rendering)
   */
  getBuffer(): ScreenBuffer {
    return this.renderer.getBuffer();
  }

  /**
   * Get direct access to the renderer
   */
  getRenderer(): DiffRenderer {
    return this.renderer;
  }

  /**
   * Enter alternate screen buffer
   */
  enterAltScreen(): void {
    if (this.destroyed || this.inAltScreen) return;
    
    this.stdout.write(DiffRenderer.enterAltScreen());
    this.inAltScreen = true;
  }

  /**
   * Leave alternate screen buffer
   */
  leaveAltScreen(): void {
    if (this.destroyed || !this.inAltScreen) return;
    
    this.stdout.write(DiffRenderer.leaveAltScreen());
    this.inAltScreen = false;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    
    if (this.resizeHandler) {
      this.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    
    // Leave alt screen if we entered it
    if (this.inAltScreen) {
      this.stdout.write(DiffRenderer.leaveAltScreen());
      this.inAltScreen = false;
    }
    
    // Show cursor and reset
    this.stdout.write(DiffRenderer.showCursor() + '\x1b[0m');
  }

  /**
   * Set frame rate
   */
  setFps(fps: number): void {
    this.fps = Math.max(1, Math.min(120, fps));
    this.frameTime = 1000 / this.fps;
  }

  /**
   * Create a terminal and run a render loop
   */
  static run(
    render: RenderCallback,
    options: TerminalOptions = {}
  ): { stop: () => void } {
    const terminal = new Terminal(options);
    terminal.onRender(render);
    terminal.renderNow();
    
    return {
      stop: () => terminal.destroy(),
    };
  }
}
