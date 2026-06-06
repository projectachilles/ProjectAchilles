/**
 * Core abstractions for the `achilles deploy` wizard.
 *
 * Each deployment target is a self-contained `DeployProvider` so the wizard
 * stays generic: pick mode → pick provider → check prereqs → collect inputs →
 * walk steps. Adding a target later is a new file under `providers/`, not a
 * wizard rewrite.
 */

import type { z } from 'zod';

export type DeployMode = 'operator' | 'self-host';

export type ProviderId =
  | 'digitalocean'
  | 'server'
  | 'docker'
  | 'fly'
  | 'render'
  | 'vercel'
  | 'railway';

/** A single line of output from a running step. */
export interface LogLine {
  /** 'out' = stdout, 'err' = stderr, 'info' = wizard-generated note. */
  stream: 'out' | 'err' | 'info';
  text: string;
}

/** Result of a single prerequisite check (e.g. "is doctl installed + authed"). */
export interface Prereq {
  id: string;
  label: string;
  ok: boolean;
  /** Shown when `ok` is false — how to satisfy the prereq. */
  hint?: string;
  /** If true, the deploy cannot proceed until satisfied. */
  required: boolean;
}

/**
 * One ordered unit of work.
 *
 * - `automated` steps run `execute()`, streaming `LogLine`s into the log pane.
 * - `manual` steps render `instructions` as a checklist with copy-paste blocks
 *   and pause until the user confirms.
 */
export interface Step {
  id: string;
  title: string;
  kind: 'automated' | 'manual';
  /** Human-readable instructions for `manual` steps (markdown-ish plaintext). */
  instructions?: string;
  /** Copy-paste command blocks for `manual` steps. */
  commands?: string[];
}

/** Context handed to `execute()` for a step. */
export interface ExecContext {
  /** Validated inputs from the provider's `inputSchema()`. */
  inputs: Record<string, unknown>;
  /** Absolute path to the repository root. */
  repoRoot: string;
  /** When true (CI / non-interactive), never prompt; fail loudly instead. */
  headless: boolean;
}

export interface DeployProvider {
  id: ProviderId;
  label: string;
  /** One-line description shown in the target picker. */
  summary: string;
  modes: DeployMode[];
  automation: 'automated' | 'guided';

  /** Detect installed/authed tooling. Pure read-only checks. */
  checkPrereqs(): Promise<Prereq[]>;

  /** Zod schema describing the inputs the wizard must collect. */
  inputSchema(): z.ZodTypeAny;

  /** Ordered steps for the given (already-validated) inputs. */
  plan(inputs: Record<string, unknown>): Step[];

  /** Run an automated step (or yield the manual instruction text). */
  execute(step: Step, ctx: ExecContext): AsyncIterable<LogLine>;
}
