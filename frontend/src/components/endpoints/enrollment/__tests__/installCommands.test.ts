import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInstallCommands } from '../installCommands';

const SERVER = 'https://achilles.example.com';
const TOKEN = 'acht_test0123';

describe('buildInstallCommands', () => {
  const cmds = buildInstallCommands(SERVER, TOKEN);

  it('offers Windows first, then Linux and macOS', () => {
    expect(cmds.map((c) => c.id)).toEqual(['windows', 'linux-amd64', 'linux-arm64', 'darwin-arm64', 'darwin-amd64']);
  });

  it('puts the token, server and matching download URL in every command', () => {
    const arch: Record<string, string> = {
      windows: 'os=windows&arch=amd64',
      'linux-amd64': 'os=linux&arch=amd64',
      'linux-arm64': 'os=linux&arch=arm64',
      'darwin-arm64': 'os=darwin&arch=arm64',
      'darwin-amd64': 'os=darwin&arch=amd64',
    };
    for (const c of cmds) {
      expect(c.command).toContain(`--enroll ${TOKEN}`);
      expect(c.command).toContain(`--server ${SERVER} --install`);
      expect(c.command).toContain(`${SERVER}/api/agent/download?${arch[c.id]}`);
    }
  });

  it('only sends the ngrok header to ngrok tunnels', () => {
    expect(cmds.some((c) => c.command.includes('ngrok'))).toBe(false);
    const tunnel = buildInstallCommands('https://ab12.ngrok-free.app', TOKEN);
    expect(tunnel.every((c) => c.command.includes('ngrok-skip-browser-warning'))).toBe(true);
  });

  it('splits commands over lines with nothing after a trailing backslash', () => {
    for (const c of cmds) {
      expect(c.command.split('\n').length).toBeGreaterThan(1);
      for (const line of c.command.split('\n')) expect(line).not.toMatch(/\\\s+$/);
    }
    expect(cmds[0].command).not.toContain('`');
  });

  it('produces Linux and macOS commands that bash parses as one pipeline', () => {
    for (const c of cmds.filter((x) => x.id !== 'windows')) {
      // every line break is a continuation, so the shell sees one command…
      expect(c.command.replace(/ \\\n\s*/g, ' ')).not.toContain('\n');
      // …and that command is valid shell (quotes balanced, operators complete)
      expect(() => execFileSync('bash', ['-n'], { input: c.command })).not.toThrow();
    }
  });
  // The service runs the binary from where --install runs it, and the Defender
  // ASR per-rule exclusion, the C:\F0 lock and the EDR guides only cover C:\F0.
  // An elevated PowerShell starts in C:\Windows\System32, so a relative
  // download put the agent there.
  it('installs the Windows agent into C:\\F0, never the current folder', () => {
    const win = cmds[0].command;
    expect(win).toContain("$exe = 'C:\\F0\\achilles-agent.exe'");
    expect(win).toMatch(/\n {2}Invoke-WebRequest -UseBasicParsing -Uri "[^"]+" -OutFile \$exe\n/);
    expect(win).toContain(`\n  & $exe --enroll ${TOKEN} --server ${SERVER} --install\n`);
    expect(win).not.toContain('.\\');
  });

  it('keeps the ngrok header on the Windows download line', () => {
    const win = buildInstallCommands('https://ab12.ngrok-free.app', TOKEN)[0].command;
    expect(win).toMatch(/-Headers @\{"ngrok-skip-browser-warning"="true"\} -OutFile \$exe\n/);
  });

  // Any signed-in user can create a folder under C:\ and, as its owner, keep
  // WRITE_DAC over it. A non-admin who pre-creates C:\F0 could swap the binary
  // between download and --install, and the service would run theirs as SYSTEM.
  describe('Windows: C:\\F0 is checked and locked before the download', () => {
    const win = cmds[0].command;
    const lines = win.split('\n');
    const at = (needle: string) => {
      const i = win.indexOf(needle);
      expect(i, `missing: ${needle}`).toBeGreaterThanOrEqual(0);
      return i;
    };

    it('runs as one block that stops at the first error', () => {
      // Pasted statements run one by one even after one fails; a single
      // script block with Stop makes any throw abort the rest.
      expect(lines[0]).toBe('& {');
      expect(lines[lines.length - 1]).toBe('}');
      expect(lines[1]).toContain("$ErrorActionPreference = 'Stop'");
      expect(win.split('{').length).toBe(win.split('}').length);
    });

    it('refuses an existing C:\\F0 that is a link, a file or not owned by SYSTEM or Administrators', () => {
      expect(win).toContain("$trusted = 'S-1-5-18', 'S-1-5-32-544'");
      expect(win).toContain('GetOwner([Security.Principal.SecurityIdentifier])');
      expect(win).toContain('[IO.FileAttributes]::ReparsePoint');
      // never -Force: it would silently accept a folder someone else made
      expect(win).not.toMatch(/New-Item[^\n]*-Force/);
      expect(at('Test-Path -LiteralPath $dir')).toBeLessThan(at('New-Item -ItemType Directory -Path $dir'));
    });

    it('locks C:\\F0 exactly like the agent and the bootstrap script, by SID', () => {
      // agent/internal/winacl LockDirArgs
      const owner = "icacls $dir /setowner '*S-1-5-32-544' /L /Q";
      const dacl =
        "icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' /grant:r '*S-1-5-32-544:(OI)(CI)F' /grant:r '*S-1-3-4:(OI)(CI)(RC)' /L /Q";
      expect(at('New-Item -ItemType Directory -Path $dir')).toBeLessThan(at(owner));
      expect(at(owner)).toBeLessThan(at(dacl));
      for (const l of lines.filter((x) => x.includes('icacls'))) {
        expect(l).toMatch(/if \(\$LASTEXITCODE -ne 0\) \{ throw /);
        expect(l.split(';')[0]).not.toMatch(/Administrators|SYSTEM|BUILTIN|NT AUTHORITY/i);
      }
    });

    it('then refuses foreign-owned items inside, removes any old binary, and only then downloads', () => {
      const dacl = at('/inheritance:r');
      const children = at('Get-ChildItem -LiteralPath $dir -Force');
      const remove = at('Remove-Item -LiteralPath $exe -Force');
      const download = at('Invoke-WebRequest');
      const install = at('& $exe --enroll');
      expect(dacl).toBeLessThan(children);
      expect(children).toBeLessThan(remove);
      expect(remove).toBeLessThan(download);
      expect(download).toBeLessThan(install);
    });
  });

  it('installs the Linux and macOS agent into /opt/f0, in order, all as root', () => {
    for (const c of cmds.filter((x) => x.id !== 'windows')) {
      // Run the real command with a stand-in sudo that only records what it was
      // asked to run, so nothing is downloaded or installed.
      const dir = mkdtempSync(join(tmpdir(), 'install-cmd-'));
      try {
        const log = join(dir, 'log');
        writeFileSync(join(dir, 'sudo'), `#!/bin/sh\necho "$*" >> "${log}"\n`, { mode: 0o755 });
        // anything run without sudo fails (and never touches the network)
        for (const tool of ['curl', 'mkdir', 'chmod']) {
          writeFileSync(join(dir, tool), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
        }
        execFileSync('bash', ['-c', c.command], { env: { PATH: `${dir}:/usr/bin:/bin` } });
        const ran = readFileSync(log, 'utf8').trim().split('\n');
        expect(ran).toEqual([
          'mkdir -p /opt/f0',
          expect.stringMatching(/^curl -fSL \S+ -o \/opt\/f0\/achilles-agent$/),
          'chmod 700 /opt/f0/achilles-agent',
          `/opt/f0/achilles-agent --enroll ${TOKEN} --server ${SERVER} --install`,
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      expect(c.command).not.toContain('./achilles-agent');
    }
  });
});
