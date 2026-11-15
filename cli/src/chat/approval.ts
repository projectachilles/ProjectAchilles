/**
 * Trusted approval boundary for state-changing chat tools.
 *
 * Model-selected arguments are captured in a pending action, but only fresh
 * terminal input can approve that action. The confirmation text is never
 * added to the model conversation.
 */

import { randomInt, randomUUID } from 'node:crypto';

export type ApprovalTier = 'write' | 'destructive';

export interface PendingAction {
  readonly id: string;
  readonly toolName: string;
  readonly tier: ApprovalTier;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly confirmationText: string;
}

export type RequestApproval = (action: PendingAction) => Promise<boolean>;

export interface CancelledAction {
  status: 'cancelled';
  action: string;
}

function freezeRecursively<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeRecursively(child);
    Object.freeze(value);
  }
  return value;
}

// No 0/O or 1/I/L: the code is read off the screen and typed back.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

/**
 * A short code that is new for every proposal. Its job is to make approval a
 * deliberate act tied to the action on screen: a habitual "yes", or text typed
 * ahead while the model was still answering, approves nothing. It is not a
 * secret (the terminal is the trust boundary, and the model can't type into
 * it), so it stays short enough to type for every tag or note change.
 */
function confirmationCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function createPendingAction(
  toolName: string,
  tier: ApprovalTier,
  description: string,
  parameters: Record<string, unknown>,
): PendingAction {
  const id = randomUUID();
  const frozenParameters = freezeRecursively(parameters);
  return Object.freeze({
    id,
    toolName,
    tier,
    description,
    parameters: Object.freeze({ ...frozenParameters }),
    confirmationText: `confirm ${confirmationCode()}`,
  });
}

export function matchesConfirmation(action: PendingAction, input: string): boolean {
  return input.trim().toLowerCase() === action.confirmationText.toLowerCase();
}

/** Serialize model-emitted tool calls so the terminal presents one action at a time. */
export function serializeApprovalRequests(requestApproval: RequestApproval): RequestApproval {
  let previous = Promise.resolve();

  return (action) => {
    const current = previous.then(() => requestApproval(action));
    previous = current.then(() => undefined, () => undefined);
    return current;
  };
}

/** Execute the trusted API closure only after the terminal approved this exact action. */
export async function executeApprovedAction<T>(
  action: PendingAction,
  requestApproval: RequestApproval,
  execute: () => Promise<T>,
): Promise<T | CancelledAction> {
  if (!await requestApproval(action)) {
    return { status: 'cancelled', action: action.toolName };
  }

  return execute();
}
