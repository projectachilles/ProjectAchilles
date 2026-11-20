import { Download } from 'lucide-react';
import { CopyButton } from '@/components/shared/ui/CopyButton';
import {
  buildWindowsDeployScript,
  DEPLOY_SCRIPT_FILENAME,
  DETECTION_RULE,
  UNINSTALL_COMMAND,
  type DeployScript,
} from './deployScript';

const GUIDE_URL = 'https://docs.projectachilles.io/docs/user-guide/agent-management/deploying-with-intune';

export interface ManagementToolPanelProps {
  serverUrl: string;
  token: string;
  /** The created token's limits; null when the API did not return them. */
  tokenLimits: { maxUses: number; expiresAt: string } | null;
  /**
   * The registered Windows amd64 agent the script would install. null = it
   * could not be established (readiness or the versions list did not load):
   * no script is offered then, because its signature check depends on it.
   */
  windowsVersion: {
    version: string;
    signed: boolean;
    signerSubject: string | null;
    /** SHA-256 of the certificate the registered binary carries; null when the server could not read it. */
    signerFingerprint: string | null;
  } | null;
}

/** Saves text as a file from the browser; the content goes nowhere else. */
function downloadTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function CopyLine({ label, text, ariaLabel }: { label: string; text: string; ariaLabel: string }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <code className="break-all font-mono text-xs">{text}</code>
      </div>
      <CopyButton text={text} ariaLabel={ariaLabel} />
    </div>
  );
}

/**
 * The "Management tool" install tab: an unattended install script for the
 * token just created, plus the settings Intune (or a similar tool) asks for.
 * The script itself is not displayed: it holds the token, and it is a file to
 * upload, not text to paste.
 */
export function ManagementToolPanel({
  serverUrl,
  token,
  tokenLimits,
  windowsVersion,
}: ManagementToolPanelProps): React.ReactElement {
  let script: DeployScript | null = null;
  let problem: string | null = null;
  if (!windowsVersion) {
    problem = 'Could not check whether this server has a Windows agent, so no script is offered. Reload and try again.';
  } else {
    try {
      script = buildWindowsDeployScript({
        serverUrl,
        token,
        version: windowsVersion.version,
        signerSubject: windowsVersion.signed ? windowsVersion.signerSubject : null,
        signerFingerprint: windowsVersion.signed ? windowsVersion.signerFingerprint : null,
      });
    } catch {
      problem = 'This server address or token cannot be put in a script safely, so no script is offered.';
    }
  }

  return (
    <div role="tabpanel" aria-label="Management tool" className="rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-2 text-xs text-muted">
        Windows, unattended: for Intune, Group Policy or Configuration Manager. Installs the same agent as the Windows command.
      </div>
      <div className="space-y-4 p-3 text-sm">
        {script ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => downloadTextFile(DEPLOY_SCRIPT_FILENAME, script.text)}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent-hover"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download {DEPLOY_SCRIPT_FILENAME}
              </button>
              <span className="text-xs text-muted">
                The file contains this token. Treat it as a secret.
              </span>
            </div>

            <p className="text-xs leading-relaxed text-muted">
              {script.verifiedFingerprint
                ? `The script only runs an agent that carries this server's signing certificate (${script.signerName ? `"${script.signerName}", ` : ''}SHA-256 ending ${script.verifiedFingerprint.slice(-8)}).`
                : 'The script cannot verify the agent it downloads: the registered Windows agent is not signed, or its certificate could not be read.'}
              {' '}An agent that is already installed is left untouched, so the script is safe to run again.
            </p>

            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Intune platform script settings</div>
              <dl className="space-y-1 text-xs">
                <Row label="Run this script using the logged on credentials" value="No" />
                <Row label="Enforce script signature check" value="No" />
                <Row label="Run script in 64-bit PowerShell host" value="Yes" />
              </dl>
            </div>

            <div className="space-y-2">
              <CopyLine
                label="Detection rule: this file exists"
                text={`${DETECTION_RULE.path}\\${DETECTION_RULE.file}`}
                ariaLabel="Copy detection path"
              />
              <CopyLine label="Uninstall command" text={UNINSTALL_COMMAND} ariaLabel="Copy uninstall command" />
            </div>

            {tokenLimits && (
              <p className="text-xs leading-relaxed text-muted">
                This token allows {tokenLimits.maxUses} {tokenLimits.maxUses === 1 ? 'install' : 'installs'} and
                expires {new Date(tokenLimits.expiresAt).toLocaleString()}. A rollout takes days: make sure it
                covers yours, and revoke the token when the rollout is done.
              </p>
            )}
          </>
        ) : (
          <p className="leading-relaxed">{problem}</p>
        )}

        <a
          href={GUIDE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-accent underline-offset-2 hover:underline"
        >
          Deploying with Intune
        </a>
      </div>
    </div>
  );
}
