/**
 * Command registration, parsing, and routing.
 *
 * Commands are defined declaratively with metadata for help generation
 * and JSON discovery. The registry handles arg parsing, flag validation,
 * and dispatching to the correct handler.
 */

import { Formatter, type OutputMode } from '../output/formatter.js';
import { jsonHelp, type JsonHelpOutput } from '../output/json.js';
import { colors } from '../output/colors.js';
import { CLI_NAME, CLI_DESCRIPTION, VERSION } from '../config/constants.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FlagDef {
  type: 'string' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  default?: unknown;
  choices?: string[];
  alias?: string;
}

export interface ArgDef {
  name: string;
  required?: boolean;
  description?: string;
}

export interface CommandContext {
  output: Formatter;
  args: Record<string, string>;
  flags: Record<string, unknown>;
  rawArgs: string[];
}

export interface SubcommandDef {
  description: string;
  args?: ArgDef[];
  flags?: Record<string, FlagDef>;
  handler: (ctx: CommandContext) => Promise<void>;
}

export interface CommandDef {
  name: string;
  description: string;
  aliases?: string[];
  /** If handler is set, command has no subcommands (leaf command) */
  handler?: (ctx: CommandContext) => Promise<void>;
  /** Optional flags for the root command */
  flags?: Record<string, FlagDef>;
  args?: ArgDef[];
  subcommands?: Record<string, SubcommandDef>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const commands = new Map<string, CommandDef>();
const aliases = new Map<string, string>();

export function registerCommand(cmd: CommandDef): void {
  commands.set(cmd.name, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      aliases.set(alias, cmd.name);
    }
  }
}

export function getCommand(name: string): CommandDef | undefined {
  return commands.get(name) ?? commands.get(aliases.get(name) ?? '');
}

export function getAllCommands(): CommandDef[] {
  return Array.from(commands.values());
}

// ─── Arg Parsing ────────────────────────────────────────────────────────────

export interface ParsedArgs {
  command?: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, unknown>;
  globalFlags: {
    json: boolean;
    help: boolean;
    version: boolean;
  };
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    positional: [],
    flags: {},
    globalFlags: { json: false, help: false, version: false },
  };

  let i = 0;
  // Skip 'bun' and script path if present
  while (i < argv.length && (argv[i].includes('bun') || argv[i].endsWith('.ts') || argv[i].endsWith('.js'))) {
    i++;
  }

  const positionals: string[] = [];

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--json') {
      result.globalFlags.json = true;
    } else if (arg === '--help' || arg === '-h') {
      result.globalFlags.help = true;
    } else if (arg === '--version' || arg === '-V') {
      result.globalFlags.version = true;
    } else if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        result.flags[key] = arg.slice(eqIdx + 1);
      } else if (arg.startsWith('--no-')) {
        result.flags[arg.slice(5)] = false;
      } else {
        const key = arg.slice(2);
        // Check if next arg is a value or another flag
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          result.flags[key] = argv[i + 1];
          i++;
        } else {
          result.flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        result.flags[key] = argv[i + 1];
        i++;
      } else {
        result.flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }

    i++;
  }

  // First positional = command, second = subcommand, rest = args
  if (positionals.length > 0) result.command = positionals[0];
  if (positionals.length > 1) result.subcommand = positionals[1];
  if (positionals.length > 2) result.positional = positionals.slice(2);

  return result;
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateFlags(
  flags: Record<string, unknown>,
  defs: Record<string, FlagDef>,
): Record<string, unknown> {
  const validated: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(defs)) {
    let value = flags[name] ?? flags[def.alias ?? ''];

    if (value === undefined) {
      if (def.required) throw new Error(`Missing required flag: --${name}`);
      if (def.default !== undefined) value = def.default;
      else continue;
    }

    // Type coercion
    switch (def.type) {
      case 'number': {
        const num = Number(value);
        if (isNaN(num)) throw new Error(`Flag --${name} must be a number, got: ${value}`);
        value = num;
        break;
      }
      case 'boolean':
        if (typeof value === 'string') value = value !== 'false' && value !== '0';
        break;
      case 'string':
        value = String(value);
        break;
    }

    if (def.choices && !def.choices.includes(String(value))) {
      throw new Error(`Flag --${name} must be one of: ${def.choices.join(', ')}. Got: ${value}`);
    }

    validated[name] = value;
  }

  return validated;
}

function resolveArgs(positional: string[], defs: ArgDef[]): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (let i = 0; i < (defs?.length ?? 0); i++) {
    const def = defs[i];
    if (i < positional.length) {
      resolved[def.name] = positional[i];
    } else if (def.required) {
      throw new Error(`Missing required argument: <${def.name}>`);
    }
  }
  return resolved;
}

// ─── Help ───────────────────────────────────────────────────────────────────

export function printGlobalHelp(mode: OutputMode): void {
  if (mode === 'json') {
    const allCmds = getAllCommands();
    const help: JsonHelpOutput = {
      name: CLI_NAME,
      description: CLI_DESCRIPTION,
      subcommands: allCmds.map(cmd => ({
        name: cmd.name,
        description: cmd.description,
      })),
    };
    console.log(jsonHelp(help));
    return;
  }

  console.log(`
  ${colors.bold(CLI_NAME)} ${colors.dim(`v${VERSION}`)}
  ${CLI_DESCRIPTION}

  ${colors.bold('Usage:')}
    ${CLI_NAME} <command> [subcommand] [flags]
    ${CLI_NAME}                           ${colors.dim('# Show help')}
    ${CLI_NAME} chat                      ${colors.dim('# AI conversational agent')}

  ${colors.bold('Commands:')}`);

  const allCmds = getAllCommands().sort((a, b) => a.name.localeCompare(b.name));
  const maxLen = Math.max(...allCmds.map(c => c.name.length));
  for (const cmd of allCmds) {
    console.log(`    ${colors.cyan(cmd.name.padEnd(maxLen + 2))} ${cmd.description}`);
  }

  console.log(`
  ${colors.bold('Global Flags:')}
    ${'--json'.padEnd(maxLen + 2)} Output structured JSON (for LLMs/scripts)
    ${'--help, -h'.padEnd(maxLen + 2)} Show help
    ${'--version, -V'.padEnd(maxLen + 2)} Show version
`);
}

export function printCommandHelp(cmd: CommandDef, mode: OutputMode): void {
  if (mode === 'json') {
    const help: JsonHelpOutput = {
      name: cmd.name,
      description: cmd.description,
      subcommands: cmd.subcommands
        ? Object.entries(cmd.subcommands).map(([name, sub]) => ({
            name,
            description: sub.description,
            args: sub.args?.map(a => ({ name: a.name, required: a.required ?? false, description: a.description })),
            flags: sub.flags
              ? Object.entries(sub.flags).map(([fname, fdef]) => ({
                  name: fname,
                  type: fdef.type,
                  required: fdef.required,
                  default: fdef.default,
                  choices: fdef.choices,
                  description: fdef.description,
                }))
              : undefined,
          }))
        : undefined,
    };
    console.log(jsonHelp(help));
    return;
  }

  console.log(`
  ${colors.bold(`${CLI_NAME} ${cmd.name}`)} — ${cmd.description}
`);

  if (cmd.subcommands) {
    console.log(`  ${colors.bold('Subcommands:')}`);
    const entries = Object.entries(cmd.subcommands);
    const maxLen = Math.max(...entries.map(([name]) => name.length));
    for (const [name, sub] of entries) {
      const argsStr = sub.args?.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ') ?? '';
      console.log(`    ${colors.cyan(name.padEnd(maxLen + 2))} ${argsStr ? argsStr + '  ' : ''}${sub.description}`);
    }
    console.log();
  }

  // Print flags for each subcommand
  if (cmd.subcommands) {
    for (const [name, sub] of Object.entries(cmd.subcommands)) {
      if (!sub.flags || Object.keys(sub.flags).length === 0) continue;
      console.log(`  ${colors.bold(`Flags for '${name}':`)} `);
      for (const [fname, fdef] of Object.entries(sub.flags)) {
        const alias = fdef.alias ? `-${fdef.alias}, ` : '    ';
        const req = fdef.required ? colors.red(' (required)') : '';
        const def = fdef.default !== undefined ? colors.dim(` [default: ${fdef.default}]`) : '';
        const choices = fdef.choices ? colors.dim(` (${fdef.choices.join('|')})`) : '';
        console.log(`    ${alias}--${fname.padEnd(18)} ${fdef.description ?? ''}${choices}${def}${req}`);
      }
      console.log();
    }
  }
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function dispatch(parsed: ParsedArgs): Promise<void> {
  const mode: OutputMode = parsed.globalFlags.json ? 'json' : 'pretty';

  // Version
  if (parsed.globalFlags.version) {
    if (mode === 'json') {
      console.log(JSON.stringify({ version: VERSION }));
    } else {
      console.log(`${CLI_NAME} v${VERSION}`);
    }
    return;
  }

  // No command → show help (dashboard handled separately in index.ts)
  if (!parsed.command) {
    if (parsed.globalFlags.help) {
      printGlobalHelp(mode);
    }
    return;
  }

  // Find command
  const cmd = getCommand(parsed.command);
  if (!cmd) {
    const msg = `Unknown command: ${parsed.command}. Run '${CLI_NAME} --help' for available commands.`;
    if (mode === 'json') {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error(`  ${colors.brightRed('✗')} ${msg}`);
    }
    process.exit(1);
  }

  // Help for specific command
  if (parsed.globalFlags.help) {
    printCommandHelp(cmd, mode);
    return;
  }

  // Leaf command (no subcommands)
  if (cmd.handler && !cmd.subcommands) {
    const flags = cmd.flags ? validateFlags(parsed.flags, cmd.flags) : parsed.flags;
    const args = cmd.args ? resolveArgs(parsed.positional, cmd.args) : {};
    const ctx: CommandContext = {
      output: new Formatter(mode, cmd.name),
      args,
      flags,
      rawArgs: parsed.positional,
    };
    await cmd.handler(ctx);
    return;
  }

  // Subcommand dispatch
  if (!parsed.subcommand) {
    printCommandHelp(cmd, mode);
    return;
  }

  const sub = cmd.subcommands?.[parsed.subcommand];
  if (!sub) {
    const msg = `Unknown subcommand: ${parsed.command} ${parsed.subcommand}`;
    if (mode === 'json') {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error(`  ${colors.brightRed('✗')} ${msg}`);
    }
    process.exit(1);
  }

  const flags = sub.flags ? validateFlags(parsed.flags, sub.flags) : parsed.flags;
  const args = sub.args ? resolveArgs(parsed.positional, sub.args) : {};
  const commandPath = `${cmd.name} ${parsed.subcommand}`;

  const ctx: CommandContext = {
    output: new Formatter(mode, commandPath),
    args,
    flags,
    rawArgs: parsed.positional,
  };

  await sub.handler(ctx);
}
