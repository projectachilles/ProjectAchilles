import { describe, it, expect } from 'vitest';
import { buildInstallCommands, WINDOWS_FOLDER_LOCK_LINES } from '../installCommands';
import {
  buildWindowsDeployScript,
  signerCommonName,
  DEPLOY_SCRIPT_FILENAME,
  DETECTION_RULE,
  UNINSTALL_COMMAND,
} from '../deployScript';

const SERVER = 'https://achilles.example.com';
const TOKEN = 'acht_test0123';
const base = {
  serverUrl: SERVER,
  token: TOKEN,
  version: '0.7.4',
  signerSubject: '/C=XX/O=Acme/CN=Acme Code Signing',
};

const lines = (text: string) => text.split('\r\n');

describe('buildWindowsDeployScript', () => {
  const { text, verifiedSigner } = buildWindowsDeployScript(base);

  it('is ASCII with CRLF line endings', () => {
    expect(text).toMatch(/^[\x09\x0d\x0a\x20-\x7e]*$/);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines(text).length).toBeGreaterThan(20);
  });

  it('uses the token exactly once, in the enroll call', () => {
    expect(text.split(TOKEN).length).toBe(2);
    const line = lines(text).find((l) => l.includes(TOKEN));
    expect(line).toContain(`--enroll ${TOKEN} --server ${SERVER} --install`);
  });

  it('never logs the token or puts it in a comment', () => {
    for (const l of lines(text)) {
      if (/\bLog\b|Write-|^\s*#|throw/.test(l)) expect(l).not.toContain(TOKEN);
    }
  });

  it('downloads the Windows amd64 agent from the server into C:\\F0', () => {
    expect(text).toContain(`${SERVER}/api/agent/download?os=windows&arch=amd64`);
    expect(text).toContain("$exe = 'C:\\F0\\achilles-agent.exe'");
    expect(text).toContain('-OutFile $exe');
  });

  it('checks the service, the binary and the config to decide it is already installed', () => {
    expect(text).toContain("Get-Service -Name 'AchillesAgent' -ErrorAction SilentlyContinue");
    expect(text).toContain("'C:\\F0\\achilles-agent.yaml'");
    const check = lines(text).find((l) => l.includes('$service -and'));
    expect(check).toContain('Test-Path -LiteralPath $exe');
    expect(check).toContain('Test-Path -LiteralPath $config');
  });

  it('exits 0 for an installed agent before it locks, downloads or enrolls anything', () => {
    const installed = text.indexOf('Agent already installed; nothing to do.');
    expect(installed).toBeGreaterThan(-1);
    const exit0 = text.indexOf('exit 0', installed);
    expect(exit0).toBeGreaterThan(installed);
    for (const later of ['icacls', 'Invoke-WebRequest', '--enroll', 'Remove-Item']) {
      expect(text.indexOf(later)).toBeGreaterThan(exit0);
    }
  });

  it('starts a stopped service of an installed agent', () => {
    expect(text).toMatch(/if \(\$service\.Status -ne 'Running'\) \{ Start-Service -Name 'AchillesAgent' \}/);
  });

  it('includes the shared C:\\F0 lock lines unchanged', () => {
    expect(WINDOWS_FOLDER_LOCK_LINES.length).toBeGreaterThanOrEqual(8);
    for (const l of WINDOWS_FOLDER_LOCK_LINES) expect(text).toContain(l.trim());
  });

  it('pins the signer common name when the binary is signed', () => {
    expect(verifiedSigner).toBe('Acme Code Signing');
    expect(text).toContain('Get-AuthenticodeSignature -LiteralPath $exe');
    expect(text).toContain("$signer -ne 'Acme Code Signing'");
    expect(text).toContain("$sig.Status -ne 'Valid'");
  });

  it('removes the download and fails when the signature check fails, before running it', () => {
    const check = text.indexOf('Get-AuthenticodeSignature');
    const remove = text.indexOf('Remove-Item -LiteralPath $exe -Force', check);
    const enroll = text.indexOf('--enroll');
    expect(remove).toBeGreaterThan(check);
    expect(enroll).toBeGreaterThan(remove);
    expect(text).toContain('Endpoint prerequisites, step 2');
  });

  it('pins the signer from a comma-separated subject too', () => {
    const r = buildWindowsDeployScript({ ...base, signerSubject: 'CN=Achilles MDM Test,O=Achilles Test,C=XX' });
    expect(r.verifiedSigner).toBe('Achilles MDM Test');
    expect(r.text).toContain("$signer -ne 'Achilles MDM Test'");
  });

  it('has no signature block for an unsigned binary and says so in the header', () => {
    const unsigned = buildWindowsDeployScript({ ...base, signerSubject: null });
    expect(unsigned.verifiedSigner).toBeNull();
    expect(unsigned.text).not.toContain('Get-AuthenticodeSignature');
    expect(lines(unsigned.text).slice(0, 15).join('\n')).toMatch(/# .*not verified/i);
  });

  it('has no signature block when the subject has no usable common name', () => {
    for (const signerSubject of ['/O=Acme', "/C=XX/CN=Bad'Name", '/CN=$(calc)']) {
      const r = buildWindowsDeployScript({ ...base, signerSubject });
      expect(r.verifiedSigner).toBeNull();
      expect(r.text).not.toContain('Get-AuthenticodeSignature');
    }
  });

  it('names the Intune setting when it is not run elevated', () => {
    expect(text).toContain('IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
    expect(text).toContain('set "Run this script using the logged on credentials" to No');
  });

  it('explains a failed download, with the URL and the proxy note', () => {
    expect(text).toContain('Could not download the agent from');
    expect(text).toContain('The SYSTEM account does not use per-user proxy settings.');
  });

  it('fails when the agent installer exits non-zero', () => {
    expect(text).toContain('if ($LASTEXITCODE -ne 0) { throw "The agent installer exited with code $LASTEXITCODE." }');
  });

  it('exits 1 from one catch around everything', () => {
    expect(text).toMatch(/\} catch \{\r\n[^]*exit 1\r\n\}/);
  });

  it('adds the ngrok header only for an ngrok server', () => {
    expect(text).not.toContain('ngrok-skip-browser-warning');
    const ngrok = buildWindowsDeployScript({ ...base, serverUrl: 'https://abc.ngrok-free.app' });
    expect(ngrok.text).toContain('ngrok-skip-browser-warning');
  });

  it('refuses a token or server URL that cannot be embedded safely', () => {
    for (const token of ["x'; calc", 'a`b', 'a$b', 'a b', 'a"b', '']) {
      expect(() => buildWindowsDeployScript({ ...base, token })).toThrow('unsafe value');
    }
    for (const serverUrl of ['ftp://x.example.com', 'not a url', "https://x.example.com/'", 'https://x.example.com/$a']) {
      expect(() => buildWindowsDeployScript({ ...base, serverUrl })).toThrow('unsafe value');
    }
  });

  it('accepts an http LAN address with a port', () => {
    expect(() => buildWindowsDeployScript({ ...base, serverUrl: 'http://192.168.1.125:3000' })).not.toThrow();
  });
});

describe('signerCommonName', () => {
  it('reads the CN from any position of an OpenSSL one-line subject', () => {
    expect(signerCommonName('/C=XX/O=Acme/CN=Acme Code Signing')).toBe('Acme Code Signing');
    expect(signerCommonName('/CN=A B/O=X')).toBe('A B');
  });

  it('reads the CN from the comma-separated form newer osslsigncode versions print', () => {
    expect(signerCommonName('CN=Achilles MDM Test,O=Achilles Test,C=XX')).toBe('Achilles MDM Test');
    expect(signerCommonName('C=XX, O=Acme, CN=Acme Code Signing')).toBe('Acme Code Signing');
  });

  it('does not mistake another attribute ending in CN for the common name', () => {
    expect(signerCommonName('/O=Acme/DC=example/CN=Real')).toBe('Real');
    expect(signerCommonName('XCN=Nope,O=Acme')).toBeNull();
  });

  it('is null without a subject or a CN', () => {
    expect(signerCommonName(null)).toBeNull();
    expect(signerCommonName('/O=Acme')).toBeNull();
    expect(signerCommonName('ad-hoc')).toBeNull();
  });
});

describe('what the management tool is told', () => {
  it('names the script, the detection file and the uninstall command', () => {
    expect(DEPLOY_SCRIPT_FILENAME).toBe('Install-AchillesAgent.ps1');
    expect(DETECTION_RULE).toEqual({ path: 'C:\\F0', file: 'achilles-agent.exe' });
    expect(UNINSTALL_COMMAND).toBe('C:\\F0\\achilles-agent.exe --uninstall');
  });
});

describe('the one-liner and the script share the folder lock', () => {
  it('the one-liner still contains every shared line', () => {
    const windows = buildInstallCommands(SERVER, TOKEN).find((c) => c.id === 'windows')!;
    for (const l of WINDOWS_FOLDER_LOCK_LINES) expect(windows.command).toContain(l);
  });
});
