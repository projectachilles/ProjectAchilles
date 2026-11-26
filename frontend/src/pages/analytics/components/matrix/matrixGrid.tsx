import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { MARK_BG, MARK_TEXT } from '@/components/shared/marks/markTone';
import type { MatrixVerdict } from '@/services/api/analytics';
import { stripColumns } from './MatrixRow';
import { VERDICT_META, type MatrixForm } from './matrixModel';

/**
 * What rows of tests and rows of hosts share: one Tab stop with arrow keys,
 * the line that writes out the mark under the focus or the pointer, the
 * column names, and the summary with its legend.
 */

const MARK = '[data-matrix-mark]';
const markId = (el: HTMLElement) => `${el.dataset.row}|${el.dataset.col}`;

/**
 * Arrow keys inside the matrix: left and right along the row, up and down to
 * the nearest row that has a mark in the same column. At an edge, and where
 * no row has that column, focus stays.
 */
function moveBetweenMarks(e: KeyboardEvent<HTMLDivElement>) {
  const horizontal = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  const vertical = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if ((horizontal === 0 && vertical === 0) || !(e.target instanceof HTMLElement)) return;
  const current = e.target.closest<HTMLElement>(MARK);
  if (!current) return;
  e.preventDefault();
  const axis = horizontal !== 0 ? 'row' : 'col';
  const line = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(MARK)).filter((m) => m.dataset[axis] === current.dataset[axis]);
  line[line.indexOf(current) + horizontal + vertical]?.focus();
}

/**
 * The matrix as one stop for the Tab key (the mark last focused, or the
 * first), and the hint line. Both are set on the elements themselves, so
 * moving through thousands of marks renders nothing.
 */
export function useMarkGrid() {
  const grid = useRef<HTMLDivElement | null>(null);
  const hint = useRef<HTMLParagraphElement | null>(null);
  const lastFocused = useRef<string | null>(null);

  useEffect(() => {
    const marks = Array.from(grid.current?.querySelectorAll<HTMLElement>(MARK) ?? []);
    const stop = marks.find((m) => markId(m) === lastFocused.current) ?? marks[0];
    for (const mark of marks) mark.tabIndex = mark === stop ? 0 : -1;
  });

  // "<row's name> · <mark's name>": squares and small tiles carry no text.
  const showHint = (target: EventTarget) => {
    if (!hint.current || !(target instanceof HTMLElement)) return;
    const mark = target.closest<HTMLElement>('[data-testid="matrix-mark"]');
    if (!mark) return;
    const row = mark.closest('[role="group"]')?.getAttribute('aria-label');
    hint.current.textContent = `${row ? `${row} · ` : ''}${mark.getAttribute('aria-label') ?? ''}`;
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    showHint(e.target);
    const mark = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(MARK) : null;
    if (!mark) return;
    lastFocused.current = markId(mark);
    for (const other of grid.current?.querySelectorAll<HTMLElement>(MARK) ?? []) other.tabIndex = other === mark ? 0 : -1;
  };
  const onMouseOver = (e: MouseEvent<HTMLDivElement>) => showHint(e.target);

  return { gridProps: { ref: grid, onKeyDown: moveBetweenMarks, onFocus, onMouseOver }, hintRef: hint };
}

/** The line above squares and small tiles that names the mark under the focus or the pointer. A screen reader has each mark's own name. */
export function MarkHint({ form, hintRef }: { form: MatrixForm; hintRef: React.RefObject<HTMLParagraphElement | null> }) {
  if (form !== 'squares' && form !== 'small') return null;
  return <p ref={hintRef} data-testid="matrix-hint" aria-hidden="true" className="mb-1 min-h-4 truncate font-mono text-[11px] text-muted" />;
}

interface ColumnHeaderProps {
  columns: Array<{ key: string; label: string }>;
  form: MatrixForm;
  testId: string;
  /** Hostnames are set in the monospace face; test names are not. */
  mono?: boolean;
}

/** Names of the columns: across for tiles, angled and cut at a fixed length for small tiles, none for squares. */
export function ColumnHeader({ columns, form, testId, mono = false }: ColumnHeaderProps) {
  if (form !== 'tile' && form !== 'small') return null;
  return (
    <div style={stripColumns(columns.length, form)} className={cn('min-w-0', form === 'small' && 'h-[76px]')}>
      {columns.map((column) =>
        form === 'tile' ? (
          <span key={column.key} data-testid={testId} title={column.label} className={cn('truncate text-center text-[11px] text-muted', mono && 'font-mono')}>
            {column.label}
          </span>
        ) : (
          <span key={column.key} className="relative">
            {/* Angled, ending at its own column: it leans back over the label column, never past the last column. Cut at a fixed length. */}
            <span
              data-testid={testId}
              title={column.label}
              className={cn(
                'absolute bottom-0.5 right-1/2 max-w-[5.5rem] origin-bottom-right rotate-[48deg] truncate whitespace-nowrap text-[10px] text-muted',
                mono && 'font-mono',
              )}
            >
              {column.label}
            </span>
          </span>
        ),
      )}
    </div>
  );
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const LEGEND: MatrixVerdict[] = ['protected', 'detected', 'unprotected', 'no_verdict', 'risk_accepted'];

/** How much the matrix holds, and what each glyph means. */
export function MatrixSummary({ hostCount, testCount, windowLabel }: { hostCount: number; testCount: number; windowLabel: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-[13px] text-muted">
        {plural(hostCount, 'host')} · {plural(testCount, 'test')} · latest result in {windowLabel}
      </p>
      <ul aria-label="States" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {LEGEND.map((verdict) => (
          <li key={verdict} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={cn('font-bold', MARK_TEXT[VERDICT_META[verdict].tone])}>{VERDICT_META[verdict].glyph}</span>
            {VERDICT_META[verdict].label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1">
          <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-[2px]', MARK_BG.hollow)} />
          never run
        </li>
      </ul>
    </div>
  );
}
