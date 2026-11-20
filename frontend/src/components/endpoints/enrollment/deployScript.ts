// The unattended Windows install script offered for a management tool
// (Intune platform script, Intune Win32 app, GPO, Configuration Manager).
// It installs the standard registered agent: nothing is built per enrollment.
//
// Differences from the paste-in one-liner (installCommands.ts), all because
// nobody is watching it run and the tool may run it more than once:
//   - an agent that is already installed is left alone (Intune runs a
//     device-assigned script again for each new user who signs in);
//   - it refuses to run unelevated and says which Intune setting to change;
//   - it can require the downloaded binary to carry the server's signing
//     certificate (pinned by fingerprint) before running it as SYSTEM;
//   - it exits 0 or 1, which is what the tool reports and retries on.
// The C:\F0 checks and lock are the same lines as the one-liner's.

import { WINDOWS_FOLDER_LOCK_LINES, isNgrokHost } from './installCommands';

export const DEPLOY_SCRIPT_FILENAME = 'Install-AchillesAgent.ps1';

/** What a management tool's "is it installed" rule should look for. */
export const DETECTION_RULE = { path: 'C:\\F0', file: 'achilles-agent.exe' } as const;

export const UNINSTALL_COMMAND = 'C:\\F0\\achilles-agent.exe --uninstall';

export interface DeployScriptInput {
  serverUrl: string;
  token: string;
  /** Registered Windows amd64 version, for the header comment. */
  version: string | null;
  /** `signer_subject` of that version, for display only (comment header, dialog). */
  signerSubject: string | null;
  /**
   * `signer_fingerprint` of that version: SHA-256 of the certificate the
   * registered binary is signed with. null = no signature check.
   */
  signerFingerprint: string | null;
}

export interface DeployScript {
  /** CRLF line endings, ASCII only (Windows PowerShell 5.1 reads a BOM-less file as Windows-1252). */
  text: string;
  /** The certificate fingerprint the script pins, or null when it cannot verify the binary. */
  verifiedFingerprint: string | null;
  /** The signer's common name when it is safe to show, for display. */
  signerName: string | null;
}

// Both values are written into single-quoted PowerShell strings and onto a
// command line. Anything outside these sets could end the string or the
// argument, so the builder refuses rather than escapes.
const SAFE_VALUE = /^[A-Za-z0-9._~:/\-[\]@%+=?&]+$/;
const SAFE_COMMON_NAME = /^[A-Za-z0-9 ._,()&-]+$/;
const FINGERPRINT = /^[0-9A-F]{64}$/;

/** CN from an OpenSSL one-line subject ("/C=XX/O=Acme/CN=Acme Code Signing"), or null. */
export function signerCommonName(subject: string | null): string | null {
  if (!subject) return null;
  // Attributes are separated by '/' (older osslsigncode) or ',' (newer ones).
  const match = subject.match(/(?:^|[\/,])\s*CN=([^\/,]+)/);
  return match ? match[1].trim() : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Throws Error('unsafe value') when serverUrl or token could not be embedded safely. */
export function buildWindowsDeployScript(input: DeployScriptInput): DeployScript {
  const { serverUrl, token, version } = input;
  if (!SAFE_VALUE.test(token) || !SAFE_VALUE.test(serverUrl) || !isHttpUrl(serverUrl)) {
    throw new Error('unsafe value');
  }

  // The pin is the certificate itself, not its name: anyone can issue
  // themselves a certificate with the same name. No check rather than a
  // broken one when the fingerprint is missing or malformed.
  const candidate = input.signerFingerprint?.toUpperCase() ?? '';
  const verifiedFingerprint = FINGERPRINT.test(candidate) ? candidate : null;
  const commonName = signerCommonName(input.signerSubject);
  const signerName = commonName && SAFE_COMMON_NAME.test(commonName) ? commonName : null;

  const url = `${serverUrl}/api/agent/download?os=windows&arch=amd64`;
  const headers = isNgrokHost(serverUrl) ? ' -Headers @{"ngrok-skip-browser-warning"="true"}' : '';

  // Windows reports a tampered file as HashMismatch and an unsigned one as
  // NotSigned whatever the trust stores say. An intact signature is Valid, or
  // UnknownError when Windows won't chain the certificate (not trusted on this
  // computer, or a self-signed certificate marked as a CA). So: intact
  // signature, and exactly the pinned certificate. The endpoint does not have
  // to trust the certificate for this check.
  const signatureBlock = verifiedFingerprint
    ? [
        '',
        "  # Run only an agent that carries the server's signing certificate.",
        '  $sig = Get-AuthenticodeSignature -LiteralPath $exe',
        "  $fingerprint = ''",
        "  if ($sig.SignerCertificate) { $fingerprint = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($sig.SignerCertificate.RawData)).Replace('-', '') }",
        `  if (@('Valid', 'UnknownError') -notcontains $sig.Status -or $fingerprint -ne '${verifiedFingerprint}') {`,
        '    Remove-Item -LiteralPath $exe -Force',
        '    throw "The downloaded agent does not carry the expected signing certificate (signature status: $($sig.Status); certificate: $fingerprint). If the signing certificate or the agent was changed on the server, download a new script."',
        '  }',
        "  Log 'Signature verified.'",
      ]
    : [];

  const lines = [
    '# Install-AchillesAgent.ps1',
    '# Installs and enrolls the ProjectAchilles agent on this computer, unattended.',
    '# For a management tool: Intune platform script or Win32 app, Group Policy,',
    '# Configuration Manager. Run it as SYSTEM or an administrator, in 64-bit PowerShell.',
    '#',
    `# Server:    ${serverUrl}`,
    `# Agent:     ${version ?? 'latest registered'} (Windows amd64)`,
    verifiedFingerprint
      ? `# Signature: verified, the agent must carry the certificate${signerName ? ` "${signerName}"` : ''} with SHA-256`
      : '# Signature: not verified (the registered agent is not signed, or its certificate could not be read)',
    ...(verifiedFingerprint ? [`#            ${verifiedFingerprint}`] : []),
    '#',
    '# Safe to run again: an agent that is already installed is left untouched.',
    '# This file contains an enrollment token. Treat it as a secret.',
    '',
    "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'",
    '',
    "$exe = 'C:\\F0\\achilles-agent.exe'",
    "$config = 'C:\\F0\\achilles-agent.yaml'",
    "$logFile = 'C:\\F0\\achilles-install.log'",
    '# The log file is only written once C:\\F0 has been checked and locked below.',
    '$logToFile = $false',
    'function Log($message) {',
    '  $line = "$(Get-Date -Format s) $message"',
    '  Write-Output $line',
    '  if ($logToFile) { Add-Content -LiteralPath $logFile -Value $line -Encoding ASCII }',
    '}',
    '',
    'try {',
    '  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '  $elevated = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    '  if (-not $elevated) { throw \'This script must run as SYSTEM or an administrator. In Intune, set "Run this script using the logged on credentials" to No.\' }',
    '',
    '  # Already installed: leave it alone. A management tool may run this again.',
    "  $service = Get-Service -Name 'AchillesAgent' -ErrorAction SilentlyContinue",
    '  if ($service -and (Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $config)) {',
    "    if ($service.Status -ne 'Running') { Start-Service -Name 'AchillesAgent' }",
    "    Log 'Agent already installed; nothing to do.'",
    '    exit 0',
    '  }',
    '',
    '  # C:\\F0 must be a plain folder owned by SYSTEM or Administrators, locked to them.',
    ...WINDOWS_FOLDER_LOCK_LINES,
    '  $logToFile = $true',
    '',
    "  Log 'Downloading the agent.'",
    `  $url = '${url}'`,
    '  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12',
    `  try { Invoke-WebRequest -UseBasicParsing -Uri $url${headers} -OutFile $exe }`,
    '  catch { throw "Could not download the agent from $($url): $($_.Exception.Message) The SYSTEM account does not use per-user proxy settings." }',
    ...signatureBlock,
    '',
    "  Log 'Enrolling and installing the agent.'",
    `  & $exe --enroll ${token} --server ${serverUrl} --install`,
    '  if ($LASTEXITCODE -ne 0) { throw "The agent installer exited with code $LASTEXITCODE." }',
    '',
    "  Log 'Agent installed.'",
    '  exit 0',
    '} catch {',
    '  Log "FAILED: $($_.Exception.Message)"',
    '  exit 1',
    '}',
    '',
  ];

  return { text: lines.join('\r\n'), verifiedFingerprint, signerName };
}
