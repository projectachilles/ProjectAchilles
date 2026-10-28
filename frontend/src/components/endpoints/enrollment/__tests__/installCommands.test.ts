import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
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
});
