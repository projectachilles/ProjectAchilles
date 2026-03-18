/**
 * Main router: determines execution mode and dispatches accordingly.
 *
 * Three modes:
 * 1. No args → Full-screen TUI dashboard (Phase 6)
 * 2. achilles <command> [args] → Standalone command
 * 3. achilles chat → AI conversational agent (Phase 7)
 */

import { parseArgs, dispatch, printGlobalHelp } from './commands/registry.js';
import { ApiError, AuthError, NetworkError } from './api/client.js';
import { colors } from './output/colors.js';
import { launchTUI } from './tui/app.js';
import { launchChat } from './chat/launch.js';

// ─── Register all commands ──────────────────────────────────────────────────
import './commands/status.js';
import './commands/login.js';
import './commands/config.js';
import './commands/agents.js';
import './commands/tokens.js';
import './commands/tasks.js';
import './commands/schedules.js';
import './commands/versions.js';
import './commands/browser.js';
import './commands/analytics.js';
import './commands/defender.js';
import './commands/builds.js';
import './commands/certs.js';
import './commands/integrations.js';
import './commands/risk.js';
import './commands/users.js';
import './commands/help.js';

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  // No command and no flags → Full-screen TUI dashboard
  if (!parsed.command && !parsed.globalFlags.help && !parsed.globalFlags.version) {
    await launchTUI();
    return;
  }

  // Chat mode — AI conversational agent
  if (parsed.command === 'chat') {
    await launchChat();
    return;
  }

  // Dashboard alias
  if (parsed.command === 'dashboard') {
    await launchTUI();
    return;
  }

  // Dispatch command
  try {
    await dispatch(parsed);
  } catch (err) {
    const isJson = parsed.globalFlags.json;

    if (err instanceof AuthError) {
      if (isJson) {
        console.error(JSON.stringify({ error: err.message, code: 'AUTH_ERROR' }));
      } else {
        console.error(`\n  ${colors.brightRed('✗')} ${err.message}`);
        console.error(`    Run ${colors.cyan('achilles login')} to authenticate.\n`);
      }
      process.exit(1);
    }

    if (err instanceof NetworkError) {
      if (isJson) {
        console.error(JSON.stringify({ error: err.message, code: 'NETWORK_ERROR' }));
      } else {
        console.error(`\n  ${colors.brightRed('✗')} ${err.message}\n`);
      }
      process.exit(1);
    }

    if (err instanceof ApiError) {
      if (isJson) {
        console.error(JSON.stringify({ error: err.message, code: 'API_ERROR', status: err.statusCode }));
      } else {
        console.error(`\n  ${colors.brightRed('✗')} API Error (${err.statusCode}): ${err.message}\n`);
      }
      process.exit(1);
    }

    if (err instanceof Error) {
      if (isJson) {
        console.error(JSON.stringify({ error: err.message, code: 'CLI_ERROR' }));
      } else {
        console.error(`\n  ${colors.brightRed('✗')} ${err.message}\n`);
      }
      process.exit(1);
    }

    throw err;
  }
}
