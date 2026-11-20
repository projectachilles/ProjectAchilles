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
  signerFingerprint: 'E179CFFEE84A26CE44F4F83180A721E1EF22934B4790047B02AA6032F7783A18',
};
const FP = base.signerFingerprint;

const lines = (text: string) => text.split('\r\n');

describe('buildWindowsDeployScript', () => {
  const { text, verifiedFingerprint, signerName } = buildWindowsDeployScript(base);

  it('is ASCII with CRLF line endings', () => {
    expect(text).toMatch(/^[\x09\x0d\x0a\x20-\x7e]*$/);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines(text).length).toBeGreaterThan(20);
  });

  it('holds the token in exactly one place, a variable the enroll call uses', () => {
    expect(text.split(TOKEN).length).toBe(2);
    expect(lines(text).find((l) => l.includes(TOKEN))).toBe(`  $token = '${TOKEN}'`);
    expect(text).toContain(`& $exe --enroll $token --server ${SERVER} --install`);
  });

  it('captures what the agent prints, stderr included, without letting stderr abort the script', () => {
    const run = lines(text).findIndex((l) => l.includes('--enroll $token'));
    expect(lines(text)[run]).toContain('2>&1');
    // Windows PowerShell 5.1 turns redirected stderr into terminating errors under Stop.
    expect(lines(text)[run - 1]).toContain("$ErrorActionPreference = 'Continue'");
    expect(lines(text).slice(run, run + 3).join('\n')).toContain("$ErrorActionPreference = 'Stop'");
  });

  it('logs the agent output with the token masked', () => {
    expect(text).toContain(".Replace($token, '[token]')");
    expect(text).toMatch(/Log "agent: /);
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

  it('pins the SHA-256 fingerprint of the signer certificate', () => {
    expect(verifiedFingerprint).toBe(FP);
    expect(signerName).toBe('Acme Code Signing');
    expect(text).toContain('Get-AuthenticodeSignature -LiteralPath $exe');
    expect(text).toContain('[Security.Cryptography.SHA256]::Create().ComputeHash($sig.SignerCertificate.RawData)');
    expect(text).toContain(`$fingerprint -ne '${FP}'`);
  });

  it('accepts only an intact signature: Valid, or UnknownError for a certificate Windows does not chain', () => {
    expect(text).toContain("@('Valid', 'UnknownError') -notcontains $sig.Status");
    expect(text).not.toContain('HashMismatch'); // rejected by not being on the list, not by name
  });

  it('does not depend on the signer name', () => {
    expect(text).not.toContain('GetNameInfo');
    const other = buildWindowsDeployScript({ ...base, signerSubject: null });
    expect(other.verifiedFingerprint).toBe(FP);
    expect(other.signerName).toBeNull();
  });

  it('removes the download and fails when the signature check fails, before running it', () => {
    const check = text.indexOf('Get-AuthenticodeSignature');
    const remove = text.indexOf('Remove-Item -LiteralPath $exe -Force', check);
    const enroll = text.indexOf('--enroll');
    expect(remove).toBeGreaterThan(check);
    expect(enroll).toBeGreaterThan(remove);
    expect(text).toContain('download a new script');
  });

  it('has no signature block without a fingerprint and says so in the header', () => {
    const unsigned = buildWindowsDeployScript({ ...base, signerFingerprint: null });
    expect(unsigned.verifiedFingerprint).toBeNull();
    expect(unsigned.text).not.toContain('Get-AuthenticodeSignature');
    expect(lines(unsigned.text).slice(0, 15).join('\n')).toMatch(/# .*not verified/i);
  });

  it('has no signature block for a fingerprint that is not 64 hex characters', () => {
    for (const signerFingerprint of ['abc', `${FP}'; calc`, FP.slice(1), 'G'.repeat(64)]) {
      const r = buildWindowsDeployScript({ ...base, signerFingerprint });
      expect(r.verifiedFingerprint).toBeNull();
      expect(r.text).not.toContain('Get-AuthenticodeSignature');
    }
  });

  it('accepts a lower-case fingerprint and pins it in upper case', () => {
    const r = buildWindowsDeployScript({ ...base, signerFingerprint: FP.toLowerCase() });
    expect(r.verifiedFingerprint).toBe(FP);
  });

  it('keeps an unusable signer name out of the script', () => {
    for (const signerSubject of ["/C=XX/CN=Bad'Name", '/CN=$(calc)', '/CN=two\nlines']) {
      const r = buildWindowsDeployScript({ ...base, signerSubject });
      expect(r.signerName).toBeNull();
      expect(r.text).not.toContain('calc');
      expect(r.text).not.toContain("Bad'Name");
      expect(r.verifiedFingerprint).toBe(FP);
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
    expect(text).toContain('$exitCode = $LASTEXITCODE');
    expect(text).toContain('if ($exitCode -ne 0) { throw "The agent installer exited with code $exitCode." }');
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
  it('names the script, the detection key and the uninstall command', () => {
    expect(DEPLOY_SCRIPT_FILENAME).toBe('Install-AchillesAgent.ps1');
    // The service's registry key, not the binary: --uninstall cannot delete its own running exe.
    expect(DETECTION_RULE).toEqual({ type: 'registry', key: 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\AchillesAgent' });
    expect(UNINSTALL_COMMAND).toBe('C:\\F0\\achilles-agent.exe --uninstall');
  });
});

describe('the one-liner and the script share the folder lock', () => {
  it('the one-liner still contains every shared line', () => {
    const windows = buildInstallCommands(SERVER, TOKEN).find((c) => c.id === 'windows')!;
    for (const l of WINDOWS_FOLDER_LOCK_LINES) expect(windows.command).toContain(l);
  });
});
