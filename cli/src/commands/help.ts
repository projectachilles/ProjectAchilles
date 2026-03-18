import { registerCommand } from './registry.js';
import { printGlobalHelp } from './registry.js';
import type { OutputMode } from '../output/formatter.js';

registerCommand({
  name: 'help',
  description: 'Show help information',
  aliases: ['h'],
  handler: async (ctx) => {
    const mode = (ctx.output as unknown as { mode: OutputMode }).mode ?? 'pretty';
    printGlobalHelp(mode);
  },
});
