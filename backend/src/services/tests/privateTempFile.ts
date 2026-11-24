// A secret a child process must read from a file (osslsigncode -readpass,
// build_all.sh's F0_SIGN_CERT_PASS_FILE), kept out of every folder a route
// serves files from.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PrivateTempFile {
  /** Absolute path of the file. */
  path: string;
  /** Delete the file and its directory. Never throws; safe to call twice. */
  remove: () => void;
}

/**
 * Write `content` to a new file only this user can read (0600), in a new
 * directory of its own (0700, random name) under the system temp directory.
 *
 * Not in the build folder: the agent download route serves from there, and a
 * password file in it could be fetched while a build runs. Call `remove()` in
 * a `finally` block.
 */
export function writePrivateTempFile(content: string): PrivateTempFile {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-secret-'));
  const file = path.join(dir, 'secret');
  const remove = (): void => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Nothing more to do: the directory is private to this user.
    }
  };
  try {
    fs.writeFileSync(file, content, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    remove();
    throw err;
  }
  return { path: file, remove };
}
