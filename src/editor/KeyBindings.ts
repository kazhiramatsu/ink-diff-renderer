/**
 * KeyBindings - Keyboard input handling with vim/emacs-style bindings
 */

export type KeyAction = 
  // Cursor movement
  | 'cursorLeft'
  | 'cursorRight'
  | 'cursorUp'
  | 'cursorDown'
  | 'cursorWordLeft'
  | 'cursorWordRight'
  | 'cursorLineStart'
  | 'cursorLineEnd'
  | 'cursorDocStart'
  | 'cursorDocEnd'
  // Editing
  | 'backspace'
  | 'delete'
  | 'deleteWordBackward'
  | 'deleteWordForward'
  | 'deleteToLineStart'
  | 'deleteToLineEnd'
  | 'deleteLine'
  | 'newline'
  | 'submit'
  // Selection
  | 'selectAll'
  // Clipboard
  | 'paste'
  | 'copy'
  | 'cut'
  // History
  | 'historyPrevious'
  | 'historyNext'
  // Other
  | 'cancel'
  | 'clear'
  | 'input';

export interface ParsedKey {
  raw: string;
  char: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  name: string;
}

export interface KeyBindingConfig {
  submitOnEnter?: boolean;        // Enter submits (Shift+Enter for newline)
  submitOnCtrlEnter?: boolean;    // Ctrl+Enter submits (Enter for newline)
  enableEmacs?: boolean;          // Enable emacs-style bindings
  enableHistory?: boolean;        // Enable history navigation
}

const DEFAULT_CONFIG: KeyBindingConfig = {
  submitOnEnter: true,
  submitOnCtrlEnter: false,
  enableEmacs: true,
  enableHistory: true,
};

export class KeyBindings {
  private config: KeyBindingConfig;

  constructor(config: KeyBindingConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Parse raw key input into structured format
   */
  parseKey(key: string): ParsedKey {
    const result: ParsedKey = {
      raw: key,
      char: '',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      name: '',
    };

    // Special characters - check BEFORE control characters
    // because \r (13) and \n (10) fall in the 1-26 range
    switch (key) {
      case '\r':
      case '\n':
        result.name = 'return';
        return result;
      case '\x7f':
      case '\b':
        result.name = 'backspace';
        return result;
      case '\t':
        result.name = 'tab';
        return result;
      case '\x1b':
        result.name = 'escape';
        return result;
    }

    // Control characters (Ctrl+A through Ctrl+Z), excluding special ones
    if (key.length === 1 && key.charCodeAt(0) >= 1 && key.charCodeAt(0) <= 26) {
      result.ctrl = true;
      result.char = String.fromCharCode(key.charCodeAt(0) + 96);
      result.name = `ctrl+${result.char}`;
      return result;
    }

    // Escape sequences
    if (key.startsWith('\x1b')) {
      return this.parseEscapeSequence(key, result);
    }

    // Regular character
    result.char = key;
    result.name = 'char';
    return result;
  }

  private parseEscapeSequence(key: string, result: ParsedKey): ParsedKey {
    // Alt + character
    if (key.length === 2 && key[0] === '\x1b') {
      result.alt = true;
      result.char = key[1];
      result.name = `alt+${key[1]}`;
      return result;
    }

    // CSI sequences
    if (key.startsWith('\x1b[')) {
      const seq = key.slice(2);
      
      // Arrow keys
      if (seq === 'A') { result.name = 'up'; return result; }
      if (seq === 'B') { result.name = 'down'; return result; }
      if (seq === 'C') { result.name = 'right'; return result; }
      if (seq === 'D') { result.name = 'left'; return result; }
      
      // Arrow keys with modifiers (e.g., \x1b[1;5C = Ctrl+Right)
      const modMatch = seq.match(/^1;(\d)([A-D])$/);
      if (modMatch) {
        const mod = parseInt(modMatch[1]);
        const dir = modMatch[2];
        
        result.shift = (mod - 1) & 1 ? true : false;
        result.alt = (mod - 1) & 2 ? true : false;
        result.ctrl = (mod - 1) & 4 ? true : false;
        
        const dirNames: Record<string, string> = { A: 'up', B: 'down', C: 'right', D: 'left' };
        result.name = dirNames[dir];
        
        const modPrefix = [
          result.ctrl ? 'ctrl+' : '',
          result.alt ? 'alt+' : '',
          result.shift ? 'shift+' : '',
        ].join('');
        result.name = modPrefix + result.name;
        return result;
      }
      
      // Home/End
      if (seq === 'H' || seq === '1~') { result.name = 'home'; return result; }
      if (seq === 'F' || seq === '4~') { result.name = 'end'; return result; }
      
      // Delete
      if (seq === '3~') { result.name = 'delete'; return result; }
      
      // Page Up/Down
      if (seq === '5~') { result.name = 'pageup'; return result; }
      if (seq === '6~') { result.name = 'pagedown'; return result; }
      
      // Insert
      if (seq === '2~') { result.name = 'insert'; return result; }
    }
    
    // SS3 sequences (alternative arrow keys)
    if (key.startsWith('\x1bO')) {
      const c = key[2];
      if (c === 'A') { result.name = 'up'; return result; }
      if (c === 'B') { result.name = 'down'; return result; }
      if (c === 'C') { result.name = 'right'; return result; }
      if (c === 'D') { result.name = 'left'; return result; }
      if (c === 'H') { result.name = 'home'; return result; }
      if (c === 'F') { result.name = 'end'; return result; }
    }

    result.name = 'unknown';
    return result;
  }

  /**
   * Map parsed key to action
   */
  getAction(key: ParsedKey): { action: KeyAction; data?: string } {
    const { name, ctrl, alt, shift, char } = key;

    // Cancel
    if (name === 'escape' || (ctrl && char === 'c')) {
      return { action: 'cancel' };
    }

    // Submit / Newline
    if (name === 'return') {
      if (this.config.submitOnEnter) {
        if (shift) {
          return { action: 'newline' };
        }
        return { action: 'submit' };
      }
      if (this.config.submitOnCtrlEnter) {
        if (ctrl) {
          return { action: 'submit' };
        }
        return { action: 'newline' };
      }
      return { action: 'newline' };
    }

    // History navigation
    if (this.config.enableHistory) {
      if (name === 'up' && !shift && !ctrl && !alt) {
        return { action: 'historyPrevious' };
      }
      if (name === 'down' && !shift && !ctrl && !alt) {
        return { action: 'historyNext' };
      }
    }

    // Cursor movement
    if (name === 'left') {
      if (ctrl || alt) return { action: 'cursorWordLeft' };
      return { action: 'cursorLeft' };
    }
    if (name === 'right') {
      if (ctrl || alt) return { action: 'cursorWordRight' };
      return { action: 'cursorRight' };
    }
    if (name === 'up') {
      return { action: 'cursorUp' };
    }
    if (name === 'down') {
      return { action: 'cursorDown' };
    }
    if (name === 'home') {
      return { action: 'cursorLineStart' };
    }
    if (name === 'end') {
      return { action: 'cursorLineEnd' };
    }

    // Emacs-style bindings
    if (this.config.enableEmacs && ctrl) {
      switch (char) {
        case 'a': return { action: 'cursorLineStart' };
        case 'e': return { action: 'cursorLineEnd' };
        case 'b': return { action: 'cursorLeft' };
        case 'f': return { action: 'cursorRight' };
        case 'p': return { action: 'cursorUp' };
        case 'n': return { action: 'cursorDown' };
        case 'u': return { action: 'deleteToLineStart' };
        case 'k': return { action: 'deleteToLineEnd' };
        case 'w': return { action: 'deleteWordBackward' };
        case 'd': return { action: 'delete' };
        case 'h': return { action: 'backspace' };
        case 'l': return { action: 'clear' };
      }
    }

    // Alt+Backspace (delete word backward)
    if (alt && name === 'backspace') {
      return { action: 'deleteWordBackward' };
    }

    // Backspace
    if (name === 'backspace') {
      if (ctrl) return { action: 'deleteWordBackward' };
      return { action: 'backspace' };
    }

    // Delete
    if (name === 'delete') {
      if (ctrl) return { action: 'deleteWordForward' };
      return { action: 'delete' };
    }

    // Select all
    if (ctrl && char === 'a' && !this.config.enableEmacs) {
      return { action: 'selectAll' };
    }

    // Clipboard (these need external implementation)
    if (ctrl && char === 'v') {
      return { action: 'paste' };
    }
    if (ctrl && char === 'c' && false) { // Disabled, Ctrl+C is cancel
      return { action: 'copy' };
    }
    if (ctrl && char === 'x') {
      return { action: 'cut' };
    }

    // Regular character input
    if (name === 'char' && char && !ctrl && !alt) {
      return { action: 'input', data: char };
    }

    // Multi-byte input (e.g., Japanese)
    if (key.raw.length > 0 && !key.raw.startsWith('\x1b') && !ctrl) {
      // Filter out control characters
      const printable = key.raw.replace(/[\x00-\x1f\x7f]/g, '');
      if (printable) {
        return { action: 'input', data: printable };
      }
    }

    // Unknown - treat as input if printable
    if (!ctrl && !alt && char) {
      return { action: 'input', data: char };
    }

    return { action: 'input', data: '' };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<KeyBindingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): KeyBindingConfig {
    return { ...this.config };
  }
}
