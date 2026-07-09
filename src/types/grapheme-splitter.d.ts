declare module 'grapheme-splitter' {
  export default class GraphemeSplitter {
    splitGraphemes(str: string): string[];
    iterateGraphemes(str: string): IterableIterator<string>;
    countGraphemes(str: string): number;
  }
}
