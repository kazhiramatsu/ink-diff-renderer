/**
 * Basic terminal rendering example
 * Run with: npx ts-node examples/basic.ts
 */

import { Terminal, Colors } from '../src';

const terminal = new Terminal({ fps: 60 });

let counter = 0;
let dots = '';

terminal.onRender((buffer) => {
  // Title
  buffer.write(0, 0, '╔════════════════════════════════════╗', {
    style: { fg: Colors.cyan, bold: true }
  });
  buffer.write(0, 1, '║   Diff Renderer Basic Demo         ║', {
    style: { fg: Colors.cyan, bold: true }
  });
  buffer.write(0, 2, '╚════════════════════════════════════╝', {
    style: { fg: Colors.cyan, bold: true }
  });
  
  // Counter
  buffer.write(2, 4, `Counter: ${counter}`, {
    style: { fg: Colors.green }
  });
  
  // Animated dots
  buffer.write(2, 5, `Loading${dots}`, {
    style: { fg: Colors.yellow }
  });
  
  // Time
  buffer.write(2, 6, `Time: ${new Date().toLocaleTimeString()}`, {
    style: { fg: Colors.white }
  });
  
  // Instructions
  buffer.write(2, 8, 'Press Ctrl+C to exit', {
    style: { fg: Colors.brightBlack }
  });
  
  // Color palette demo
  buffer.write(2, 10, 'Color Palette:', { style: { bold: true } });
  for (let i = 0; i < 16; i++) {
    buffer.write(2 + i * 2, 11, '██', { style: { fg: i } });
  }
});

// Update loop
const updateInterval = setInterval(() => {
  counter++;
  dots = '.'.repeat((counter % 4));
  terminal.scheduleRender();
}, 100);

// Handle exit
process.on('SIGINT', () => {
  clearInterval(updateInterval);
  terminal.destroy();
  console.log('\nGoodbye!');
  process.exit(0);
});

// Initial render
terminal.renderNow();
