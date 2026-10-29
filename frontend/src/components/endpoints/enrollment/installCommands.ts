// Per-platform agent install one-liners shown after an enrollment token is
// generated. Each command is split over lines so it reads (and wraps) inside
// the dialog; what is shown is exactly what Copy puts on the clipboard.

export interface InstallCommand {
  id: 'windows' | 'linux-amd64' | 'linux-arm64' | 'darwin-arm64' | 'darwin-amd64';
  label: string;
  /** Where to run it. */
  hint: string;
  command: string;
}

/** ngrok's browser-warning interstitial only exists on ngrok tunnels. */
function isNgrokHost(serverUrl: string): boolean {
  try {
    return /(^|\.)ngrok(-free)?\.(app|io|dev)$/.test(new URL(serverUrl).hostname);
  } catch {
    return false;
  }
}

export function buildInstallCommands(serverUrl: string, token: string): InstallCommand[] {
  const ngrok = isNgrokHost(serverUrl);
  const download = (os: string, arch: string) => `${serverUrl}/api/agent/download?os=${os}&arch=${arch}`;

  // The agent installs into one fixed folder, C:\F0 on Windows and /opt/f0
  // elsewhere: the service runs the binary from where --install runs it, and the
  // Defender ASR per-rule exclusion, the C:\F0 folder lock and the EDR guides
  // all name that path. Download straight there instead of into the current
  // folder (an elevated PowerShell starts in C:\Windows\System32).
  const unixAgent = '/opt/f0/achilles-agent';
  const winAgent = 'C:\\F0\\achilles-agent.exe';

  // `\` must end the line with nothing after it, or the shell runs a broken command.
  // Every step runs as root: /opt/f0 is root's.
  const unix = (os: string, arch: string) =>
    [
      'sudo mkdir -p /opt/f0 && \\',
      `  sudo curl -fSL${ngrok ? ' -H "ngrok-skip-browser-warning: true"' : ''} "${download(os, arch)}" -o ${unixAgent} && \\`,
      `  sudo chmod 700 ${unixAgent} && \\`,
      `  sudo ${unixAgent} --enroll ${token} --server ${serverUrl} --install`,
    ].join('\n');

  // Separate statements on separate lines rather than backtick continuations,
  // which break silently if a trailing space sneaks in when pasting.
  const windows = [
    'New-Item -ItemType Directory -Force -Path C:\\F0 | Out-Null',
    `Invoke-WebRequest -UseBasicParsing -Uri "${download('windows', 'amd64')}"${ngrok ? ' -Headers @{"ngrok-skip-browser-warning"="true"}' : ''} -OutFile ${winAgent}`,
    `${winAgent} --enroll ${token} --server ${serverUrl} --install`,
  ].join('\n');

  return [
    { id: 'windows', label: 'Windows', hint: 'Run in an elevated PowerShell.', command: windows },
    { id: 'linux-amd64', label: 'Linux amd64', hint: 'Run as a user with sudo.', command: unix('linux', 'amd64') },
    { id: 'linux-arm64', label: 'Linux arm64', hint: 'Run as a user with sudo.', command: unix('linux', 'arm64') },
    { id: 'darwin-arm64', label: 'macOS Apple Silicon', hint: 'Run in Terminal; sudo asks for your password.', command: unix('darwin', 'arm64') },
    { id: 'darwin-amd64', label: 'macOS Intel', hint: 'Run in Terminal; sudo asks for your password.', command: unix('darwin', 'amd64') },
  ];
}
