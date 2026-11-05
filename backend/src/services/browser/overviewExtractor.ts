// Tolerant markdown parsing of the sections the test detail "Overview" tab shows.
// Every parser is a pure function on a string and returns undefined when the
// section is missing or unusable; one bad document never breaks another field.

import * as path from 'path';
import type { TestFile, TestOverview } from '../../types/test.js';
import { parseLegacyScoreBreakdown } from './metadataExtractor.js';

// ── Markdown helpers ─────────────────────────────────────────────────

/** Strip bold/code/link markup, keeping the readable text. */
function flatten(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s+\S/);
  return m ? m[1].length : 0;
}

/**
 * Body of the first `##`/`###` section whose heading text matches `title`,
 * up to the next heading of the same or a higher level. Fenced code is skipped
 * when looking for headings.
 */
function section(md: string, title: RegExp): { heading: string; level: number; body: string } | undefined {
  const lines = md.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const level = headingLevel(lines[i]);
    if (level < 2 || level > 3) continue;
    const heading = lines[i].replace(/^#+\s+/, '').trim();
    if (!title.test(heading)) continue;
    const body: string[] = [];
    let fence = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(```|~~~)/.test(lines[j])) fence = !fence;
      if (!fence) {
        const l = headingLevel(lines[j]);
        if (l > 0 && l <= level) break;
      }
      body.push(lines[j]);
    }
    return { heading, level, body: body.join('\n') };
  }
  return undefined;
}

/** Split a table row on `|`, ignoring pipes inside backticks or escaped. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') inCode = !inCode;
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

interface Table { headers: string[]; rows: string[][] }

/** First pipe table in a block of markdown. */
function firstTable(body: string): Table | undefined {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|') || !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map(h => flatten(h).toLowerCase());
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(splitRow(lines[j]));
    return { headers, rows };
  }
  return undefined;
}

const colIndex = (t: Table, pred: (h: string) => boolean): number => t.headers.findIndex(pred);

function listItems(body: string): string[] {
  const items: string[] = [];
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/);
    if (m) items.push(m[1]);
  }
  return items;
}

const clean = <T extends object>(o: T): T => {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
};

// ── Parsers ──────────────────────────────────────────────────────────

const OUTCOMES_HEADING = /^Expected (Outcomes|Results)\b/i;

function codeFrom(raw: string): number | undefined {
  const m = raw.match(/exit(?:\s+code)?\W{0,6}(\d{2,3})\b/i) ?? raw.match(/\*\*(\d{2,3})\*\*/);
  return m ? parseInt(m[1], 10) : undefined;
}

function outcomeLabel(heading: string): string {
  const h = flatten(heading.replace(/\(.*?\)/g, '')).replace(/[:.]+$/, '').trim();
  const lead = h.match(/^(Unprotected|Protected)\b/i);
  return lead ? lead[1][0].toUpperCase() + lead[1].slice(1).toLowerCase() : h;
}

export function parseExpectedOutcomes(md: string): TestOverview['expectedOutcomes'] {
  const sec = section(md, OUTCOMES_HEADING);
  if (!sec) return undefined;
  const out: NonNullable<TestOverview['expectedOutcomes']> = [];

  const direct = sec.body.split(/\r?\n/);
  const cut = direct.findIndex(l => headingLevel(l) > 0);
  for (const raw of listItems(cut === -1 ? sec.body : direct.slice(0, cut).join('\n'))) {
    const lead = raw.match(/^\*\*([^*]+?)\*\*\s*[:\-–—]?\s*(.*)$/) ?? raw.match(/^([^:]{1,40}):\s*(.*)$/);
    if (!lead) continue;
    const label = outcomeLabel(lead[1]);
    const text = flatten(lead[2]);
    if (!label || !text) continue;
    const code = codeFrom(raw);
    out.push(code === undefined ? { label, text } : { label, code, text });
  }
  if (out.length > 0) return out;

  // `### Protected System (…)` subsections with bullet lists beneath each
  const lines = sec.body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (headingLevel(lines[i]) !== sec.level + 1) continue;
    const label = outcomeLabel(lines[i].replace(/^#+\s+/, ''));
    const block: string[] = [];
    for (let j = i + 1; j < lines.length && headingLevel(lines[j]) === 0; j++) block.push(lines[j]);
    const items = listItems(block.join('\n'));
    const code = codeFrom(items.join(' '));
    const text = items
      .filter(it => !/^\*\*Exit Code\*\*/i.test(it))
      .map(flatten)
      .join('; ');
    if (!label || (!text && code === undefined)) continue;
    out.push(code === undefined ? { label, text } : { label, code, text });
  }
  return out.length > 0 ? out : undefined;
}

/** First contiguous bullet run in a document, flattened, max 5. */
function firstBulletRun(md: string): string[] | undefined {
  const items = listItems(md).map(flatten).filter(Boolean).slice(0, 5);
  return items.length > 0 ? items : undefined;
}

export function parseSafety(md: string): string[] | undefined {
  const sec = section(md, /\bsafety\b/i);
  if (!sec) return undefined;
  const bullets = firstBulletRun(sec.body);
  if (bullets) return bullets;
  // Prose section: split the first paragraph into sentence/clause-sized points.
  const para = sec.body.split(/\r?\n\s*\n/).map(p => p.trim()).find(p => p && !/^[|#>`]/.test(p));
  if (!para) return undefined;
  const parts = flatten(para)
    .split(/(?<=[.;])\s+/)
    .map(x => x.replace(/;$/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
  return parts.length > 0 ? parts : undefined;
}

function validationOf(md: string): string | undefined {
  const row = md.match(/^\s*\|\s*\**Validation Status\**\s*\|\s*(.+?)\s*\|?\s*$/im);
  const inline = md.match(/\*\*Validation Status\*\*\s*:\s*(.+)/i);
  const v = flatten((row?.[1] ?? inline?.[1] ?? ''));
  return v || undefined;
}

export function parseQuality(infoMd: string): TestOverview['quality'] {
  const validation = validationOf(infoMd);
  const realism = infoMd.match(/Realism[^\n]*?(\d+(?:\.\d+)?)\s*\/\s*7(?:\.0)?\b/i);
  const structure = infoMd.match(/Structure[^\n]*?(\d+(?:\.\d+)?)\s*\/\s*3(?:\.0)?\b/i);
  if (realism && structure) {
    return clean({
      rubric: 'v2.1' as const,
      realism: parseFloat(realism[1]),
      structure: parseFloat(structure[1]),
      validation,
    });
  }
  const breakdown = parseLegacyScoreBreakdown(infoMd);
  if (Object.keys(breakdown).length === 0) return undefined;
  return clean({ rubric: 'legacy' as const, breakdown, validation });
}

export function parseDetectionAudit(infoMd: string): TestOverview['detectionAudit'] {
  const sec = section(infoMd, /^Detection Opportunity Audit\b/i);
  const table = sec && firstTable(sec.body);
  if (!table) return undefined;
  const iStage = colIndex(table, h => h === 'stage');
  const iPrim = colIndex(table, h => !h.startsWith('sensor') && (h.includes('primitive') || h.includes('surface')));
  const iSensor = colIndex(table, h => h.startsWith('sensor'));
  const iPattern = colIndex(table, h => h.includes('pattern'));
  if (iPrim === -1 || iSensor === -1 || iPattern === -1) return undefined;
  const rows: NonNullable<TestOverview['detectionAudit']> = [];
  for (const r of table.rows) {
    const primitive = flatten(r[iPrim] ?? '');
    if (!primitive) continue;
    const stage = iStage === -1 ? NaN : parseInt(flatten(r[iStage] ?? ''), 10);
    rows.push(clean({
      stage: Number.isNaN(stage) ? undefined : stage,
      primitive,
      sensor: flatten(r[iSensor] ?? ''),
      pattern: flatten(r[iPattern] ?? ''),
    }));
  }
  return rows.length > 0 ? rows : undefined;
}

export function parseLabStageOutcomes(infoMd: string): TestOverview['labStageOutcomes'] {
  const sec = section(infoMd, /^Lab Evidence\b/i);
  const table = sec && firstTable(sec.body);
  if (!table) return undefined;
  const find = (pred: (h: string) => boolean, fallback: number) => {
    const i = colIndex(table, pred);
    return i === -1 ? fallback : i;
  };
  const iStage = find(h => h.includes('stage'), 0);
  const iOutcome = find(h => h.includes('outcome') || h.includes('result'), 1);
  const iDetail = find(h => h.includes('evidence') || h.includes('detail'), table.headers.length - 1);
  const out: NonNullable<TestOverview['labStageOutcomes']> = [];
  for (const r of table.rows) {
    const stage = parseInt((flatten(r[iStage] ?? '').match(/\d+/) ?? [''])[0], 10);
    if (Number.isNaN(stage)) continue;
    const cell = flatten(r[iOutcome] ?? '');
    const outcome = /blocked|\b(126|105|127)\b/i.test(cell) ? 'blocked' : /success/i.test(cell) ? 'ran' : 'error';
    out.push({ stage, outcome, detail: flatten(r[iDetail] ?? '') });
  }
  return out.length > 0 ? out : undefined;
}

const NO_VALUE = /^(n\/a|none|tbd|-|—)?$/i;

/** `Field | Value` table rows, or `- **Field**: value` lines, keyed by lower-cased field name. */
function keyValueFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const table = firstTable(body);
  if (table) {
    for (const r of [table.headers, ...table.rows]) if (r.length >= 2) fields[flatten(r[0]).toLowerCase()] = r[1];
  }
  if (Object.keys(fields).length > 0) return fields;
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]\s+)?\*{0,2}([A-Za-z][A-Za-z/ ]{1,30}?)\*{0,2}\s*:\s*\*{0,2}\s*(\S.*)$/);
    if (m) fields[m[1].trim().toLowerCase()] = m[2];
  }
  return fields;
}

/** Keep a URL only when it parses and is http(s); anything else is dropped. */
function safeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function parsePrimarySource(referencesMd: string): TestOverview['primarySource'] {
  const sec = section(referencesMd, /^Primary Source\b/i);
  const fields = sec ? keyValueFields(sec.body) : {};
  const get = (pred: (k: string) => boolean) => {
    const k = Object.keys(fields).find(pred);
    return k === undefined ? undefined : fields[k];
  };
  const title = flatten(get(k => k === 'title') ?? '');
  if (title && !NO_VALUE.test(title)) {
    const urlRaw = get(k => k === 'url') ?? '';
    const link = urlRaw.match(/\]\((https?:[^)\s]+)\)/);
    const url = safeHttpUrl(link?.[1] ?? (/^https?:\/\//.test(flatten(urlRaw)) ? flatten(urlRaw) : undefined));
    const publisher = flatten(get(k => k.includes('author') || k.includes('organization') || k.includes('publisher')) ?? '');
    const date = flatten(get(k => /^(date( published)?|publication date|published)$/.test(k)) ?? '');
    return clean({
      title,
      url,
      publisher: NO_VALUE.test(publisher) ? undefined : publisher,
      date: NO_VALUE.test(date) ? undefined : date,
    });
  }
  const link = referencesMd.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
  const fallbackUrl = safeHttpUrl(link?.[2]);
  return link ? clean({ title: flatten(link[1]), url: fallbackUrl }) : undefined;
}

export function parseStageBudgets(md: string): TestOverview['stageBudgetsSec'] {
  for (const line of md.split(/\r?\n/)) {
    const at = line.search(/stage budgets/i);
    if (at === -1) continue;
    const list = line.slice(at).match(/\d+s\b(?:\s*(?:\/|,|and)\s*\d+s\b)*/);
    if (!list) continue;
    const budgets: Record<number, number> = {};
    [...list[0].matchAll(/(\d+)s\b/g)].forEach((m, i) => { budgets[i + 1] = parseInt(m[1], 10); });
    return budgets;
  }
  return undefined;
}

// ── Entry point ──────────────────────────────────────────────────────

/**
 * Build the overview from a test's markdown files. `read` returns a file's
 * content (or undefined when unreadable); files are matched by base name:
 * README.md, *_info.md, *_references.md, SAFETY.md. Each field is parsed in
 * isolation: a failure leaves only that field absent and logs a warning.
 */
export function extractOverview(
  files: TestFile[],
  read: (file: TestFile) => string | undefined,
  uuid = '',
): TestOverview {
  const byName = (pred: (base: string) => boolean) => files.find(f => pred(path.basename(f.path).toLowerCase()));
  const readme = byName(b => b === 'readme.md');
  const info = byName(b => b.endsWith('_info.md'));
  const refs = byName(b => b.endsWith('_references.md'));
  const safetyDoc = byName(b => b === 'safety.md');

  const text = new Map<TestFile, string | undefined>();
  const content = (f: TestFile | undefined): string | undefined => {
    if (!f) return undefined;
    if (!text.has(f)) {
      try { text.set(f, read(f)); } catch (err) {
        console.warn(`[overview] could not read ${f.path} for ${uuid}:`, err);
        text.set(f, undefined);
      }
    }
    return text.get(f);
  };

  const run = <T>(field: string, fn: () => T | undefined): T | undefined => {
    try { return fn(); } catch (err) {
      console.warn(`[overview] ${field} parse failed for ${uuid}:`, err);
      return undefined;
    }
  };
  const firstOf = <T>(field: string, docs: (TestFile | undefined)[], parse: (md: string) => T | undefined): T | undefined => {
    for (const d of docs) {
      const md = run(field, () => content(d));
      if (md === undefined) continue;
      const v = run(field, () => parse(md));
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const overview: TestOverview = {
    expectedOutcomes: firstOf('expectedOutcomes', [readme, info], parseExpectedOutcomes),
    safety: firstOf('safety', [readme], parseSafety)
      ?? firstOf('safety', [safetyDoc], firstBulletRun),
    quality: firstOf('quality', [info], parseQuality),
    detectionAudit: firstOf('detectionAudit', [info], parseDetectionAudit),
    labStageOutcomes: firstOf('labStageOutcomes', [info], parseLabStageOutcomes),
    primarySource: firstOf('primarySource', [refs], parsePrimarySource),
    stageBudgetsSec: firstOf('stageBudgetsSec', [readme, info], parseStageBudgets),
  };
  if (overview.safety) overview.safetySource = (safetyDoc ?? readme)?.name;
  return clean(overview);
}
