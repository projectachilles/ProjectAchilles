/**
 * Rich table rendering for human-readable terminal output.
 * Handles column width calculation, truncation, and alignment.
 */

import { colors } from './colors.js';

export interface ColumnDef {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  transform?: (value: unknown, row: Record<string, unknown>) => string;
}

/** Render a table with header and rows */
export function renderTable(
  rows: Record<string, unknown>[],
  columns: ColumnDef[],
  opts: { maxWidth?: number; noHeader?: boolean } = {}
): string {
  const termWidth = opts.maxWidth ?? process.stdout.columns ?? 120;
  const lines: string[] = [];

  // Calculate column widths
  const colWidths = columns.map(col => {
    const headerLen = col.label.length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = formatCell(row[col.key], row, col);
      return Math.max(max, stripAnsi(val).length);
    }, 0);
    return col.width ?? Math.min(Math.max(headerLen, maxDataLen), 40);
  });

  // Adjust to fit terminal: shrink widest columns proportionally
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + (columns.length - 1) * 2;
  if (totalWidth > termWidth) {
    const excess = totalWidth - termWidth;
    const widestIdx = colWidths.indexOf(Math.max(...colWidths));
    colWidths[widestIdx] = Math.max(colWidths[widestIdx] - excess, 8);
  }

  // Header
  if (!opts.noHeader) {
    const header = columns
      .map((col, i) => pad(colors.bold(col.label), colWidths[i], col.align))
      .join('  ');
    lines.push(header);
    lines.push(colors.dim('─'.repeat(Math.min(termWidth, totalWidth))));
  }

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = formatCell(row[col.key], row, col);
        return pad(val, colWidths[i], col.align);
      })
      .join('  ');
    lines.push(line);
  }

  return lines.join('\n');
}

function formatCell(value: unknown, row: Record<string, unknown>, col: ColumnDef): string {
  if (col.transform) return col.transform(value, row);
  if (value === null || value === undefined) return colors.dim('—');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function pad(str: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const len = stripAnsi(str).length;
  if (len >= width) return truncate(str, width);
  const padding = width - len;
  switch (align) {
    case 'right': return ' '.repeat(padding) + str;
    case 'center': {
      const left = Math.floor(padding / 2);
      return ' '.repeat(left) + str + ' '.repeat(padding - left);
    }
    default: return str + ' '.repeat(padding);
  }
}

function truncate(str: string, maxWidth: number): string {
  const plain = stripAnsi(str);
  if (plain.length <= maxWidth) return str;
  // Truncate from plain text, then re-apply
  return plain.slice(0, maxWidth - 1) + '…';
}

/** Strip ANSI escape codes for width calculation */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Render a key-value detail view */
export function renderDetail(data: Record<string, unknown>, keys?: string[]): string {
  const entries = keys
    ? keys.map(k => [k, data[k]] as const)
    : Object.entries(data);

  const maxKeyLen = entries.reduce((max, [k]) => Math.max(max, k.length), 0);
  return entries
    .map(([key, value]) => {
      const label = colors.dim(String(key).padEnd(maxKeyLen));
      const val = formatDetailValue(value);
      return `  ${label}  ${val}`;
    })
    .join('\n');
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return colors.dim('—');
  if (Array.isArray(value)) {
    return value.length === 0 ? colors.dim('(none)') : value.join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'boolean') return value ? colors.green('yes') : colors.red('no');
  return String(value);
}
