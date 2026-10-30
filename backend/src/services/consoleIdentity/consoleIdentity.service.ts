// Console identity: admin-set organization code, optional full name and preset colour.
// A saved record replaces env-provided values entirely.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IDENTITY_COLORS } from '../../types/consoleIdentity.js';
import type { ConsoleIdentity, ConsoleIdentityInput, IdentityColor } from '../../types/consoleIdentity.js';

const FILE_NAME = 'console-identity.json';
const CODE_RE = /^[A-Z0-9]{2,6}$/;
const MAX_NAME_LENGTH = 80;

export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export function isIdentityColor(v: unknown): v is IdentityColor {
  return v === 'none' || (typeof v === 'string' && (IDENTITY_COLORS as readonly string[]).includes(v));
}

function normalizeName(raw: string | null): string | null {
  const name = (raw ?? '').trim();
  return name === '' ? null : name;
}

export class ConsoleIdentityService {
  private readonly filePath: string;
  private readonly envIdentity: ConsoleIdentity;

  constructor(
    private readonly settingsDir: string = path.join(os.homedir(), '.projectachilles'),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.filePath = path.join(this.settingsDir, FILE_NAME);
    this.envIdentity = this.fromEnv(); // resolved (and warned about) once
  }

  get(): ConsoleIdentity {
    const saved = this.readSaved();
    if (saved) return { ...saved, source: 'saved' };
    return { ...this.envIdentity };
  }

  save(input: ConsoleIdentityInput): ConsoleIdentity {
    const code = normalizeCode(input.code);
    if (!code) throw new Error('Invalid code');
    if (!isIdentityColor(input.color)) throw new Error('Invalid color');
    const name = normalizeName(input.name);
    if (name !== null && name.length > MAX_NAME_LENGTH) throw new Error('Invalid name');

    fs.mkdirSync(this.settingsDir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ code, name, color: input.color }, null, 2));
    fs.renameSync(tmp, this.filePath);
    return { code, name, color: input.color, source: 'saved' };
  }

  reset(): ConsoleIdentity {
    fs.rmSync(this.filePath, { force: true });
    return this.get();
  }

  private readSaved(): Omit<ConsoleIdentity, 'source'> | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[console-identity] could not read saved identity:', (err as Error).message);
      }
      return null;
    }
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const code = typeof data.code === 'string' ? normalizeCode(data.code) : null;
      const name = data.name === null ? null : data.name;
      if (
        !code ||
        !isIdentityColor(data.color) ||
        (name !== null && (typeof name !== 'string' || name.length > MAX_NAME_LENGTH))
      ) {
        throw new Error('invalid stored identity');
      }
      return { code, name: name === null ? null : normalizeName(name), color: data.color };
    } catch (err) {
      console.warn('[console-identity] ignoring invalid saved identity:', (err as Error).message);
      return null;
    }
  }

  private fromEnv(): ConsoleIdentity {
    const rawCode = this.env.CONSOLE_ORG_CODE?.trim() ?? '';
    const rawName = this.env.CONSOLE_ORG_NAME?.trim() || this.env.ORGANIZATION_NAME?.trim() || '';
    const rawColor = this.env.CONSOLE_ORG_COLOR?.trim() ?? '';

    const code = rawCode ? normalizeCode(rawCode) : null;
    if (rawCode && !code) console.warn('[console-identity] ignoring invalid CONSOLE_ORG_CODE');
    const color: IdentityColor = isIdentityColor(rawColor) ? rawColor : 'none';
    if (rawColor && color === 'none' && rawColor !== 'none') {
      console.warn('[console-identity] ignoring invalid CONSOLE_ORG_COLOR');
    }
    if (rawName.length > MAX_NAME_LENGTH) {
      console.warn(`[console-identity] ignoring console name longer than ${MAX_NAME_LENGTH} characters`);
    }
    const name = rawName && rawName.length <= MAX_NAME_LENGTH ? rawName : null;

    const configured = Boolean(rawCode || rawName || rawColor);
    return { code, name, color, source: configured ? 'env' : 'none' };
  }
}
