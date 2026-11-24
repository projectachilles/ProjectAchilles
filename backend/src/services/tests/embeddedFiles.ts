// What a test's Go code really embeds: every pattern of every //go:embed
// directive, matched against the files of the test folder the way Go matches
// them. Used to tell when a binary carries a file its version fingerprint
// leaves out (isBuildInput in ../browser/versionIdentity.ts).

import * as fs from 'fs';
import * as path from 'path';
import { isBuildInput } from '../browser/versionIdentity.js';

export interface EmbedPattern {
  /** As written, without quotes and without the `all:` prefix. */
  pattern: string;
  /** `all:` prefix: files whose names begin with `.` or `_` are embedded too. */
  all: boolean;
}

/** Only a comment that starts the line with //go:embed is a directive (Go's own rule). */
const DIRECTIVE = /^[ \t]*\/\/go:embed[ \t]+(.*)$/gm;

/** One pattern per token of the line: bare, "quoted" or `back-quoted`. */
function tokens(rest: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const c = rest[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '`') {
      const end = rest.indexOf('`', i + 1);
      if (end === -1) break;
      out.push(rest.slice(i + 1, end));
      i = end + 1;
    } else if (c === '"') {
      let end = i + 1;
      while (end < rest.length && rest[end] !== '"') end += rest[end] === '\\' ? 2 : 1;
      if (end >= rest.length) break;
      try {
        out.push(JSON.parse(rest.slice(i, end + 1)) as string);
      } catch {
        // Not a string this parser reads: skipped, like a pattern that matches nothing.
      }
      i = end + 1;
    } else {
      let end = i;
      while (end < rest.length && !' \t\r'.includes(rest[end])) end++;
      out.push(rest.slice(i, end));
      i = end;
    }
  }
  return out;
}

/** The patterns of every //go:embed directive in a Go file's text. */
export function embedPatterns(goSource: string): EmbedPattern[] {
  const out: EmbedPattern[] = [];
  for (const match of goSource.matchAll(DIRECTIVE)) {
    for (const token of tokens(match[1])) {
      const all = token.startsWith('all:');
      const pattern = all ? token.slice(4) : token;
      if (pattern !== '') out.push({ pattern, all });
    }
  }
  return out;
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/g;

/** A Go path.Match pattern as a regular expression over a '/'-separated path. */
function patternToRegex(pattern: string): RegExp | null {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) return null;
      let body = pattern.slice(i + 1, end);
      const negated = body.startsWith('^');
      if (negated) body = body.slice(1);
      re += `(?!/)[${negated ? '^' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`;
      i = end;
    } else if (c === '\\' && i + 1 < pattern.length) {
      re += pattern[++i].replace(REGEX_SPECIAL, '\\$&');
    } else {
      re += c.replace(REGEX_SPECIAL, '\\$&');
    }
  }
  try {
    return new RegExp(`^${re}$`);
  } catch {
    return null;
  }
}

interface Entry {
  /** Relative to the test folder, '/' separators. */
  rel: string;
  dir: boolean;
}

function walk(root: string, rel: string, out: Entry[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push({ rel: child, dir: true });
      walk(root, child, out);
    } else if (entry.isFile()) {
      out.push({ rel: child, dir: false });
    }
  }
}

/** A name Go leaves out when it embeds a folder without `all:`. */
const hiddenBelow = (relBelow: string): boolean =>
  relBelow.split('/').some(part => part.startsWith('.') || part.startsWith('_'));

/**
 * Every file the test's Go code embeds, relative to the test folder ('/'
 * separators, sorted). All patterns of a line count, globs are matched, and a
 * folder (named or matched) brings everything under it. Patterns are relative
 * to the folder of the Go file that holds them. `_test.go` files are not part
 * of a built binary and are skipped. A pattern that matches nothing lists
 * nothing; a folder that can't be read is empty.
 */
export function embeddedFiles(testDir: string): string[] {
  const entries: Entry[] = [];
  walk(testDir, '', entries);
  const found = new Set<string>();

  for (const goFile of entries) {
    if (goFile.dir || !goFile.rel.endsWith('.go') || goFile.rel.endsWith('_test.go')) continue;
    let source: string;
    try {
      source = fs.readFileSync(path.join(testDir, goFile.rel), 'utf8');
    } catch {
      continue;
    }
    const patterns = embedPatterns(source);
    if (patterns.length === 0) continue;

    const slash = goFile.rel.lastIndexOf('/');
    const base = slash === -1 ? '' : `${goFile.rel.slice(0, slash)}/`;
    const inPackage = entries.filter(e => e.rel.startsWith(base));

    for (const { pattern, all } of patterns) {
      const regex = patternToRegex(pattern);
      if (!regex) continue;
      for (const entry of inPackage) {
        if (!regex.test(entry.rel.slice(base.length))) continue;
        if (!entry.dir) {
          found.add(entry.rel);
          continue;
        }
        const under = `${entry.rel}/`;
        for (const file of entries) {
          if (file.dir || !file.rel.startsWith(under)) continue;
          if (!all && hiddenBelow(file.rel.slice(under.length))) continue;
          found.add(file.rel);
        }
      }
    }
  }
  return [...found].sort();
}

/**
 * The embedded files the version fingerprint leaves out (by extension or by
 * name). Such a file is in the binary, so a change to it changes what runs,
 * but the fingerprint stays the same: a build that embeds one can't be given
 * a version that results are compared by.
 */
export function embeddedFilesLeftOut(testDir: string): string[] {
  return embeddedFiles(testDir).filter(file => !isBuildInput(file));
}
