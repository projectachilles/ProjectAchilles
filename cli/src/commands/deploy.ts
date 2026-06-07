/**
 * `achilles deploy` — unified deployment front door.
 *
 * Interactive (TTY): launches the Ink wizard (mode → target → prereqs → inputs
 *   → run).
 * Headless (no TTY or --json): flag-driven, for CI. Requires --target; per-target
 *   inputs are passed as --<field> flags and validated against the provider's
 *   zod schema.
 *
 * Registered as a normal leaf command so it benefits from the registry's parsing
 * and --json detection. `flags` is intentionally left undefined so arbitrary
 * per-provider input flags pass through to the handler untouched.
 *
 * Examples:
 *   achilles deploy
 *   achilles deploy --mode self-host --target docker
 *   achilles deploy --target docker --elasticsearch true --json
 *   achilles deploy --target server --installTarget this-machine \
 *     --achillesDomain achilles.example.com --clerkPublishableKey pk_live_… \
 *     --clerkSecretKey sk_live_…
 */

import { registerCommand } from './registry.js';
import { canUseInk, launchWizard } from '../deploy/launch.js';
import { runHeadless } from '../deploy/headless.js';
import { isProviderId } from '../deploy/registry.js';
import type { DeployMode } from '../deploy/types.js';

registerCommand({
  name: 'deploy',
  description: 'Deploy ProjectAchilles — interactive wizard or headless (--target for CI)',
  handler: async (ctx) => {
    const json = ctx.output.isJson;
    const target = typeof ctx.flags.target === 'string' ? ctx.flags.target : undefined;
    const modeFlag = typeof ctx.flags.mode === 'string' ? ctx.flags.mode : undefined;

    if (modeFlag && modeFlag !== 'operator' && modeFlag !== 'self-host') {
      ctx.output.error(`--mode must be 'operator' or 'self-host' (got: ${modeFlag})`);
      process.exit(2);
    }
    if (target && !isProviderId(target)) {
      ctx.output.error(`Unknown --target: ${target}`);
      process.exit(2);
    }

    // Headless when output is JSON or there's no interactive TTY.
    if (json || !canUseInk()) {
      const code = await runHeadless({ target, json, flags: ctx.flags });
      if (code !== 0) process.exit(code);
      return;
    }

    // Interactive wizard. Seed mode/target if provided on the CLI.
    await launchWizard({
      initialMode: modeFlag as DeployMode | undefined,
      initialTarget: target,
    });
  },
});
