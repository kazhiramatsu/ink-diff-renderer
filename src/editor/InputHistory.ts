/**
 * InputHistory - Manages input history for up/down navigation
 */

export interface HistoryOptions {
  maxSize?: number;
  deduplicateConsecutive?: boolean;
}

export class InputHistory {
  private history: string[] = [];
  private position: number = -1;
  private currentInput: string = '';
  private maxSize: number;
  private deduplicateConsecutive: boolean;

  constructor(options: HistoryOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.deduplicateConsecutive = options.deduplicateConsecutive ?? true;
  }

  /**
   * Add an entry to history
   */
  add(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Deduplicate consecutive entries
    if (this.deduplicateConsecutive && this.history.length > 0) {
      if (this.history[this.history.length - 1] === trimmed) {
        this.reset();
        return;
      }
    }

    this.history.push(trimmed);

    // Enforce max size
    if (this.history.length > this.maxSize) {
      this.history.shift();
    }

    this.reset();
  }

  /**
   * Reset position to end (for new input)
   */
  reset(): void {
    this.position = -1;
    this.currentInput = '';
  }

  /**
   * Save current input before navigating history
   */
  saveCurrentInput(text: string): void {
    if (this.position === -1) {
      this.currentInput = text;
    }
  }

  /**
   * Navigate to previous entry (older)
   */
  previous(currentText: string): string | null {
    if (this.history.length === 0) return null;

    // Save current input when starting navigation
    if (this.position === -1) {
      this.currentInput = currentText;
    }

    // Calculate next position
    const nextPos = this.position === -1 
      ? this.history.length - 1 
      : Math.max(0, this.position - 1);

    if (nextPos === this.position) {
      return null; // Already at oldest
    }

    this.position = nextPos;
    return this.history[this.position];
  }

  /**
   * Navigate to next entry (newer)
   */
  next(): string | null {
    if (this.position === -1) return null;

    if (this.position >= this.history.length - 1) {
      // Return to current input
      this.position = -1;
      return this.currentInput;
    }

    this.position++;
    return this.history[this.position];
  }

  /**
   * Get current history position (-1 = current input, 0+ = history index)
   */
  getPosition(): number {
    return this.position;
  }

  /**
   * Get total history count
   */
  get length(): number {
    return this.history.length;
  }

  /**
   * Check if currently browsing history
   */
  get isBrowsing(): boolean {
    return this.position !== -1;
  }

  /**
   * Get all history entries
   */
  getAll(): string[] {
    return [...this.history];
  }

  /**
   * Search history for entries containing query
   */
  search(query: string): string[] {
    if (!query) return [];
    const lowerQuery = query.toLowerCase();
    return this.history.filter(entry => 
      entry.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.history = [];
    this.reset();
  }

  /**
   * Serialize for persistence
   */
  toJSON(): string[] {
    return [...this.history];
  }

  /**
   * Load from serialized data
   */
  fromJSON(data: string[]): void {
    this.history = data.slice(-this.maxSize);
    this.reset();
  }
}
