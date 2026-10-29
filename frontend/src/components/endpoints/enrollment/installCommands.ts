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

  // `\` must end the line with nothing after it, or the shell runs a broken command.
  // Every step runs as root: /opt/f0 is root's.
  const unix = (os: string, arch: string) =>
    [
      'sudo mkdir -p /opt/f0 && \\',
      `  sudo curl -fSL${ngrok ? ' -H "ngrok-skip-browser-warning: true"' : ''} "${download(os, arch)}" -o ${unixAgent} && \\`,
      `  sudo chmod 700 ${unixAgent} && \\`,
      `  sudo ${unixAgent} --enroll ${token} --server ${serverUrl} --install`,
    ].join('\n');

  // Any signed-in user can create a folder under C:\ and, as its owner, keeps
  // WRITE_DAC over it: a C:\F0 pre-created by a non-admin would let them swap
  // the binary the service then runs as SYSTEM. So, before downloading:
  // refuse an existing C:\F0 that is a link or not owned by SYSTEM or
  // Administrators; lock it with the same icacls calls as the agent
  // (winacl.LockDirArgs) and the bootstrap script, by SID so it works on any
  // Windows language; refuse foreign-owned items already inside; delete any old
  // binary so the download creates a new file inheriting the lock.
  //
  // One script block with Stop: pasted statements otherwise keep running after
  // one fails. Line breaks inside braces, never backtick continuations, which
  // break silently if a trailing space sneaks in when pasting.
  const windows = [
    '& {',
    "  $ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'",
    "  $dir = 'C:\\F0'; $exe = 'C:\\F0\\achilles-agent.exe'; $trusted = 'S-1-5-18', 'S-1-5-32-544'",
    '  function Owner($p) { (Get-Acl -LiteralPath $p).GetOwner([Security.Principal.SecurityIdentifier]).Value }',
    '  function Untrusted($i) { ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($trusted -notcontains (Owner $i.FullName)) }',
    '  if (Test-Path -LiteralPath $dir) {',
    '    $item = Get-Item -LiteralPath $dir -Force',
    '    if (-not $item.PSIsContainer -or (Untrusted $item)) { throw "$dir exists but is not a plain folder owned by SYSTEM or Administrators, so a non-administrator may have created it. Check what is in it, remove it, and run this again." }',
    '  } else { New-Item -ItemType Directory -Path $dir | Out-Null }',
    "  icacls $dir /setowner '*S-1-5-32-544' /L /Q | Out-Null; if ($LASTEXITCODE -ne 0) { throw \"Could not make Administrators the owner of $dir.\" }",
    "  icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' /grant:r '*S-1-5-32-544:(OI)(CI)F' /grant:r '*S-1-3-4:(OI)(CI)(RC)' /L /Q | Out-Null; if ($LASTEXITCODE -ne 0) { throw \"Could not lock $dir to SYSTEM and Administrators.\" }",
    '  Get-ChildItem -LiteralPath $dir -Force | ForEach-Object { if (Untrusted $_) { throw "$($_.FullName) is a link or is not owned by SYSTEM or Administrators. Check it, remove it, and run this again." } }',
    '  if (Test-Path -LiteralPath $exe) { Remove-Item -LiteralPath $exe -Force }',
    `  Invoke-WebRequest -UseBasicParsing -Uri "${download('windows', 'amd64')}"${ngrok ? ' -Headers @{"ngrok-skip-browser-warning"="true"}' : ''} -OutFile $exe`,
    `  & $exe --enroll ${token} --server ${serverUrl} --install`,
    '}',
  ].join('\n');

  return [
    { id: 'windows', label: 'Windows', hint: 'Run in an elevated PowerShell.', command: windows },
    { id: 'linux-amd64', label: 'Linux amd64', hint: 'Run as a user with sudo.', command: unix('linux', 'amd64') },
    { id: 'linux-arm64', label: 'Linux arm64', hint: 'Run as a user with sudo.', command: unix('linux', 'arm64') },
    { id: 'darwin-arm64', label: 'macOS Apple Silicon', hint: 'Run in Terminal; sudo asks for your password.', command: unix('darwin', 'arm64') },
    { id: 'darwin-amd64', label: 'macOS Intel', hint: 'Run in Terminal; sudo asks for your password.', command: unix('darwin', 'amd64') },
  ];
}
