/**
 * Deploy launcher. Renders the Ink wizard when attached to a real TTY; the
 * headless runner (deploy.ts) handles the non-interactive / CI path. Mirrors the
 * TTY-detection pattern in cli/src/chat/launch.ts.
 */

import React from 'react';
import { render } from 'ink';
import { DeployWizard, type WizardProps } from './wizard.js';

export function canUseInk(): boolean {
  return Boolean(process.stdin.isTTY) && typeof process.stdin.setRawMode === 'function';
}

export async function launchWizard(props: WizardProps): Promise<void> {
  const { waitUntilExit } = render(React.createElement(DeployWizard, props), {
    exitOnCtrlC: true,
  });
  await waitUntilExit();
}
