/**
 * React hooks for terminal rendering
 */

import type * as React from 'react';
import { Terminal, TerminalOptions, RenderCallback } from '../terminal/Terminal';

// react is an optional peer dependency: resolve it lazily inside each hook so
// that importing this package without react installed does not throw.
function getReact(): typeof React {
  return require('react') as typeof React;
}
import { ScreenBuffer } from '../terminal/ScreenBuffer';
import { Style } from '../terminal/Style';

export interface UseTerminalOptions extends Omit<TerminalOptions, 'stdout'> {
  /** Auto-start rendering on mount */
  autoStart?: boolean;
}

export interface UseTerminalResult {
  /** Current terminal width */
  width: number;
  /** Current terminal height */
  height: number;
  /** Schedule a render for next frame */
  scheduleRender: () => void;
  /** Render immediately */
  renderNow: () => void;
  /** Force full screen refresh */
  fullRefresh: () => void;
  /** Set the render callback */
  setRenderCallback: (callback: RenderCallback) => void;
  /** Whether the terminal has been destroyed */
  isDestroyed: boolean;
}

/**
 * Hook for using diff-based terminal rendering in React
 */
export function useTerminal(options: UseTerminalOptions = {}): UseTerminalResult {
  const { useEffect, useRef, useCallback, useState } = getReact();
  const terminalRef = useRef<Terminal | null>(null);
  const renderCallbackRef = useRef<RenderCallback | null>(null);
  const [dimensions, setDimensions] = useState({ width: 80, height: 24 });
  const [isDestroyed, setIsDestroyed] = useState(false);

  useEffect(() => {
    const terminal = new Terminal({
      fps: options.fps ?? 60,
      altScreen: options.altScreen ?? true,
    });
    
    terminalRef.current = terminal;
    
    setDimensions({ width: terminal.width, height: terminal.height });
    
    // Set up render callback wrapper
    terminal.onRender((buffer) => {
      if (renderCallbackRef.current) {
        renderCallbackRef.current(buffer);
      }
    });

    // Handle resize
    const handleResize = () => {
      if (terminalRef.current && !terminalRef.current.isDestroyed) {
        setDimensions({
          width: terminalRef.current.width,
          height: terminalRef.current.height,
        });
      }
    };
    
    process.stdout.on('resize', handleResize);

    // Initial render if autoStart
    if (options.autoStart !== false) {
      terminal.renderNow();
    }

    return () => {
      terminal.destroy();
      setIsDestroyed(true);
      process.stdout.off('resize', handleResize);
    };
  }, [options.fps, options.altScreen, options.autoStart]);

  const scheduleRender = useCallback(() => {
    terminalRef.current?.scheduleRender();
  }, []);

  const renderNow = useCallback(() => {
    terminalRef.current?.renderNow();
  }, []);

  const fullRefresh = useCallback(() => {
    terminalRef.current?.fullRefresh();
  }, []);

  const setRenderCallback = useCallback((callback: RenderCallback) => {
    renderCallbackRef.current = callback;
  }, []);

  return {
    width: dimensions.width,
    height: dimensions.height,
    scheduleRender,
    renderNow,
    fullRefresh,
    setRenderCallback,
    isDestroyed,
  };
}

/**
 * Hook for throttled state updates (reduces render frequency)
 */
export function useThrottledState<T>(
  initialValue: T,
  throttleMs = 16
): [T, (value: T | ((prev: T) => T)) => void, T] {
  const { useEffect, useRef, useCallback, useState } = getReact();
  const [displayValue, setDisplayValue] = useState<T>(initialValue);
  const pendingValueRef = useRef<T>(initialValue);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastUpdateRef = useRef<number>(0);

  const setValue = useCallback((newValue: T | ((prev: T) => T)) => {
    const resolved = typeof newValue === 'function'
      ? (newValue as (prev: T) => T)(pendingValueRef.current)
      : newValue;
    
    pendingValueRef.current = resolved;
    
    if (timeoutRef.current) return;
    
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;
    const delay = Math.max(0, throttleMs - elapsed);
    
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      lastUpdateRef.current = Date.now();
      setDisplayValue(pendingValueRef.current);
    }, delay);
  }, [throttleMs]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [displayValue, setValue, pendingValueRef.current];
}

/**
 * Hook for batched array updates (useful for streaming data)
 */
export function useBatchedArray<T>(
  maxItems = 1000,
  batchMs = 16
): {
  items: T[];
  push: (item: T) => void;
  pushMany: (items: T[]) => void;
  clear: () => void;
} {
  const { useEffect, useRef, useCallback, useState } = getReact();
  const [items, setItems] = useState<T[]>([]);
  const pendingRef = useRef<T[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const flush = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    
    setItems(prev => {
      const next = [...prev, ...pendingRef.current];
      pendingRef.current = [];
      return next.slice(-maxItems);
    });
  }, [maxItems]);

  const scheduleBatch = useCallback(() => {
    if (timeoutRef.current) return;
    
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      flush();
    }, batchMs);
  }, [batchMs, flush]);

  const push = useCallback((item: T) => {
    pendingRef.current.push(item);
    scheduleBatch();
  }, [scheduleBatch]);

  const pushMany = useCallback((newItems: T[]) => {
    pendingRef.current.push(...newItems);
    scheduleBatch();
  }, [scheduleBatch]);

  const clear = useCallback(() => {
    pendingRef.current = [];
    setItems([]);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { items, push, pushMany, clear };
}
