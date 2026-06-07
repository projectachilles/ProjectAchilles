/**
 * Headless / CI deploy path. Maps `--flag value` inputs onto the selected
 * provider's zod schema (coercing booleans), runs the plan with `headless=true`
 * (manual steps print + auto-continue), and emits either streaming text or a
 * structured `--json` summary. No TTY required.
 */

import { getProvider, isProviderId } from './registry.js';
import { fieldsFromSchema } from './schema-form.js';
import { runPlan, type StepResult } from './runner.js';
import { findRepoRoot } from './run.js';
import { colors } from '../output/colors.js';

export interface HeadlessOptions {
  target?: string;
  json: boolean;
  flags: Record<string, unknown>;
}

/** Coerce a raw flag value to the type the schema field expects. */
function coerce(kind: 'string' | 'enum' | 'boolean', value: unknown): unknown {
  if (kind === 'boolean') {
    if (typeof value === 'boolean') return value;
    const s = String(value).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return String(value);
}

export async function runHeadless(opts: HeadlessOptions): Promise<number> {
  const { target, json, flags } = opts;

  if (!target || !isProviderId(target)) {
    const msg = `Headless deploy requires a valid --target. One of: digitalocean, server, docker, fly, render, vercel, railway`;
    if (json) console.error(JSON.stringify({ error: msg }));
    else console.error(`  ${colors.brightRed('✗')} ${msg}`);
    return 2;
  }

  const provider = getProvider(target)!;

  // Build the raw input object from flags that match schema field names.
  const fields = fieldsFromSchema(provider.inputSchema());
  const raw: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.name in flags) raw[field.name] = coerce(field.kind, flags[field.name]);
  }

  const parsed = provider.inputSchema().safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    const msg = `Invalid inputs for ${target}: ${detail}`;
    if (json) console.error(JSON.stringify({ error: msg }));
    else console.error(`  ${colors.brightRed('✗')} ${msg}`);
    return 2;
  }

  const inputs = parsed.data as Record<string, unknown>;
  const repoRoot = findRepoRoot();

  if (!json) {
    console.log(`  ${colors.bold('Achilles Deploy')} ${colors.dim(`(headless · ${provider.label})`)}\n`);
  }

  const result = await runPlan(provider, inputs, repoRoot, true, {
    onLog: (line) => {
      if (json) return; // suppress raw logs in JSON mode; summary emitted at end
      const prefix = line.stream === 'err' ? colors.red('  ! ') : '    ';
      console.log(`${prefix}${line.text}`);
    },
    onStepStart: (step, index, total) => {
      if (json) return;
      console.log(`\n  ${colors.cyan(`[${index + 1}/${total}]`)} ${step.title}`);
    },
  });

  if (json) {
    console.log(
      JSON.stringify(
        {
          data: { target, ok: result.ok, steps: result.results as StepResult[] },
          command: 'deploy',
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      result.ok
        ? `\n  ${colors.brightGreen('✓')} Deployment steps complete.`
        : `\n  ${colors.brightRed('✗')} Deployment stopped — see output above.`,
    );
  }

  return result.ok ? 0 : 1;
}
