/**
 * Output mode switcher — routes between JSON, pretty table, and detail views.
 * Detects --json flag globally and switches all output accordingly.
 */

import { renderTable, renderDetail, type ColumnDef } from './table.js';
import { jsonOutput, jsonError } from './json.js';
import { colors, scoreColor, progressBar } from './colors.js';

export type OutputMode = 'pretty' | 'json';

export class Formatter {
  constructor(
    private mode: OutputMode,
    private commandPath: string = '',
  ) {}

  /** Whether output is in JSON mode */
  get isJson(): boolean {
    return this.mode === 'json';
  }

  /** Print a table of records */
  table<T extends Record<string, unknown>>(
    rows: T[],
    columns: ColumnDef[],
    meta?: { total?: number; limit?: number; offset?: number },
  ): void {
    if (this.mode === 'json') {
      console.log(jsonOutput(rows, this.commandPath, meta));
    } else {
      if (rows.length === 0) {
        console.log(colors.dim('  No results found.'));
        return;
      }
      console.log(renderTable(rows as Record<string, unknown>[], columns));
      if (meta?.total !== undefined) {
        console.log(colors.dim(`\n  Showing ${rows.length} of ${meta.total} total`));
      }
    }
  }

  /** Print a single entity detail view */
  detail(data: Record<string, unknown>, keys?: string[]): void {
    if (this.mode === 'json') {
      console.log(jsonOutput(data, this.commandPath));
    } else {
      console.log(renderDetail(data, keys));
    }
  }

  /** Print a scalar or simple object result */
  result<T>(data: T, label?: string): void {
    if (this.mode === 'json') {
      console.log(jsonOutput(data, this.commandPath));
    } else {
      if (label) console.log(`  ${colors.bold(label)}`);
      if (typeof data === 'object' && data !== null) {
        console.log(renderDetail(data as Record<string, unknown>));
      } else {
        console.log(`  ${data}`);
      }
    }
  }

  /** Print a success message */
  success(message: string): void {
    if (this.mode === 'json') {
      console.log(jsonOutput({ message }, this.commandPath));
    } else {
      console.log(`  ${colors.brightGreen('✓')} ${message}`);
    }
  }

  /** Print an error message */
  error(message: string): void {
    if (this.mode === 'json') {
      console.error(jsonError(message, this.commandPath));
    } else {
      console.error(`  ${colors.brightRed('✗')} ${message}`);
    }
  }

  /** Print a warning */
  warn(message: string): void {
    if (this.mode === 'json') {
      // In JSON mode, warnings go to stderr to keep stdout clean
      console.error(JSON.stringify({ warning: message }));
    } else {
      console.error(`  ${colors.yellow('⚠')} ${message}`);
    }
  }

  /** Print a defense score with visual bar */
  score(value: number, label = 'Defense Score'): void {
    if (this.mode === 'json') {
      console.log(jsonOutput({ score: value }, this.commandPath));
    } else {
      console.log(`  ${colors.bold(label)}: ${scoreColor(value)} ${progressBar(value, 100)}`);
    }
  }

  /** Raw print (for custom rendering) */
  raw(text: string): void {
    console.log(text);
  }
}
