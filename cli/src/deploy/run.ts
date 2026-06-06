/**
 * Shell-out helper: spawns a child process and yields its output line-by-line
 * as `LogLine`s. Every shell-backed deploy step funnels through here so the Ink
 * log pane and the headless runner share one streaming path.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { LogLine } from './types.js';

export interface RunOptions {
  cwd?: string;
  /** Extra environment variables, merged over `process.env`. */
  env?: Record<string, string>;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * Resolve the repository root by walking up from this file until a marker is
 * found. Works regardless of the caller's cwd (the CLI may be invoked from
 * anywhere). Markers are files that only exist at the repo root.
 */
export function findRepoRoot(): string {
  const markers = ['deploy.config.env.example', 'docker-compose.yml'];
  let dir = dirname(fileURLToPath(import.meta.url));
  // Walk up to a reasonable depth.
  for (let i = 0; i < 12; i++) {
    if (markers.some((m) => existsSync(join(dir, m)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate the ProjectAchilles repository root. Run `achilles deploy` from inside the repo.',
  );
}

/** Absolute path to a script under `scripts/`. */
export function scriptPath(...parts: string[]): string {
  return join(findRepoRoot(), 'scripts', ...parts);
}

/**
 * Spawn `command args…` and yield each output line. Resolves when the process
 * exits 0; throws `CommandError` on a non-zero exit. stdin is inherited from
 * the parent so child scripts that prompt interactively still work when the
 * wizard is attached to a TTY.
 */
export async function* run(
  command: string,
  args: string[],
  opts: RunOptions = {},
): AsyncIterable<LogLine> {
  const child = spawn(command, args, {
    cwd: opts.cwd ?? findRepoRoot(),
    env: { ...process.env, ...opts.env },
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  // Bridge the two output streams into one async queue.
  const queue: LogLine[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;
  let exitCode: number | null = null;
  let spawnError: Error | null = null;

  const push = (line: LogLine) => {
    queue.push(line);
    resolveNext?.();
    resolveNext = null;
  };

  const wire = (stream: NodeJS.ReadableStream | null, kind: 'out' | 'err') => {
    if (!stream) return;
    let buf = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        push({ stream: kind, text: buf.slice(0, idx) });
        buf = buf.slice(idx + 1);
      }
    });
    stream.on('end', () => {
      if (buf.length > 0) push({ stream: kind, text: buf });
    });
  };

  wire(child.stdout, 'out');
  wire(child.stderr, 'err');

  child.on('error', (err) => {
    spawnError = err;
    done = true;
    resolveNext?.();
    resolveNext = null;
  });

  child.on('close', (code) => {
    exitCode = code ?? 0;
    done = true;
    resolveNext?.();
    resolveNext = null;
  });

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (done) break;
    await new Promise<void>((resolve) => {
      resolveNext = resolve;
    });
  }

  // Drain anything that landed alongside the close event.
  while (queue.length > 0) yield queue.shift()!;

  if (spawnError) {
    const err = spawnError as Error;
    throw new CommandError(
      `Failed to run ${command}: ${err.message}`,
      127,
    );
  }
  if (exitCode !== 0) {
    throw new CommandError(
      `${command} exited with code ${exitCode}`,
      exitCode ?? 1,
    );
  }
}

/** Check whether an executable is resolvable on PATH (read-only). */
export async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(process.platform === 'win32' ? 'where' : 'which', [command], {
      stdio: 'ignore',
    });
    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Run a short command and capture its combined output + exit code, without
 * streaming. Used by prereq checks (e.g. `doctl account get`). Never throws.
 */
export async function probe(
  command: string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (c) => (output += c));
    child.stderr?.on('data', (c) => (output += c));
    child.on('error', () => resolve({ ok: false, output }));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
  });
}
