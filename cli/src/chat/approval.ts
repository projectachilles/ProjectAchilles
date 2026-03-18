/**
 * HITL confirmation for destructive operations in chat mode.
 *
 * Three tiers:
 * - No approval: read operations (list, show, get)
 * - Brief confirmation: write operations (create, update)
 * - Explicit confirmation: destructive operations (delete, cancel, decommission)
 */

import * as readline from 'readline';

export async function confirmAction(description: string, level: 'brief' | 'explicit' = 'brief'): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    const prompt = level === 'explicit'
      ? `\n⚠️  ${description}\n   Type "yes" to confirm: `
      : `\n→ ${description} [Y/n]: `;

    rl.question(prompt, (answer) => {
      rl.close();
      if (level === 'explicit') {
        resolve(answer.trim().toLowerCase() === 'yes');
      } else {
        resolve(answer.trim().toLowerCase() !== 'n');
      }
    });
  });
}
